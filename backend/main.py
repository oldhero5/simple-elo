"""
FastAPI backend for ELO Rating System
Military-grade performance evaluation platform
"""

from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from database import db
from elo import get_expected_score, get_rating_change_preview
from models import (
    ComparisonPair,
    EloHistoryPoint,
    LeaderboardEntry,
    LegacyComparisonPair,
    Matchup,
    Personnel,
    PersonnelCreate,
    PersonnelUpdate,
    Rating,
    RatingCreate,
    Round,
    RoundCreate,
)

app = FastAPI(
    title="ELO Performance Rating System",
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
async def get_all_personnel(active_only: bool = True):
    """Get all personnel ordered by current ELO rating"""
    return db.get_all_personnel(active_only=active_only)


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
@app.get("/api/comparison", response_model=LegacyComparisonPair)
async def get_comparison_pair():
    """Get next pair for pairwise comparison from current round"""
    print("🎲 Getting comparison pair...")

    comparison_data = db.get_round_based_comparison_pair()
    if not comparison_data:
        print("❌ No comparison data available")
        raise HTTPException(
            status_code=404,
            detail="No matchups available. Add more personnel or start a new round.",
        )

    person_a = comparison_data["person_a"]
    person_b = comparison_data["person_b"]
    round_info = comparison_data.get("round_info")
    matchup = comparison_data.get("matchup")

    print(
        f"🎯 Returning comparison: {person_a.name} (id={person_a.id}) vs {person_b.name} (id={person_b.id})"
    )
    if round_info:
        print(f"📋 Round: {round_info.round_name} (id={round_info.id})")
    if matchup:
        print(f"🔗 Matchup: id={matchup.id}, status={matchup.status}")

    expected_scores = get_expected_score(person_a.current_elo, person_b.current_elo)
    rating_preview = get_rating_change_preview(
        person_a.current_elo, person_b.current_elo
    )

    return LegacyComparisonPair(
        person_a=person_a,
        person_b=person_b,
        expected_scores={
            "a_expected": expected_scores[0],
            "b_expected": expected_scores[1],
        },
        rating_preview=rating_preview,
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

    person_a = comparison_data["person_a"]
    person_b = comparison_data["person_b"]
    round_info = comparison_data["round_info"]
    matchup = comparison_data["matchup"]
    progress = comparison_data["progress"]

    expected_scores = get_expected_score(person_a.current_elo, person_b.current_elo)
    rating_preview = get_rating_change_preview(
        person_a.current_elo, person_b.current_elo
    )

    return ComparisonPair(
        round_info=round_info,
        matchup=matchup,
        person_a=person_a,
        person_b=person_b,
        expected_scores={
            "a_expected": expected_scores[0],
            "b_expected": expected_scores[1],
        },
        rating_preview=rating_preview,
        progress=progress,
    )


@app.post("/api/rate", response_model=Rating)
async def submit_rating(rating_data: RatingCreate):
    """Submit rating result within current round context"""
    try:
        print(
            f"🔍 RATING DEBUG: Received data: ratee_a_id={rating_data.ratee_a_id}, ratee_b_id={rating_data.ratee_b_id}, winner_id={rating_data.winner_id}, round_id={rating_data.round_id}, matchup_id={rating_data.matchup_id}"
        )

        # If round_id and matchup_id provided, use round-based rating
        if rating_data.round_id and rating_data.matchup_id:
            print(
                f"🎯 Using direct round-based rating: round_id={rating_data.round_id}, matchup_id={rating_data.matchup_id}"
            )
            return db.create_round_rating(
                rating_data.round_id,
                rating_data.matchup_id,
                rating_data.ratee_a_id,
                rating_data.ratee_b_id,
                rating_data.winner_id,
                rating_data.rater_id,
            )

        # Fallback: Use current round system even for old API calls
        print("🔄 Using legacy API compatibility mode")

        # Get current round and find the matching pending matchup
        current_round = db.get_current_round()
        if not current_round:
            raise HTTPException(status_code=400, detail="No active round found")

        print(f"📋 Found active round: {current_round.id} - {current_round.round_name}")

        # Simplified approach: Always use the first pending matchup from current round
        with db.get_connection() as conn:
            # Get the first pending matchup regardless of what frontend sent
            matchup_result = conn.execute(
                """
                SELECT * FROM matchups
                WHERE round_id = ? AND status = 'pending'
                ORDER BY id
                LIMIT 1
            """,
                (current_round.id,),
            ).fetchone()

            if not matchup_result:
                # No pending matchups - round might be complete
                raise HTTPException(
                    status_code=404,
                    detail="No pending matchups available. Round may be complete.",
                )

        # Use the round-based rating system with the found matchup
        matchup_id = matchup_result[0]
        actual_ratee_a_id = matchup_result[2]  # ratee_a_id from the matchup
        actual_ratee_b_id = matchup_result[3]  # ratee_b_id from the matchup

        # Simplified winner logic: Map the provided winner to actual matchup participants
        actual_winner_id = None  # Default to draw
        if rating_data.winner_id == actual_ratee_a_id:
            actual_winner_id = actual_ratee_a_id  # A wins
        elif rating_data.winner_id == actual_ratee_b_id:
            actual_winner_id = actual_ratee_b_id  # B wins
        elif rating_data.winner_id is None:
            actual_winner_id = None  # Draw
        else:
            # If winner doesn't match either participant, default to person A
            actual_winner_id = actual_ratee_a_id

        print(
            f"🎯 Matchup {matchup_id}: {actual_ratee_a_id} vs {actual_ratee_b_id}, winner: {actual_winner_id}"
        )

        result = db.create_round_rating(
            current_round.id,
            matchup_id,
            actual_ratee_a_id,
            actual_ratee_b_id,
            actual_winner_id,
            rating_data.rater_id,
        )

        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/history", response_model=List[Rating])
async def get_rating_history(limit: int = 100):
    """Get recent rating history"""
    return db.get_rating_history(limit=limit)


@app.get("/api/elo-progression", response_model=List[EloHistoryPoint])
async def get_elo_progression():
    """Get ELO progression data for charting"""
    return db.get_elo_progression()


@app.get("/api/elo-progression/by-rounds")
async def get_elo_progression_by_rounds():
    """Get ELO progression data grouped by completed rounds"""
    return db.get_elo_progression_by_rounds()


@app.get("/api/leaderboard", response_model=List[Personnel])
async def get_leaderboard():
    """Get current leaderboard sorted by ELO rating"""
    return db.get_all_personnel(active_only=True)


@app.get("/api/stats")
async def get_stats():
    """Get system statistics"""
    personnel = db.get_all_personnel(active_only=True)
    ratings = db.get_rating_history(limit=1000)
    current_round = db.get_current_round()

    # Temporary debug: check matchups in database
    with db.get_connection() as conn:
        matchup_count = conn.execute(
            "SELECT COUNT(*) FROM matchups WHERE round_id = ?",
            (current_round.id,) if current_round else (0,),
        ).fetchone()[0]
        pending_matchups = conn.execute(
            "SELECT ratee_a_id, ratee_b_id FROM matchups WHERE round_id = ? AND status = 'pending' LIMIT 3",
            (current_round.id,) if current_round else (0,),
        ).fetchall()

    stats = {
        "total_personnel": len(personnel),
        "total_ratings": len(ratings),
        "avg_elo": sum(p.current_elo for p in personnel) / len(personnel)
        if personnel
        else 0,
        "highest_elo": max((p.current_elo for p in personnel), default=0),
        "lowest_elo": min((p.current_elo for p in personnel), default=0),
        "debug_matchups": {
            "total_matchups_in_db": matchup_count,
            "pending_matchups_sample": pending_matchups,
        },
    }

    if current_round:
        progress = db.get_round_progress(current_round.id)
        stats.update(
            {
                "current_round": {
                    "id": current_round.id,
                    "name": current_round.round_name,
                    "dtg": current_round.dtg.isoformat(),
                    "status": current_round.status,
                    **progress,
                }
            }
        )

    return stats


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
async def start_new_round():
    """Start a new round (completes current round if active)"""
    try:
        # Mark current round as completed if exists
        current_round = db.get_current_round()
        if current_round:
            with db.get_connection() as conn:
                conn.execute(
                    "UPDATE rounds SET status = 'completed' WHERE id = ?",
                    (current_round.id,),
                )

        # Get all completed rounds to determine round number
        completed_rounds = db.get_completed_rounds()
        round_num = len(completed_rounds) + 1

        # Create new round
        from datetime import datetime

        new_round = db.create_round(
            RoundCreate(
                round_name=f"Round {round_num} - {datetime.now().strftime('%Y%m%d-%H%M%S')}",
                dtg=datetime.now(),
            )
        )

        return {"message": "New round started successfully", "round": new_round}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rounds/start-first")
async def start_first_round():
    """Start the very first round when no rounds exist"""
    try:
        # Check if any rounds exist
        current_round = db.get_current_round()
        if current_round:
            raise HTTPException(status_code=400, detail="A round is already active")

        # Create initial round
        new_round = db.create_initial_round_if_needed()
        if not new_round:
            raise HTTPException(
                status_code=400,
                detail="Need at least 2 active personnel to start a round",
            )

        return {"message": "First round started successfully", "round": new_round}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/debug/matchups")
async def debug_matchups():
    """Debug endpoint to see matchup state"""
    print("🚀 DEBUG: debug_matchups endpoint called!")
    try:
        print("🔍 DEBUG: About to call get_current_round()")
        current_round = db.get_current_round()
        print(f"🔍 DEBUG: current_round = {current_round}")

        if not current_round:
            print("❌ DEBUG: No current round found")
            return {"error": "No active round"}

        with db.get_connection() as conn:
            # Get all matchups for current round
            print(f"🔍 DEBUG: Looking for matchups in round_id = {current_round.id}")

            matchups = conn.execute(
                """
                SELECT id, ratee_a_id, ratee_b_id, status, created_at
                FROM matchups
                WHERE round_id = ?
                ORDER BY created_at
            """,
                (current_round.id,),
            ).fetchall()

            print(f"🔍 DEBUG: Found {len(matchups)} matchups")

            # Also check total matchups in database
            total_matchups = conn.execute(
                "SELECT COUNT(*) FROM matchups WHERE round_id = ?", (current_round.id,)
            ).fetchone()[0]
            print(
                f"🔍 DEBUG: Total matchups in DB for round {current_round.id}: {total_matchups}"
            )

            # Get personnel names for readability
            personnel = {}
            for p in db.get_all_personnel():
                personnel[p.id] = p.name

            return {
                "round": {
                    "id": current_round.id,
                    "name": current_round.round_name,
                    "total_matchups": current_round.total_matchups,
                    "completed_matchups": current_round.completed_matchups,
                },
                "debug_info": {
                    "matchups_found_in_db": len(matchups),
                    "total_matchups_count": total_matchups,
                },
                "matchups": [
                    {
                        "id": m[0],
                        "ratee_a_id": m[1],
                        "ratee_a_name": personnel.get(m[1], "Unknown"),
                        "ratee_b_id": m[2],
                        "ratee_b_name": personnel.get(m[2], "Unknown"),
                        "status": m[3],
                        "created_at": str(m[4]),
                    }
                    for m in matchups
                ],
            }
    except Exception as e:
        print(f"❌ DEBUG ERROR: {str(e)}")
        return {"error": str(e)}


@app.get("/api/debug/simple")
async def debug_simple():
    """Simple debug endpoint to test basic functionality"""
    return {"status": "working", "message": "Debug endpoint is reachable"}


@app.get("/api/rounds/completed")
async def get_completed_rounds():
    """Get all completed rounds"""
    try:
        completed_rounds = db.get_completed_rounds()
        return completed_rounds
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rounds/{round_id}/results")
async def get_round_results(round_id: int):
    """Get comprehensive results for a specific round"""
    try:
        results = db.get_round_results(round_id)
        if not results:
            raise HTTPException(status_code=404, detail="Round not found")
        return results
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
