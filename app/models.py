import sqlite3
from flask import g


def get_db(app):
    """Get the database connection for the current request context."""
    if 'db' not in g:
        g.db = sqlite3.connect(app.config['DATABASE'])
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA journal_mode=WAL')
        g.db.execute('PRAGMA foreign_keys=ON')
    return g.db


def close_db(e=None):
    """Close the database connection at the end of a request."""
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db(app):
    """Initialize the database schema."""
    with app.app_context():
        db = get_db(app)
        db.execute('''
            CREATE TABLE IF NOT EXISTS watchers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                points INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        ''')
        # Migration: add points column if upgrading from older schema
        try:
            db.execute('ALTER TABLE watchers ADD COLUMN points INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass  # column already exists
        # Migration: add punish_streak column if upgrading from older schema
        try:
            db.execute('ALTER TABLE watchers ADD COLUMN punish_streak INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass  # column already exists
        db.execute('''
            CREATE TABLE IF NOT EXISTS titles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                watcher_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                points INTEGER NOT NULL DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (watcher_id) REFERENCES watchers(id) ON DELETE CASCADE
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS winners (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title_name TEXT NOT NULL,
                watcher_name TEXT NOT NULL,
                weight INTEGER NOT NULL,
                total_weight INTEGER NOT NULL,
                participants TEXT DEFAULT '',
                won_at TEXT DEFAULT (datetime('now'))
            )
        ''')
        # Migration: add participants column if upgrading from older schema
        try:
            db.execute('ALTER TABLE winners ADD COLUMN participants TEXT DEFAULT ""')
        except sqlite3.OperationalError:
            pass
        db.execute('''
            CREATE TABLE IF NOT EXISTS thefts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thief_id INTEGER NOT NULL,
                victim_id INTEGER NOT NULL,
                amount INTEGER NOT NULL DEFAULT 1,
                stolen_at TEXT DEFAULT (datetime('now'))
            )
        ''')
        # Migration: add judgement column to winners
        try:
            db.execute('ALTER TABLE winners ADD COLUMN judgement TEXT DEFAULT ""')
        except sqlite3.OperationalError:
            pass
        db.commit()
    app.teardown_appcontext(close_db)
