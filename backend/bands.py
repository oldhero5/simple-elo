"""
Grade bands. Ratings are only meaningful inside a band.

Tactical, operational and strategic are grade bands, not levels of war:
LT/CPT, MAJ/LTC, COL and above. Enlisted ranks stay in the app but sit in a
separate "unbanded" pool, and warrant officers need their own treatment
(information paper, section 18), so neither is folded into an officer band.
"""

TACTICAL = "tactical"
OPERATIONAL = "operational"
STRATEGIC = "strategic"
UNBANDED = "unbanded"

BANDS = (TACTICAL, OPERATIONAL, STRATEGIC, UNBANDED)

# "LT" and "BG+" are the grade labels the simulation uses.
_RANK_TO_BAND = {
    "2LT": TACTICAL,
    "1LT": TACTICAL,
    "LT": TACTICAL,
    "CPT": TACTICAL,
    "MAJ": OPERATIONAL,
    "LTC": OPERATIONAL,
    "COL": STRATEGIC,
    "BG": STRATEGIC,
    "BG+": STRATEGIC,
    "MG": STRATEGIC,
    "LTG": STRATEGIC,
    "GEN": STRATEGIC,
}


def band_for_rank(rank: str) -> str:
    """Return the grade band for a rank; anything else is unbanded."""
    return _RANK_TO_BAND.get(rank.strip().upper(), UNBANDED)
