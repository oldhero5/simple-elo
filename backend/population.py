"""
Population views: one comparison record, cut by band, unit and time.

Everything here is computed from the ratings table. A rating is only comparable
inside its band, so nothing ranks or averages ratings across bands. Can't-judge
answers count as answers but never as comparisons, wins or rating movement.
"""

import math
from typing import Optional

import numpy as np

from database import Database, dict_rows
from elo import CANT_JUDGE
from replay import DEFAULT_SHUFFLES, shuffled_replay

_ONE_SIDE = """
    SELECT id, {me} AS pid, ratee_{m}_elo_before AS before,
           ratee_{m}_elo_after AS rating, unit_{m} AS unit, quarter, band,
           cross_unit, outcome,
           CASE outcome WHEN '{win}' THEN 1.0 WHEN '{lose}' THEN 0.0
                        WHEN 'draw' THEN 0.5 END AS score
    FROM ratings WHERE track = ? AND quarter <= ?
"""
_APPEARANCES = (
    _ONE_SIDE.format(me="ratee_a_id", m="a", win="a_wins", lose="b_wins")
    + " {band_filter} UNION ALL "
    + _ONE_SIDE.format(me="ratee_b_id", m="b", win="b_wins", lose="a_wins")
    + " {band_filter}"
)


def get_filters(db: Database) -> dict:
    """The values the dashboard can filter on."""
    with db.get_connection() as conn:
        bands = dict_rows(
            conn.execute(
                """
                SELECT band, count(*) AS officers FROM personnel
                WHERE active = TRUE GROUP BY band ORDER BY officers DESC
                """
            )
        )
        units = conn.execute(
            """
            SELECT unit FROM personnel UNION
            SELECT unit_a FROM ratings UNION SELECT unit_b FROM ratings
            ORDER BY 1
            """
        ).fetchall()
        low, high = conn.execute(
            "SELECT min(quarter), max(quarter) FROM ratings"
        ).fetchone()
    return {
        "tracks": ["performance", "potential"],
        "bands": bands,
        "units": [u[0] for u in units],
        "quarters": list(range(low, high + 1)) if low is not None else [],
    }


def _load_appearances(conn, track, band, last_quarter):
    band_filter = "AND band = ?" if band else ""
    params = [track, last_quarter] + ([band] if band else [])
    conn.execute(
        "CREATE TEMP TABLE ap AS "
        + _APPEARANCES.format(band_filter=band_filter),
        params * 2,
    )


def _quarter_window(conn, quarter_from, quarter_to):
    low, high = conn.execute(
        "SELECT min(quarter), max(quarter) FROM ratings"
    ).fetchone()
    return quarter_from or low or 1, quarter_to or high or 1


def _spread_columns(value: str) -> str:
    return f"""
        avg({value}) AS mean, stddev_pop({value}) AS sd,
        quantile_cont({value}, 0.1) AS p10, quantile_cont({value}, 0.5) AS p50,
        quantile_cont({value}, 0.9) AS p90
    """


def get_population(
    db: Database,
    track: str = "performance",
    band: Optional[str] = None,
    unit: Optional[str] = None,
    quarter_from: Optional[int] = None,
    quarter_to: Optional[int] = None,
    limit: int = 25,
) -> dict:
    with db.get_connection() as conn:
        first, last = _quarter_window(conn, quarter_from, quarter_to)
        _load_appearances(conn, track, band, last)

        # Rows inside the cut. An officer belongs to a unit's cut for the
        # quarters they were recorded in that unit.
        in_window = "quarter >= ?"
        window_params: list = [first]
        if unit:
            in_window += " AND unit = ?"
            window_params.append(unit)

        counts = dict_rows(
            conn.execute(
                f"""
                SELECT
                    count(DISTINCT id) FILTER (WHERE outcome <> '{CANT_JUDGE}')
                        AS comparisons,
                    count(DISTINCT id) FILTER (WHERE outcome = '{CANT_JUDGE}')
                        AS cant_judge,
                    count(DISTINCT id) FILTER (WHERE outcome = 'draw') AS draws,
                    count(DISTINCT id) FILTER (
                        WHERE cross_unit AND outcome <> '{CANT_JUDGE}'
                    ) AS cross_unit_comparisons,
                    count(DISTINCT pid) FILTER (WHERE outcome <> '{CANT_JUDGE}')
                        AS officers
                FROM ap WHERE {in_window}
                """,
                window_params,
            )
        )[0]

        conn.execute(
            f"""
            CREATE TEMP TABLE cohort AS
            SELECT pid, band,
                   arg_max(rating, id) AS rating,
                   arg_min(before, id) AS window_start,
                   arg_max(unit, id) AS unit,
                   count(*) AS comparisons,
                   count(*) FILTER (WHERE score = 1) AS wins,
                   count(*) FILTER (WHERE score = 0) AS losses,
                   count(*) FILTER (WHERE score = 0.5) AS draws
            FROM ap WHERE {in_window} AND score IS NOT NULL
            GROUP BY pid, band
            """,
            window_params,
        )

        by_band = dict_rows(
            conn.execute(
                f"""
                SELECT band, count(*) AS officers, {_spread_columns('rating')}
                FROM cohort GROUP BY band ORDER BY officers DESC
                """
            )
        )

        leaderboard = []
        if band:
            leaderboard = dict_rows(
                conn.execute(
                    """
                    SELECT c.pid AS id, p.name, p.rank, c.unit, c.rating,
                           c.rating - c.window_start AS change, c.comparisons,
                           c.wins, c.losses, c.draws
                    FROM cohort c JOIN personnel p ON p.id = c.pid
                    ORDER BY c.rating DESC, c.pid LIMIT ?
                    """,
                    (limit,),
                )
            )

        by_quarter = dict_rows(
            conn.execute(
                f"""
                WITH per_officer AS (
                    SELECT quarter, pid, band, arg_max(rating, id) AS rating
                    FROM ap WHERE {in_window} AND score IS NOT NULL
                    GROUP BY quarter, pid, band
                ),
                spread AS (
                    SELECT quarter, count(*) AS officers,
                           {_spread_columns('rating')}
                    FROM per_officer GROUP BY quarter
                ),
                volume AS (
                    SELECT quarter,
                           count(DISTINCT id) AS comparisons,
                           count(DISTINCT id) FILTER (WHERE cross_unit)
                               AS cross_unit_comparisons
                    FROM ap WHERE {in_window} AND score IS NOT NULL
                    GROUP BY quarter
                )
                SELECT * FROM spread JOIN volume USING (quarter) ORDER BY quarter
                """,
                window_params * 2,
            )
        )

        by_unit = _by_unit(conn, first, last, comparable=band is not None)

        # The links that put units on one scale, whatever the unit filter says.
        unit_links = dict_rows(
            conn.execute(
                f"""
                SELECT least(unit_a, unit_b) AS unit_a,
                       greatest(unit_a, unit_b) AS unit_b,
                       count(*) AS comparisons
                FROM ratings
                WHERE track = ? AND quarter BETWEEN ? AND ? AND cross_unit
                  AND outcome <> '{CANT_JUDGE}' {'AND band = ?' if band else ''}
                GROUP BY 1, 2 ORDER BY comparisons DESC, 1, 2
                """,
                [track, first, last] + ([band] if band else []),
            )
        )

    if not band:
        for row in by_quarter:  # different scales: don't summarise them together
            for key in ("mean", "sd", "p10", "p50", "p90"):
                row[key] = None

    comparisons = counts["comparisons"]
    summary = {
        **counts,
        "cross_unit_share": (
            counts["cross_unit_comparisons"] / comparisons if comparisons else 0.0
        ),
    }
    return {
        "filters": {
            "track": track,
            "band": band,
            "unit": unit,
            "quarter_from": first,
            "quarter_to": last,
        },
        "synthetic": db.get_meta()["synthetic"],
        "summary": summary,
        "by_band": by_band,
        "by_quarter": by_quarter,
        "by_unit": by_unit,
        "unit_links": unit_links,
        "leaderboard": leaderboard,
    }


def _by_unit(conn, first: int, last: int, comparable: bool) -> list:
    """
    Per-unit view. The cross-unit record is the cut that can see a unit growing
    leaders: wins inside a unit are zero-sum for that unit, so its rating gain
    hides the effect (information paper, section 15).
    """
    span = last - first + 1
    third = max(1, span // 3)
    early_end, late_start = first + third - 1, last - third + 1

    rows = dict_rows(
        conn.execute(
            """
            WITH last_rating AS (
                SELECT unit, pid, arg_max(rating, id) AS rating
                FROM ap WHERE quarter >= ? AND score IS NOT NULL
                GROUP BY unit, pid
            ),
            ratings AS (
                SELECT unit, count(*) AS officers, avg(rating) AS mean_rating
                FROM last_rating GROUP BY unit
            ),
            record AS (
                SELECT unit, count(*) AS comparisons,
                    count(*) FILTER (WHERE cross_unit) AS cross_n,
                    avg(score) FILTER (WHERE cross_unit) AS cross_win_rate,
                    count(*) FILTER (WHERE cross_unit AND quarter <= ?) AS early_n,
                    avg(score) FILTER (WHERE cross_unit AND quarter <= ?) AS early_rate,
                    count(*) FILTER (WHERE cross_unit AND quarter >= ?) AS late_n,
                    avg(score) FILTER (WHERE cross_unit AND quarter >= ?) AS late_rate
                FROM ap WHERE quarter >= ? AND score IS NOT NULL
                GROUP BY unit
            )
            SELECT * FROM ratings JOIN record USING (unit) ORDER BY unit
            """,
            (first, early_end, early_end, late_start, late_start, first),
        )
    )
    for row in rows:
        if not comparable:
            row["mean_rating"] = None
        early, late = row["early_rate"], row["late_rate"]
        has_change = span >= 2 and early is not None and late is not None
        row["cross_win_rate_change"] = late - early if has_change else None
        row["cross_win_rate_change_se"] = (
            math.sqrt(
                early * (1 - early) / row["early_n"]
                + late * (1 - late) / row["late_n"]
            )
            if has_change
            else None
        )
    return rows


def get_replay(
    db: Database,
    track: str,
    band: str,
    unit: Optional[str] = None,
    through_quarter: Optional[int] = None,
    shuffles: int = DEFAULT_SHUFFLES,
    seed: int = 0,
    limit: int = 30,
) -> dict:
    """
    Replay a band's record in shuffled orders and report the spread.

    The whole band is replayed, because a rating depends on every comparison in
    the pool. The unit filter only narrows which officers are listed.
    """
    with db.get_connection() as conn:
        last = through_quarter or conn.execute(
            "SELECT coalesce(max(quarter), 1) FROM ratings"
        ).fetchone()[0]
        record = conn.execute(
            f"""
            SELECT ratee_a_id, ratee_b_id, outcome, quarter FROM ratings
            WHERE track = ? AND band = ? AND quarter <= ?
              AND outcome <> '{CANT_JUDGE}'
            ORDER BY id
            """,
            (track, band, last),
        ).fetchall()
        people = dict_rows(
            conn.execute(
                """
                SELECT id, name, rank, unit, initial_elo FROM personnel
                WHERE id IN (
                    SELECT ratee_a_id FROM ratings WHERE track = ? AND band = ?
                    UNION
                    SELECT ratee_b_id FROM ratings WHERE track = ? AND band = ?
                )
                ORDER BY id
                """,
                (track, band, track, band),
            )
        )

    position = {p["id"]: i for i, p in enumerate(people)}
    a = np.array([position[r[0]] for r in record], dtype=np.int64)
    b = np.array([position[r[1]] for r in record], dtype=np.int64)
    scores = np.array(
        [{"a_wins": 1.0, "b_wins": 0.0, "draw": 0.5}[r[2]] for r in record]
    )
    quarters = np.array([r[3] for r in record], dtype=np.int64)
    start = np.array([p["initial_elo"] for p in people], dtype=float)

    officers = []
    summary = {
        "officers": len(people),
        "comparisons": len(record),
        "median_sd": 0.0,
        "p95_sd": 0.0,
        "max_sd": 0.0,
        "median_range": 0.0,
        "median_rank_sd": 0.0,
        "median_sd_of_mean": 0.0,
        "max_sd_of_mean": 0.0,
    }
    if people:
        result = shuffled_replay(a, b, scores, quarters, start, shuffles, seed)
        low, high = result.finals.min(axis=0), result.finals.max(axis=0)
        summary.update(
            median_sd=float(np.median(result.sd)),
            p95_sd=float(np.percentile(result.sd, 95)),
            max_sd=float(result.sd.max()),
            median_range=float(np.median(high - low)),
            median_rank_sd=float(np.median(result.rank_sd)),
            median_sd_of_mean=float(np.median(result.sd_of_mean)),
            max_sd_of_mean=float(result.sd_of_mean.max()),
        )
        standing = (-result.mean).argsort().argsort() + 1
        for i in np.argsort(-result.mean):
            person = people[int(i)]
            if unit and person["unit"] != unit:
                continue
            officers.append(
                {
                    "id": person["id"],
                    "name": person["name"],
                    "rank": person["rank"],
                    "unit": person["unit"],
                    "position": int(standing[i]),
                    "recorded": float(result.recorded[i]),
                    "mean": float(result.mean[i]),
                    "sd": float(result.sd[i]),
                    "min": float(low[i]),
                    "max": float(high[i]),
                    "rank_sd": float(result.rank_sd[i]),
                }
            )
            if len(officers) == limit:
                break

    return {
        "filters": {
            "track": track,
            "band": band,
            "unit": unit,
            "through_quarter": last,
        },
        "synthetic": db.get_meta()["synthetic"],
        "shuffles": shuffles,
        "seed": seed,
        "summary": summary,
        "officers": officers,
    }
