import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

import queries
from db import Connection, Database, fetch_one, fetch_value, get_db, utcnow
from schemas import Personnel, PersonnelCreate, PersonnelUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/personnel", tags=["personnel"])

DB = Annotated[Database, Depends(get_db)]


def _ensure_unique(
    conn: Connection, name: str, rank: str, exclude_id: int | None = None
) -> None:
    clash = fetch_one(
        conn,
        """
        SELECT name, rank FROM personnel
        WHERE active AND lower(name) = lower(?) AND lower(rank) = lower(?)
            AND id IS DISTINCT FROM ?
        LIMIT 1
        """,
        (name, rank, exclude_id),
    )
    if clash is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{clash['rank']} {clash['name']} is already on the active roster",
        )


def _require_person(conn: Connection, person_id: int) -> Personnel:
    person = queries.get_person(conn, person_id)
    if person is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found")
    return person


def _update(conn: Connection, person: Personnel, changes: PersonnelUpdate) -> None:
    name = person.name if changes.name is None else changes.name
    rank = person.rank if changes.rank is None else changes.rank
    active = person.active if changes.active is None else changes.active

    renamed = (name.lower(), rank.lower()) != (person.name.lower(), person.rank.lower())
    if active and (renamed or not person.active):
        _ensure_unique(conn, name, rank, exclude_id=person.id)

    if (name, rank, active) == (person.name, person.rank, person.active):
        return
    # Plain UPDATE: UPDATE ... RETURNING on a primary key table failed on the
    # DuckDB release this app first shipped with.
    conn.execute(
        "UPDATE personnel SET name = ?, rank = ?, active = ? WHERE id = ?",
        (name, rank, active, person.id),
    )
    if person.active and not active:
        queries.cancel_pending_for_person(conn, person.id, utcnow())
        logger.info("Deactivated person %d", person.id)
    elif active and not person.active:
        logger.info("Reactivated person %d", person.id)


@router.get("", response_model=list[Personnel])
def list_personnel(db: DB, active_only: bool = True) -> list[Personnel]:
    with db.read() as conn:
        return queries.list_personnel(conn, active_only)


@router.post("", response_model=Personnel, status_code=status.HTTP_201_CREATED)
def create_person(body: PersonnelCreate, db: DB) -> Personnel:
    with db.transaction() as conn:
        _ensure_unique(conn, body.name, body.rank)
        person_id = fetch_value(
            conn,
            """
            INSERT INTO personnel
                (name, rank, initial_elo, current_elo, created_at, active)
            VALUES (?, ?, ?, ?, ?, TRUE)
            RETURNING id
            """,
            (body.name, body.rank, body.initial_elo, body.initial_elo, utcnow()),
        )
        person = _require_person(conn, person_id)
    logger.info("Added person %d", person.id)
    return person


@router.get("/{person_id}", response_model=Personnel)
def get_person(person_id: int, db: DB) -> Personnel:
    with db.read() as conn:
        return _require_person(conn, person_id)


@router.patch("/{person_id}", response_model=Personnel)
def update_person(person_id: int, body: PersonnelUpdate, db: DB) -> Personnel:
    """Edit a person. Deactivating someone cancels their unrated matchups in the
    active round; reactivated people are included from the next round."""
    with db.transaction() as conn:
        _update(conn, _require_person(conn, person_id), body)
        return _require_person(conn, person_id)


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_person(person_id: int, db: DB) -> Response:
    """Soft delete: the same as PATCH with active=false. History is kept."""
    with db.transaction() as conn:
        _update(conn, _require_person(conn, person_id), PersonnelUpdate(active=False))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
