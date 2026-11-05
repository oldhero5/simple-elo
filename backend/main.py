"""
FastAPI backend for Elo Rating System
"""

from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from database import db
from elo import get_expected_score, get_rating_change_preview
from models import (
    Band,
    ComparisonPair,
    EloHistoryPoint,
    LegacyComparisonPair,
    Personnel,
    PersonnelCreate,
    PersonnelUpdate,
    Rating,
    RatingCreate,
    Round,
    RoundConfig,
    RoundCreate,
    Track,
)
from population import get_filters, get_population, get_replay

app = FastAPI(
    title="Elo Performance Rating System",
    description="Military-grade performance evaluation using ELO algorithms",
    version="1.0.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "ELO Rating System API", "status": "operational"}


# Personnel endpoints
@app.post("/api/personnel", response_model=Personnel)
async def create_personnel(personnel_data: PersonnelCreate):
    """Create new personnel entry"""
    try:
        return db.create_personnel(personnel_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/personnel", response_model=List[Personnel])
async def get_all_personnel(
    active_only: bool = True,
    band: Optional[Band] = None,
    unit: Optional[str] = None,
    limit: Optional[int] = Query(default=None, ge=1),
):
    """Get personnel ordered by performance rating"""
    return db.get_all_personnel(
        active_only=active_only, band=band, unit=unit, limit=limit
    )


@app.get("/api/personnel/{personnel_id}", response_model=Personnel)
async def get_personnel(personnel_id: int):
    """Get specific personnel by ID"""
    personnel = db.get_personnel(personnel_id)
    if not personnel:
        raise HTTPException(status_code=404, detail="Personnel not found")
    return personnel


@app.put("/api/personnel/{personnel_id}", response_model=Personnel)
async def update_personnel(personnel_id: int, personnel_data: PersonnelUpdate):
    """Update personnel information"""
    personnel = db.update_personnel(personnel_id, personnel_data)
    if not personnel:
        raise HTTPException(status_code=404, detail="Personnel not found")
    return personnel


@app.delete("/api/personnel/{personnel_id}")
async def delete_personnel(personnel_id: int):
    """Soft delete personnel (set inactive)"""
    # Use the existing update_personnel method but don't rely on its return value
    # since we know the operation works but the method has return issues
    try:
        # Check if personnel exists first
        all_personnel = db.get_all_personnel(active_only=False)
        target_personnel = next(
            (p for p in all_personnel if p.id == personnel_id), None
        )

        if not target_personnel:
            raise HTTPException(status_code=404, detail="Personnel not found")

        # If already inactive, still return success
        if not target_personnel.active:
            return {"message": "Personnel already deactivated"}

        # Perform the deactivation using update_personnel
        db.update_personnel(personnel_id, PersonnelUpdate(active=False))

        return {"message": "Personnel deactivated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


# Rating endpoints
def _scoring_context(comparison_data: dict) -> dict:
    rating_a, rating_b = comparison_data["rating_a"], comparison_data["rating_b"]
    expected_a, expected_b = get_expected_score(rating_a, rating_b)
    return {
        "expected_scores": {"a_expected": expected_a, "b_expected": expected_b},
        "rating_preview": get_rating_change_preview(rating_a, rating_b),
    }


@app.get("/api/comparison", response_model=LegacyComparisonPair)
async def get_comparison_pair():
    """Get next pair for pairwise comparison from current round"""
    comparison_data = db.get_round_based_comparison_pair()
    if not comparison_data:
        raise HTTPException(
            status_code=404,
            detail="No matchups available. Add more personnel or start a new round.",
        )
    return LegacyComparisonPair(
        person_a=comparison_data["person_a"],
        person_b=comparison_data["person_b"],
        **_scoring_context(comparison_data),
    )


@app.get("/api/comparison/full", response_model=ComparisonPair)
async def get_full_comparison_pair():
    """Get full round-based comparison pair with progress info"""
    comparison_data = db.get_round_based_comparison_pair()
    if not comparison_data:
        raise HTTPException(
            status_code=404,
            detail="No matchups available. Add more personnel or start a new round.",
        )
    return ComparisonPair(
        round_info=comparison_data["round_info"],
        matchup=comparison_data["matchup"],
        person_a=comparison_data["person_a"],
        person_b=comparison_data["person_b"],
        track=comparison_data["track"],
        question=comparison_data["question"],
        rating_a=comparison_data["rating_a"],
        rating_b=comparison_data["rating_b"],
        cross_unit=comparison_data["cross_unit"],
        progress=comparison_data["progress"],
        **_scoring_context(comparison_data),
    )


@app.post("/api/rate", response_model=Rating)
async def submit_rating(rating_data: RatingCreate):
    """Submit an answer to a matchup, or to the next pending one if none is named"""
    round_id, matchup_id = rating_data.round_id, rating_data.matchup_id
    if not (round_id and matchup_id):
        current = db.get_round_based_comparison_pair()
        if not current:
            raise HTTPException(status_code=404, detail="No pending matchups")
        round_id = current["round_info"].id
        matchup_id = current["matchup"].id
    try:
        return db.create_round_rating(
            round_id,
            matchup_id,
            rating_data.winner_id,
            rating_data.cant_judge,
            rating_data.rater_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/history", response_model=List[Rating])
async def get_rating_history(limit: int = 100):
    """Get recent rating history"""
    return db.get_rating_history(limit=limit)


@app.get("/api/elo-progression", response_model=List[EloHistoryPoint])
async def get_elo_progression(track: Track = "performance"):
    """Get rating progression data for charting"""
    return db.get_elo_progression(track)


@app.get("/api/elo-progression/by-rounds")
async def get_elo_progression_by_rounds(track: Track = "performance"):
    """Get rating progression data grouped by completed rounds"""
    return db.get_elo_progression_by_rounds(track)


@app.get("/api/leaderboard", response_model=List[Personnel])
async def get_leaderboard():
    """Get current leaderboard sorted by performance rating"""
    return db.get_all_personnel(active_only=True)


@app.get("/api/stats")
async def get_stats():
    """Get system statistics"""
    personnel = db.get_all_personnel(active_only=True)
    current_round = db.get_current_round()

    stats = {
        "total_personnel": len(personnel),
        "total_ratings": db.count_scored_ratings(),
        "avg_elo": sum(p.current_elo for p in personnel) / len(personnel)
        if personnel
        else 0,
        "highest_elo": max((p.current_elo for p in personnel), default=0),
        "lowest_elo": min((p.current_elo for p in personnel), default=0),
    }

    if current_round:
        stats["current_round"] = {
            "id": current_round.id,
            "name": current_round.round_name,
            "dtg": current_round.dtg.isoformat(),
            "status": current_round.status,
            "track": current_round.track,
            "quarter": current_round.quarter,
            **db.get_round_progress(current_round.id),
        }

    return stats


# Population views
@app.get("/api/meta")
async def get_meta():
    """What dataset this is, including whether it is synthetic"""
    return db.get_meta()


@app.get("/api/filters")
async def filters():
    """Values available to the dashboard filters"""
    return get_filters(db)


@app.get("/api/population")
async def population(
    track: Track = "performance",
    band: Optional[Band] = None,
    unit: Optional[str] = None,
    quarter_from: Optional[int] = Query(default=None, ge=1),
    quarter_to: Optional[int] = Query(default=None, ge=1),
    limit: int = Query(default=25, ge=1, le=500),
):
    """The comparison record cut by band, unit and time"""
    return get_population(db, track, band, unit, quarter_from, quarter_to, limit)


@app.get("/api/replay")
async def replay(
    band: Band,
    track: Track = "performance",
    unit: Optional[str] = None,
    through_quarter: Optional[int] = Query(default=None, ge=1),
    shuffles: int = Query(default=100, ge=2, le=500),
    seed: int = 0,
    limit: int = Query(default=30, ge=1, le=500),
):
    """Replay a band's record in shuffled orders and report the rating spread"""
    return get_replay(db, track, band, unit, through_quarter, shuffles, seed, limit)


# Round management endpoints
@app.post("/api/rounds", response_model=Round)
async def create_round(round_data: RoundCreate):
    """Create a new round"""
    try:
        return db.create_round(round_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rounds/current", response_model=Round)
async def get_current_round():
    """Get the current active round"""
    current_round = db.get_current_round()
    if not current_round:
        raise HTTPException(status_code=404, detail="No active round found")
    return current_round


@app.get("/api/rounds/{round_id}/progress")
async def get_round_progress(round_id: int):
    """Get progress information for a specific round"""
    progress = db.get_round_progress(round_id)
    if not progress:
        raise HTTPException(status_code=404, detail="Round not found")
    return progress


@app.post("/api/rounds/new")
async def start_new_round(config: Optional[RoundConfig] = None):
    """Start a new budgeted round (closes the current round if active)"""
    try:
        new_round = db.start_new_round(config or RoundConfig())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "message": "New round started successfully",
        "round": new_round.model_copy(update={"personnel_snapshot": ""}),
    }


@app.post("/api/rounds/start-first")
async def start_first_round():
    """Start the very first round when no rounds exist"""
    if db.get_current_round():
        raise HTTPException(status_code=400, detail="A round is already active")
    new_round = db.create_initial_round_if_needed()
    if not new_round:
        raise HTTPException(
            status_code=400,
            detail="Need at least 2 active personnel to start a round",
        )
    return {"message": "First round started successfully", "round": new_round}


@app.get("/api/rounds/completed")
async def get_completed_rounds(limit: int = Query(default=100, ge=1, le=500)):
    """Get completed rounds, newest first"""
    return db.get_completed_rounds(limit)


@app.get("/api/rounds/{round_id}/results")
async def get_round_results(round_id: int):
    """Get comprehensive results for a specific round"""
    results = db.get_round_results(round_id)
    if not results:
        raise HTTPException(status_code=404, detail="Round not found")
    return results


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
