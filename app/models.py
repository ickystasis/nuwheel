import os
import sqlite3
from flask import current_app, g

ACTIVE_CONNECTIONS = set()


def get_db(app):
    """Get the database connection for the current request context."""
    if 'db' not in g:
        conn = sqlite3.connect(app.config['DATABASE'], check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA journal_mode=DELETE')
        conn.execute('PRAGMA foreign_keys=ON')
        g.db = conn
        ACTIVE_CONNECTIONS.add(conn)
    return g.db


def close_db(e=None):
    """Close the database connection at the end of a request."""
    try:
        db = g.pop('db', None)
    except RuntimeError:
        db = None

    if db is not None:
        ACTIVE_CONNECTIONS.discard(db)
        try:
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        except sqlite3.OperationalError:
            pass
        try:
            db.close()
        except sqlite3.ProgrammingError:
            pass

    for conn in list(ACTIVE_CONNECTIONS):
        ACTIVE_CONNECTIONS.discard(conn)
        try:
            conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        except sqlite3.OperationalError:
            pass
        try:
            conn.close()
        except sqlite3.ProgrammingError:
            pass

    try:
        app = current_app._get_current_object()
    except RuntimeError:
        return

    for suffix in ('-wal', '-shm'):
        try:
            os.remove(app.config['DATABASE'] + suffix)
        except FileNotFoundError:
            pass
        except PermissionError:
            pass


def init_db(app):
    """Initialize the database schema."""
    with app.app_context():
        db = get_db(app)
        db.execute('''
            CREATE TABLE IF NOT EXISTS watchers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                points INTEGER NOT NULL DEFAULT 0,
                color TEXT NOT NULL DEFAULT '#4ECDC4',
                created_at TEXT DEFAULT (datetime('now'))
            )
        ''')
        # Migration: add points column if upgrading from older schema
        try:
            db.execute('ALTER TABLE watchers ADD COLUMN points INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass  # column already exists
        # Migration: add color column if upgrading from older schema
        try:
            db.execute("ALTER TABLE watchers ADD COLUMN color TEXT NOT NULL DEFAULT '#4ECDC4'")
        except sqlite3.OperationalError:
            pass  # column already exists
        # Migration: add punish_streak column if upgrading from older schema
        try:
            db.execute('ALTER TABLE watchers ADD COLUMN punish_streak INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass  # column already exists
        # Migration: add display_order column if upgrading from older schema
        try:
            db.execute('ALTER TABLE titles ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass  # column already exists
        # Migration: add archived column for soft-delete
        try:
            db.execute('ALTER TABLE titles ADD COLUMN archived INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass  # column already exists
        db.execute('''
            CREATE TABLE IF NOT EXISTS titles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                watcher_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                points REAL NOT NULL DEFAULT 1,
                display_order INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (watcher_id) REFERENCES watchers(id) ON DELETE CASCADE
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS winners (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title_name TEXT NOT NULL,
                watcher_name TEXT NOT NULL,
                weight REAL NOT NULL,
                total_weight REAL NOT NULL,
                participants TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                votes TEXT DEFAULT '{}',
                judgement TEXT DEFAULT '',
                won_at TEXT DEFAULT (datetime('now'))
            )
        ''')
        # Migration: add participants column if upgrading from older schema
        try:
            db.execute('ALTER TABLE winners ADD COLUMN participants TEXT DEFAULT ""')
        except sqlite3.OperationalError:
            pass
        # Migration: add status column if upgrading from older schema
        try:
            db.execute("ALTER TABLE winners ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
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
        # Migration: add votes column to winners
        try:
            db.execute('ALTER TABLE winners ADD COLUMN votes TEXT DEFAULT "{}"')
        except sqlite3.OperationalError:
            pass
        # Migration: add punish_streak column to winners
        try:
            db.execute('ALTER TABLE winners ADD COLUMN punish_streak INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass
        # Migration: add watcher_budget column to winners
        try:
            db.execute('ALTER TABLE winners ADD COLUMN watcher_budget INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass
        # Migration: add watcher_movie_count column to winners
        try:
            db.execute('ALTER TABLE winners ADD COLUMN watcher_movie_count INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass
        # Migration: add wheel_movies column to winners
        try:
            db.execute('ALTER TABLE winners ADD COLUMN wheel_movies TEXT DEFAULT "{}"')
        except sqlite3.OperationalError:
            pass
        # Migration: add avg_wheel_weight to watchers
        try:
            db.execute('ALTER TABLE watchers ADD COLUMN avg_wheel_weight REAL NOT NULL DEFAULT 6.0')
        except sqlite3.OperationalError:
            pass
        try:
            db.execute('ALTER TABLE watchers ADD COLUMN weight_samples INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass
        db.execute('''
            CREATE TABLE IF NOT EXISTS debts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                debtor_id INTEGER NOT NULL,
                creditor_id INTEGER NOT NULL,
                amount INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (debtor_id) REFERENCES watchers(id) ON DELETE CASCADE,
                FOREIGN KEY (creditor_id) REFERENCES watchers(id) ON DELETE CASCADE,
                UNIQUE(debtor_id, creditor_id)
            )
        ''')
        # Migration: add amount column as INTEGER if upgrading from REAL
        try:
            db.execute('ALTER TABLE debts ADD COLUMN amount INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass
        # Migration: debt ledger for audit trail
        db.execute('''
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS debt_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                debtor_id INTEGER NOT NULL,
                creditor_id INTEGER NOT NULL,
                delta INTEGER NOT NULL,
                remaining INTEGER NOT NULL,
                winner_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (debtor_id) REFERENCES watchers(id) ON DELETE CASCADE,
                FOREIGN KEY (creditor_id) REFERENCES watchers(id) ON DELETE CASCADE,
                FOREIGN KEY (winner_id) REFERENCES winners(id)
            )
        ''')
        db.commit()
    app.teardown_appcontext(close_db)
