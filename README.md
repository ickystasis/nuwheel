# Wheel of Doom(b) 🎡

A chaotic multiplayer movie-picking game where watchers add titles to a spinning wheel, allocate point budgets, spin to pick a winner, then vote to pass or punish. Points swing back and forth through a debt matrix — repeat punishes rack up escalating debts.

## How It Works

1. **Add Victims** — Create watchers, assign them movies with point weights on the wheel
2. **Select Participants** — Choose who's in the session via the 👤 button
3. **Spin** — The wheel picks a winner based on weighted odds
4. **Vote** — Watchers vote 👍 Pass or 👎 Punish (proposer gets 1.1x tiebreaker)
5. **Pass** — Winner's streak resets to 0
6. **Punish** — Winner incurs debt to every attendee (streak × points), making them less likely to win future spins as their effective points drop
7. **Repeat** — Points are computed dynamically from the debt matrix

## Features

- **Canvas Wheel** — Smooth animated HTML5 Canvas wheel with segment labels, auto-scaling font, and word wrap
- **Debt Matrix** — Every punish creates a debt entry; effective points = 6 + debts owed to you − debts you owe
- **Punish Streaks** — Consecutive punishments multiply the debt owed (🔥x1, 🔥x2, …)
- **Winner History** — Full log of past spins with per-watcher vote breakdowns, judgement toggles, and tooltips showing each watcher's movies for that spin
- **Real-Time Sync** — Flask-SocketIO broadcasts all mutations to connected clients
- **Server-Side Persistence** — Center image, spin settings, and active participant selection persist across browsers via SQLite
- **Admin Panel** — Password-protected admin console for manual point adjustments, streak resets, and watcher management
- **Stats Dashboard** — Aggregate stats on wins, punishments, and streaks
- **Abort Spins** — Mark a spin as aborted (cancelled) instead of pass/punish
- **Retroactive Voting** — Re-open voting on past winner entries to cast or recast votes
- **Shuffle Wheel** — Randomize segment order without affecting the victim panel
- **Sound Effects** — Optional spin music and victory cheers
- **Dockerized** — Single-container deployment with nginx reverse proxy

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12+, Flask 3.1, Flask-SocketIO 5.3 |
| Frontend | Vanilla JS, HTML5 Canvas, Socket.IO client |
| Database | SQLite (file-based) |
| Web Server | nginx (reverse proxy + static files) |
| Deployment | Docker (python:3.12-alpine) |

## Quick Start

### Docker (recommended)

```bash
docker compose up -d --build
```

Open http://localhost:9642

### Manual

```bash
pip install -r requirements.txt
python run.py
```

Open http://localhost:5000

Set `DB_DIR` environment variable to control where the SQLite database is stored (default: `/data`).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_DIR` | `/data` | Directory for SQLite database |
| `ADMIN_PASSWORD` | `setadminpass` | Password for the admin panel |

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/data` | All watchers + titles + computed points |
| GET/PUT | `/api/settings` | Server-side app settings (center image, spin settings, active IDs) |
| POST | `/api/watchers` | Create a watcher |
| DELETE | `/api/watchers/<id>` | Remove a watcher and all titles |
| PATCH | `/api/watchers/<id>/points` | Adjust points |
| PATCH | `/api/watchers/<id>/color` | Update color |
| POST | `/api/titles` | Add a title |
| PUT | `/api/titles/<id>` | Update a title |
| DELETE | `/api/titles/<id>` | Remove a title |
| POST | `/api/titles/shuffle` | Randomize display order |
| GET | `/api/winners` | List all winners |
| POST | `/api/winners` | Save a new winner |
| PATCH | `/api/winners/<id>/judgement` | Set pass/punish judgement |
| PATCH | `/api/winners/<id>/verdict` | Set judgement + per-watcher votes |
| POST | `/api/spin/abort` | Mark winner as aborted |
| POST | `/api/spin/process-win` | Clear debts owed to winner |
| POST | `/api/spin/punish` | Winner incurs debt to attendees |
| POST | `/api/spin/pass` | Reset punish streak |
| GET | `/api/stats` | Aggregate stats |
| GET | `/api/debts` | Full debt matrix |
| PATCH | `/api/debts` | Update a single debt cell |
| POST | `/api/admin/verify` | Verify admin password |

## Project Structure

```
├── app/
│   ├── __init__.py       # Flask app factory
│   ├── models.py         # SQLite schema & helpers
│   ├── routes.py         # All REST API endpoints
│   ├── socketio_ext.py   # SocketIO instance
│   └── static/
│       ├── index.html    # SPA HTML
│       ├── app.js        # Frontend logic
│       └── style.css     # Dark-themed stylesheet
├── nginx/
│   └── nginx.conf        # nginx reverse proxy config
├── tests/
│   ├── test_victim_color.py
│   └── test_stats.py
├── docker-compose.yml
├── Dockerfile
├── run.py                # Entry point
├── requirements.txt
└── CHANGELOG.md
```
