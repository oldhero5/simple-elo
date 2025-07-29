# ELO Performance Rating System

A military-grade performance rating application using ELO algorithms for pairwise comparisons of personnel. Built with Next.js, Python FastAPI, and DuckDB for a lightweight, containerized solution.

## Features

- **Personnel Management**: Add ratees with name and rank
- **Pairwise Comparison**: Present two ratees at a time for comparison (A wins, B wins, or Draw)
- **ELO Algorithm**: Uses standard ELO rating system with K-factor of 32 and starting score of 1000
- **Dashboard**: Shows ELO progression chart over time with current leaderboard
- **Dark Mode UI**: Military/tactical color scheme with monospace fonts
- **Data Persistence**: All ratings stored with timestamps in DuckDB

## Quick Start

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone <repository-url>
cd simple_elo
```

2. Build and run with Docker Compose:
```bash
docker-compose up --build
```

3. Open your browser to:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

#### Development Mode

#### Backend
```bash
cd backend
uv sync  # Install dependencies using uv
uv run uvicorn main:app --reload
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Security Features

### Pre-commit Hooks
This project includes comprehensive pre-commit hooks for security and code quality:

- **Security Scanning**: Bandit for Python security issues, detect-secrets for credential detection
- **Code Quality**: Black, isort, flake8, mypy for Python; ESLint, Prettier for TypeScript
- **Infrastructure Security**: Hadolint for Docker security, Checkov for IaC scanning
- **Dependency Security**: Safety for Python package vulnerability scanning

To set up pre-commit hooks:
```bash
uv tool install pre-commit
pre-commit install
```

### Security Best Practices Implemented

1. **Input Validation**: All API inputs validated using Pydantic models
2. **SQL Injection Protection**: Parameterized queries with DuckDB
3. **No Hardcoded Secrets**: Environment variables for sensitive configuration
4. **Container Security**: Non-root user in Docker containers
5. **Dependency Scanning**: Regular security audits of dependencies
6. **Code Analysis**: Static analysis for security vulnerabilities

## Architecture

```
elo-rater/
├── docker-compose.yml          # Container orchestration
├── frontend/                   # Next.js application
│   ├── app/                   # Next.js 14 app directory
│   │   ├── page.tsx          # Dashboard with ELO chart
│   │   ├── rate/page.tsx     # Pairwise comparison interface
│   │   └── personnel/page.tsx # Personnel management
│   ├── components/            # Reusable React components
│   └── Dockerfile
├── backend/                    # FastAPI application
│   ├── main.py               # FastAPI routes
│   ├── models.py             # Pydantic models
│   ├── database.py           # DuckDB operations
│   ├── elo.py                # ELO calculation logic
│   └── Dockerfile
└── data/                      # DuckDB database storage
    └── elo_ratings.db        # Created automatically
```

## API Endpoints

### Personnel Management
- `GET /api/personnel` - List all personnel with current ELO
- `POST /api/personnel` - Add new person
- `PUT /api/personnel/{id}` - Update person details
- `DELETE /api/personnel/{id}` - Soft delete (set inactive)

### Rating System
- `GET /api/comparison` - Get next pair for comparison
- `POST /api/rate` - Submit rating result
- `GET /api/history` - Get rating history
- `GET /api/elo-progression` - Get ELO scores over time for charts
- `GET /api/stats` - Get system statistics

## ELO Algorithm

The system uses the standard ELO rating formula:
- Starting rating: 1000 points
- K-factor: 32 (configurable)
- Results: Win (1.0), Loss (0.0), Draw (0.5)

```python
def calculate_elo(rating_a, rating_b, result, k_factor=32):
    expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    expected_b = 1 - expected_a

    new_rating_a = rating_a + k_factor * (result - expected_a)
    new_rating_b = rating_b + k_factor * ((1 - result) - expected_b)

    return int(new_rating_a), int(new_rating_b)
```

## Technology Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, Recharts
- **Backend**: Python FastAPI, DuckDB, Pydantic
- **Containerization**: Docker, Docker Compose
- **UI Components**: Lucide React icons, custom military theme

## Database Schema

```sql
-- Personnel table
CREATE TABLE personnel (
    id INTEGER PRIMARY KEY,
    name VARCHAR NOT NULL,
    rank VARCHAR NOT NULL,
    initial_elo INTEGER DEFAULT 1000,
    current_elo INTEGER DEFAULT 1000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT TRUE
);

-- Ratings table
CREATE TABLE ratings (
    id INTEGER PRIMARY KEY,
    rater_id INTEGER,
    ratee_a_id INTEGER NOT NULL,
    ratee_b_id INTEGER NOT NULL,
    winner_id INTEGER, -- NULL for draw
    ratee_a_elo_before INTEGER NOT NULL,
    ratee_b_elo_before INTEGER NOT NULL,
    ratee_a_elo_after INTEGER NOT NULL,
    ratee_b_elo_after INTEGER NOT NULL,
    rated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Usage

1. **Add Personnel**: Navigate to Personnel Management and add ratees with names and ranks
2. **Start Rating**: Use the "Start Rating Session" button to begin pairwise comparisons
3. **View Progress**: Dashboard shows ELO progression over time and current leaderboard
4. **Manage Data**: Edit or deactivate personnel as needed

## Military Ranks Supported

**Enlisted**: PVT, PFC, SPC, CPL, SGT, SSG, SFC, MSG, SGM
**Officers**: 2LT, 1LT, CPT, MAJ, LTC, COL, BG, MG, LTG, GEN

## Color Scheme

- Background: #0a0a0a (near black)
- Card Background: #1a1a1a
- Borders: #2a2a2a
- Primary Text: #e5e5e5
- Secondary Text: #a3a3a3
- Success/Wins: #22c55e (green)
- Errors/Losses: #ef4444 (red)
- Neutral/Draws: #f59e0b (amber)
