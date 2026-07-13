# Wheel of Doom(b) — Project Guide for AI Agents

## Overview

A Flask-SocketIO web game where "watchers" add movie titles to a spinning wheel, allocate point budgets, spin to pick a winner, then vote to pass or punish (non-winners steal escalating points from repeat winners).

Points are computed from a **debt matrix**: each watcher starts at base 6 points. When a movie is punished, the winner incurs debt to each attendee. A watcher's effective points = 6 + debts owed to them - debts they owe. Points on the wheel = debts owed to a watcher by other present attendees.

## Tech Stack

- **Backend:** Python 3.12+, Flask 3.1, Flask-SocketIO 5.3, eventlet 0.36
- **Frontend:** Vanilla JS single-page app, HTML5 Canvas wheel, Socket.IO client
- **Database:** SQLite (file-based, `/data/wheel.db`)
- **Deployment:** Docker (python:3.12-alpine + nginx, port 9642)

## Project Structure

```
app/
  __init__.py       # Flask app factory, DB & SocketIO init
  models.py         # SQLite schema, get_db/close_db, init_db
  routes.py         # All REST API endpoints (/api/*)
  socketio_ext.py   # SocketIO instance (async_mode='threading')
  static/
    index.html      # SPA HTML
    app.js          # Frontend logic
    style.css       # Dark-themed stylesheet
tests/
  test_victim_color.py
  test_stats.py
run.py              # Entry point (eventlet monkey-patch + socketio.run)
```

## Key Commands

| Command | Purpose |
|---------|---------|
| `python run.py` | Dev server on `0.0.0.0:5000` |
| `python -m unittest discover tests` | Run all tests |
| `docker build -t wheel-of-doomb .` | Build image |
| `docker-compose up -d` | Deploy with nginx on port 9642 |

## Code Conventions

### Python
- **No docstrings** required on route handlers (brief comments OK)
- **No type annotations** — project uses plain Python with no type hints anywhere
- **Imports**: standard lib first, blank line, third-party, blank line, local
- **Line length**: ~100 chars (no explicit config, follow existing style)
- **Quotes**: single quotes for strings (`'text'`), double quotes only when needed (`"text 'nested'"`)
- **No f-strings** in SQL queries (use parameterized `?` placeholders only)
- **Error responses**: `return jsonify({'error': 'message'}), 4xx`
- **Success responses**: `return jsonify(payload), 2xx` or `return jsonify({'ok': True})`

### Route patterns
- All routes are on a single `Blueprint` named `'api'` with `url_prefix='/api'`
- Routes use `get_db(current_app)` for DB access and `socketio.emit(...)` after mutations
- Helper functions are prefixed with `_` (e.g. `_enforce_title_budget`, `_normalize_color`)
- Input validation: `request.get_json(silent=True)`, manual type checks, early returns with 400/404/409

### Debt Matrix System
- Every watcher has a **base of 6 points** (hardcoded `BASE_POINTS = 6`)
- `_compute_points(db, watcher_id, participant_ids)` computes effective points as `BASE_POINTS + owed_to - owed_by`
- `_all_points(db, participant_ids)` returns computed points for all watchers
- `GET /api/data` returns computed points (not stored `watchers.points`)
- **Punish**: winner incurs debt to each attendee via `debts` table (debtor=winner, creditor=attendee, amount+=streak+1)
- **Refund (process-win)**: clears all debts owed TO the winner by current participants
- **Pass**: just resets punish_streak to 0
- Points on Wheel for a present watcher = sum of debts where they are creditor and debtor is also present

### Database
- SQLite with `sqlite3.Row` row factory
- Schema migrations: idempotent `ALTER TABLE` wrapped in `try/except OperationalError`
- Tables: `watchers`, `titles`, `winners`, `thefts`, `debts`
  - `debts`: `debtor_id`, `creditor_id`, `amount INTEGER`
- Connection lifecycle: `get_db(app)` ties to Flask `g` context, `close_db` on teardown

### API Endpoints (debt-related)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/debts` | Full debt matrix (watchers + debts), auto-fills missing pairs |
| PATCH | `/api/debts` | Update a single debt cell `{debtor_id, creditor_id, amount}` |

### Frontend (JS)
- Vanilla JS, no frameworks
- Socket.IO client from CDN (`socket.io@4.7.5`)
- Canvas wheel rendering
- Debt matrix modal accessible via 💳 Debt Matrix button in top row

### Testing
- `unittest.TestCase` with `app.test_client()`
- Uses `tempfile.TemporaryDirectory()` for isolated DB per test
- Sets `os.environ['DB_DIR']` + `app.config['TESTING'] = True` in `setUp`

## Environment Variables
- `DB_DIR` — SQLite storage directory (default: `/data`)
- `ADMIN_PASSWORD` — Admin panel password (⚠️ CHANGE default `setadminpass` before deploying)
