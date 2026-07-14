import csv
import io
import json
import os
import random
import re
from flask import Blueprint, request, jsonify, current_app
from .models import get_db
from .socketio_ext import socketio

bp = Blueprint('api', __name__, url_prefix='/api')
BASE_POINTS = 6


def _consume_debt_entries(db, debtor_id, creditor_id, total_amount):
    """FIFO: mark oldest active punish entries as consumed up to total_amount."""
    entries = db.execute(
        'SELECT id, remaining FROM debt_ledger '
        'WHERE debtor_id = ? AND creditor_id = ? AND event_type = ? AND remaining > 0 '
        'ORDER BY created_at ASC, id ASC',
        (debtor_id, creditor_id, 'punish')
    ).fetchall()
    to_consume = total_amount
    for entry in entries:
        if to_consume <= 0:
            break
        consume = min(entry['remaining'], to_consume)
        db.execute('UPDATE debt_ledger SET remaining = remaining - ? WHERE id = ?',
                   (consume, entry['id']))
        to_consume -= consume


def _compute_points(db, watcher_id, participant_ids=None):
    """Compute effective points for a watcher: 6 + debts owed to them - debts they owe."""
    if participant_ids is None:
        participant_ids = [r['id'] for r in db.execute('SELECT id FROM watchers').fetchall()]
    if not participant_ids:
        return BASE_POINTS
    placeholders = ','.join('?' * len(participant_ids))
    owed_to = db.execute(
        f'SELECT COALESCE(SUM(amount), 0) FROM debts WHERE creditor_id = ? AND debtor_id IN ({placeholders})',
        [watcher_id] + participant_ids
    ).fetchone()[0] or 0
    owed_by = db.execute(
        f'SELECT COALESCE(SUM(amount), 0) FROM debts WHERE debtor_id = ? AND creditor_id IN ({placeholders})',
        [watcher_id] + participant_ids
    ).fetchone()[0] or 0
    return max(1, BASE_POINTS + owed_to - owed_by)


def _all_points(db, participant_ids=None):
    """Return a dict of {watcher_id: computed_points} for all watchers."""
    if participant_ids is None:
        participant_ids = [r['id'] for r in db.execute('SELECT id FROM watchers').fetchall()]
    watchers = db.execute('SELECT id FROM watchers').fetchall()
    return {w['id']: _compute_points(db, w['id'], participant_ids) for w in watchers}


def _record_wheel_weights(db, participant_ids):
    """Update avg_wheel_weight for all participants based on current wheel state."""
    for pid in participant_ids:
        pts = _compute_points(db, pid, participant_ids)
        row = db.execute('SELECT avg_wheel_weight, weight_samples FROM watchers WHERE id = ?', (pid,)).fetchone()
        if not row:
            continue
        avg = row['avg_wheel_weight']
        n = row['weight_samples']
        new_avg = round((avg * n + pts) / (n + 1), 2)
        db.execute('UPDATE watchers SET avg_wheel_weight = ?, weight_samples = ? WHERE id = ?',
                   (new_avg, n + 1, pid))


def _enforce_title_budget(db, watcher_id, points, exclude_title_id=None):
    """Clamp title points to fit within the watcher's personal point budget."""
    watcher = db.execute('SELECT points FROM watchers WHERE id = ?', (watcher_id,)).fetchone()
    if not watcher:
        return points
    if exclude_title_id:
        other_total = db.execute(
            'SELECT COALESCE(SUM(points), 0) as t FROM titles WHERE watcher_id = ? AND id != ?',
            (watcher_id, exclude_title_id)
        ).fetchone()['t']
    else:
        other_total = db.execute(
            'SELECT COALESCE(SUM(points), 0) as t FROM titles WHERE watcher_id = ?',
            (watcher_id,)
        ).fetchone()['t']
    personal_budget = max(1, watcher['points'])
    remaining = personal_budget - other_total
    if remaining < 0:
        remaining = 0
    return round(min(points, remaining), 2)


def reshuffle_title_order(db):
    """Randomize display_order for all titles so no one user's titles are clumped."""
    rows = db.execute('SELECT id FROM titles ORDER BY id').fetchall()
    ids = [r['id'] for r in rows]
    random.shuffle(ids)
    for i, tid in enumerate(ids):
        db.execute('UPDATE titles SET display_order = ? WHERE id = ?', (i, tid))


def _normalize_color(color_value):
    """Return a safe hex color string for a victim."""
    if not color_value:
        return '#4ECDC4'
    color = str(color_value).strip().lower()
    if re.fullmatch(r'#[0-9a-f]{6}', color):
        return color
    return '#4ECDC4'


# ── Data ──

@bp.route('/data', methods=['GET'])
def get_data():
    """Get all watchers with their titles and computed points.

    Query params:
        active_ids (optional) — comma-separated watcher IDs to limit debt computation to present watchers.
    """
    db = get_db(current_app)
    watchers = db.execute('SELECT id, name, points, color, punish_streak FROM watchers ORDER BY created_at ASC').fetchall()
    all_ids = [w['id'] for w in watchers]
    active_param = request.args.get('active_ids', '')
    if active_param:
        try:
            participant_ids = [int(x) for x in active_param.split(',') if x.strip()]
            participant_ids = [pid for pid in participant_ids if pid in all_ids]
        except (ValueError, TypeError):
            participant_ids = all_ids
    else:
        stored = db.execute('SELECT value FROM app_settings WHERE key = ?', ('active_ids',)).fetchone()
        if stored:
            try:
                participant_ids = json.loads(stored['value'])
                participant_ids = [pid for pid in participant_ids if pid in all_ids]
            except (json.JSONDecodeError, TypeError):
                participant_ids = all_ids
        else:
            participant_ids = all_ids
    pts = _all_points(db, participant_ids)
    result = []
    name_map = {w['id']: w['name'] for w in watchers}
    for w in watchers:
        titles = db.execute(
            'SELECT id, name, points, display_order FROM titles WHERE watcher_id = ? ORDER BY display_order ASC',
            (w['id'],)
        ).fetchall()
        # Debt breakdown for tooltip (only present watchers)
        p_placeholders = ','.join('?' * len(participant_ids))
        owed_to_rows = db.execute(
            f'SELECT debtor_id, amount FROM debts WHERE creditor_id = ? AND debtor_id IN ({p_placeholders}) AND amount > 0',
            [w['id']] + participant_ids
        ).fetchall()
        owed_by_rows = db.execute(
            f'SELECT creditor_id, amount FROM debts WHERE debtor_id = ? AND creditor_id IN ({p_placeholders}) AND amount > 0',
            [w['id']] + participant_ids
        ).fetchall()
        def _get_entries(debtor_id, creditor_id):
            rows = db.execute(
                'SELECT l.delta, l.remaining, l.winner_id, w.title_name, w.won_at '
                'FROM debt_ledger l JOIN winners w ON l.winner_id = w.id '
                'WHERE l.debtor_id = ? AND l.creditor_id = ? AND l.event_type = ? AND l.remaining > 0 '
                'ORDER BY l.created_at ASC, l.id ASC',
                (debtor_id, creditor_id, 'punish')
            ).fetchall()
            return [{'title': r['title_name'], 'won_at': r['won_at'], 'delta': r['delta'], 'remaining': r['remaining']} for r in rows]
        # Punish history for streak tooltip (only punishes in current streak)
        punish_rows = []
        if w['punish_streak'] > 0:
            punish_rows = db.execute(
                'SELECT title_name, won_at FROM winners '
                'WHERE watcher_name = ? AND judgement = ? '
                'ORDER BY won_at DESC LIMIT ?',
                (w['name'], 'punish', w['punish_streak'])
            ).fetchall()
        result.append({
            'id': w['id'],
            'name': w['name'],
            'points': pts[w['id']],
            'base_points': w['points'],
            'color': w['color'] or '#4ECDC4',
            'punish_streak': w['punish_streak'],
            'punish_history': [{'title': r['title_name'], 'won_at': r['won_at']} for r in punish_rows],
            'titles': [dict(t) for t in titles],
            'owed_to': [{'name': name_map[r['debtor_id']], 'amount': r['amount'], 'entries': _get_entries(r['debtor_id'], w['id'])} for r in owed_to_rows],
            'owed_by': [{'name': name_map[r['creditor_id']], 'amount': r['amount'], 'entries': _get_entries(w['id'], r['creditor_id'])} for r in owed_by_rows],
        })
    return jsonify(result)


# ── Settings ──

@bp.route('/settings', methods=['GET'])
def get_settings():
    db = get_db(current_app)
    rows = db.execute('SELECT key, value FROM app_settings').fetchall()
    settings = {}
    for row in rows:
        key = row['key']
        val = row['value']
        if key in ('spin_settings', 'active_ids'):
            try:
                settings[key] = json.loads(val)
            except (json.JSONDecodeError, TypeError):
                settings[key] = val
        else:
            settings[key] = val
    return jsonify(settings)


@bp.route('/settings', methods=['PUT'])
def update_settings():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    db = get_db(current_app)
    for key, val in data.items():
        if val is None:
            db.execute('DELETE FROM app_settings WHERE key = ?', (key,))
        else:
            str_val = val if isinstance(val, str) else json.dumps(val)
            db.execute('''INSERT INTO app_settings (key, value) VALUES (?, ?)
                          ON CONFLICT(key) DO UPDATE SET value = excluded.value''', (key, str_val))
    db.commit()
    socketio.emit('settings_updated', data)
    return jsonify({'ok': True})


# ── Watchers ──

@bp.route('/watchers', methods=['POST'])
def add_watcher():
    """Create a new watcher."""
    data = request.get_json(silent=True)
    if not data or not data.get('name', '').strip():
        return jsonify({'error': 'Watcher name is required'}), 400

    name = data['name'].strip()
    if len(name) > 100:
        return jsonify({'error': 'Name too long (max 100 chars)'}), 400

    color = _normalize_color(data.get('color'))

    db = get_db(current_app)

    # Check for duplicate name (case-insensitive)
    existing = db.execute('SELECT id FROM watchers WHERE LOWER(name) = LOWER(?)', (name,)).fetchone()
    if existing:
        return jsonify({'error': f'A watcher named "{name}" already exists'}), 409

    db.execute('INSERT INTO watchers (name, points, color) VALUES (?, ?, ?)', (name, BASE_POINTS, color))
    new_id = db.execute('SELECT last_insert_rowid() as id').fetchone()['id']

    # Create debt entries for all existing watchers
    existing = db.execute('SELECT id FROM watchers WHERE id != ?', (new_id,)).fetchall()
    for w in existing:
        db.execute('INSERT INTO debts (debtor_id, creditor_id, amount) VALUES (?, ?, 0)', (new_id, w['id']))
        db.execute('INSERT INTO debts (debtor_id, creditor_id, amount) VALUES (?, ?, 0)', (w['id'], new_id))

    db.commit()
    socketio.emit('data_changed', {})
    row = db.execute('SELECT id, name, points, color FROM watchers WHERE id = ?', (new_id,)).fetchone()
    return jsonify({'id': row['id'], 'name': row['name'], 'points': row['points'], 'color': row['color'], 'titles': []}), 201


@bp.route('/watchers/<int:watcher_id>', methods=['DELETE'])
def delete_watcher(watcher_id):
    """Remove a watcher and all their titles."""
    db = get_db(current_app)
    db.execute('DELETE FROM titles WHERE watcher_id = ?', (watcher_id,))
    db.execute('DELETE FROM watchers WHERE id = ?', (watcher_id,))
    reshuffle_title_order(db)
    db.commit()
    socketio.emit('data_changed', {})
    return jsonify({'ok': True})


@bp.route('/watchers/<int:watcher_id>/points', methods=['PATCH'])
def update_watcher_points(watcher_id):
    """Adjust a watcher's points by a delta (+1, -2, etc.)."""
    data = request.get_json(silent=True)
    if not data or 'delta' not in data:
        return jsonify({'error': 'delta is required'}), 400

    try:
        delta = int(data['delta'])
    except (TypeError, ValueError):
        return jsonify({'error': 'delta must be a number'}), 400

    db = get_db(current_app)
    current = db.execute('SELECT points FROM watchers WHERE id = ?', (watcher_id,)).fetchone()
    if not current:
        return jsonify({'error': 'Watcher not found'}), 404

    new_points = current['points'] + delta
    if new_points > 9999:
        return jsonify({'error': 'Points cannot exceed 9999'}), 400

    db.execute('UPDATE watchers SET points = ? WHERE id = ?', (new_points, watcher_id))
    db.commit()
    socketio.emit('data_changed', {})
    return jsonify({'id': watcher_id, 'points': new_points, 'delta': delta})


@bp.route('/watchers/<int:watcher_id>/color', methods=['PATCH'])
def update_watcher_color(watcher_id):
    """Update a victim's color."""
    data = request.get_json(silent=True) or {}
    color = _normalize_color(data.get('color'))
    db = get_db(current_app)
    current = db.execute('SELECT id FROM watchers WHERE id = ?', (watcher_id,)).fetchone()
    if not current:
        return jsonify({'error': 'Watcher not found'}), 404
    db.execute('UPDATE watchers SET color = ? WHERE id = ?', (color, watcher_id))
    db.commit()
    socketio.emit('data_changed', {})
    return jsonify({'id': watcher_id, 'color': color})


# ── Titles ──

@bp.route('/titles', methods=['POST'])
def add_title():
    """Add a title to a watcher (max 3 per watcher)."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Title name is required'}), 400
    if len(name) > 200:
        return jsonify({'error': 'Title too long (max 200 chars)'}), 400

    watcher_id = data.get('watcher_id')
    if not watcher_id:
        return jsonify({'error': 'watcher_id is required'}), 400

    try:
        points = float(data.get('points', 1))
    except (TypeError, ValueError):
        return jsonify({'error': 'Points must be a number'}), 400
    if points < 0.1:
        return jsonify({'error': 'Points must be at least 0.1'}), 400

    db = get_db(current_app)

    count = db.execute(
        'SELECT COUNT(*) as c FROM titles WHERE watcher_id = ?', (watcher_id,)
    ).fetchone()['c']
    if count >= 3:
        return jsonify({'error': 'Maximum 3 titles per watcher'}), 409

    db.execute('INSERT INTO titles (watcher_id, name, points) VALUES (?, ?, ?)',
               (watcher_id, name, points))
    reshuffle_title_order(db)
    db.commit()
    socketio.emit('data_changed', {})
    row = db.execute('SELECT id, watcher_id, name, points FROM titles WHERE id = last_insert_rowid()').fetchone()
    return jsonify(dict(row)), 201


@bp.route('/titles/<int:title_id>', methods=['PUT'])
def update_title(title_id):
    """Update a title's name or points."""
    data = request.get_json(silent=True) or {}
    db = get_db(current_app)
    updates = []
    params = []

    if 'name' in data:
        name = data['name'].strip()
        if not name:
            return jsonify({'error': 'Title name cannot be empty'}), 400
        if len(name) > 200:
            return jsonify({'error': 'Title too long'}), 400
        updates.append('name = ?')
        params.append(name)

    if 'points' in data:
        try:
            points = float(data['points'])
        except (TypeError, ValueError):
            return jsonify({'error': 'Points must be a number'}), 400
        if points < 0.1:
            return jsonify({'error': 'Points must be at least 0.1'}), 400

        updates.append('points = ?')
        params.append(points)

    if not updates:
        return jsonify({'error': 'Nothing to update'}), 400

    params.append(title_id)
    db.execute(f'UPDATE titles SET {", ".join(updates)} WHERE id = ?', params)
    db.commit()
    socketio.emit('data_changed', {})
    row = db.execute('SELECT id, watcher_id, name, points FROM titles WHERE id = ?', (title_id,)).fetchone()
    return jsonify(dict(row))


@bp.route('/titles/shuffle', methods=['POST'])
def shuffle_titles():
    """Shuffle title display order for the current wheel layout."""
    db = get_db(current_app)
    reshuffle_title_order(db)
    db.commit()
    socketio.emit('data_changed', {})
    return jsonify({'ok': True})


@bp.route('/titles/<int:title_id>', methods=['DELETE'])
def delete_title(title_id):
    """Remove a title."""
    db = get_db(current_app)
    db.execute('DELETE FROM titles WHERE id = ?', (title_id,))
    reshuffle_title_order(db)
    db.commit()
    socketio.emit('data_changed', {})
    return jsonify({'ok': True})


# ── Winners ──

@bp.route('/winners', methods=['GET'])
def list_winners():
    """Get all previous winners, newest first."""
    db = get_db(current_app)
    rows = db.execute(
        'SELECT id, title_name, watcher_name, weight, total_weight, participants, status, judgement, votes, won_at, punish_streak, watcher_budget, watcher_movie_count, wheel_movies '
        'FROM winners ORDER BY won_at DESC'
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@bp.route('/winners', methods=['POST'])
def save_winner():
    """Record a new winner."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    title_name = data.get('title_name', '').strip()
    watcher_name = data.get('watcher_name', '').strip()
    if not title_name or not watcher_name:
        return jsonify({'error': 'title_name and watcher_name are required'}), 400

    try:
        weight = int(data.get('weight', 0))
        total_weight = int(data.get('total_weight', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'weight and total_weight must be numbers'}), 400

    participants = data.get('participants', '')
    if not isinstance(participants, str):
        participants = ', '.join(participants) if isinstance(participants, list) else ''

    status = str(data.get('status', 'active')).strip().lower()
    if status not in ('active', 'disabled'):
        status = 'active'

    watcher_budget = int(data.get('watcher_budget', 0) or 0)
    watcher_movie_count = int(data.get('watcher_movie_count', 0) or 0)
    wheel_movies = data.get('wheel_movies', '{}')

    db = get_db(current_app)
    import json
    if isinstance(wheel_movies, dict):
        wheel_movies = json.dumps(wheel_movies)
    db.execute(
        'INSERT INTO winners (title_name, watcher_name, weight, total_weight, participants, status, watcher_budget, watcher_movie_count, wheel_movies) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (title_name, watcher_name, weight, total_weight, participants, status, watcher_budget, watcher_movie_count, wheel_movies)
    )
    db.commit()
    socketio.emit('winners_changed', {})
    row = db.execute('SELECT id, title_name, watcher_name, weight, total_weight, participants, won_at FROM winners WHERE id = last_insert_rowid()').fetchone()
    return jsonify(dict(row)), 201


@bp.route('/winners', methods=['DELETE'])
def clear_winners():
    """Delete all winner history."""
    db = get_db(current_app)
    db.execute('DELETE FROM winners')
    db.commit()
    socketio.emit('winners_changed', {})
    return jsonify({'ok': True})


@bp.route('/winners/<int:winner_id>/judgement', methods=['PATCH'])
def set_winner_judgement(winner_id):
    """Set the pass/punish judgement for a winner."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    judgement = data.get('judgement', '').strip().lower()
    if judgement not in ('pass', 'punish', ''):
        return jsonify({'error': 'Judgement must be "pass", "punish", or empty'}), 400

    db = get_db(current_app)
    db.execute('UPDATE winners SET judgement = ? WHERE id = ?', (judgement, winner_id))
    db.commit()
    socketio.emit('winners_changed', {})
    return jsonify({'ok': True, 'judgement': judgement, 'winner_id': winner_id})


@bp.route('/winners/<int:winner_id>', methods=['PATCH'])
def update_winner(winner_id):
    """Update arbitrary fields on a winner record."""
    data = request.get_json(silent=True) or {}
    db = get_db(current_app)
    allowed = {'title_name', 'watcher_name', 'weight', 'total_weight', 'judgement', 'votes'}
    sets = []
    vals = []
    for key in allowed:
        if key in data:
            sets.append(f'{key} = ?')
            vals.append(data[key])
    if not sets:
        return jsonify({'error': 'No valid fields to update'}), 400
    vals.append(winner_id)
    db.execute(f'UPDATE winners SET {", ".join(sets)} WHERE id = ?', vals)
    db.commit()
    socketio.emit('winners_changed', {})
    return jsonify({'ok': True, 'winner_id': winner_id})


@bp.route('/winners/<int:winner_id>/status', methods=['PATCH'])
def set_winner_status(winner_id):
    """Toggle a winner record between active and disabled."""
    data = request.get_json(silent=True) or {}
    status = str(data.get('status', 'active')).strip().lower()
    if status not in ('active', 'disabled'):
        return jsonify({'error': 'status must be active or disabled'}), 400
    db = get_db(current_app)
    db.execute('UPDATE winners SET status = ? WHERE id = ?', (status, winner_id))
    db.commit()
    socketio.emit('winners_changed', {})
    return jsonify({'ok': True, 'status': status, 'winner_id': winner_id})


@bp.route('/winners/import', methods=['POST'])
def import_winners():
    """Import legacy winner history from CSV data."""
    data = request.get_json(silent=True) or {}
    payload = data.get('csv', '')
    if not payload:
        return jsonify({'error': 'csv payload is required'}), 400

    # Split into non-blank lines, skip blanks
    all_lines = [l for l in payload.split('\n') if l.strip()]
    if len(all_lines) < 2:
        return jsonify({'error': 'Need at least a header row and one data row'}), 400

    header_line = all_lines[0].strip()
    norm_headers = [h.strip().lower() for h in next(csv.reader([header_line]))]

    data_payload = '\n'.join(all_lines[1:])
    reader = csv.DictReader(io.StringIO(data_payload), fieldnames=norm_headers)

    known_cols = {'date', 'title_name', 'movie', 'name', 'watcher_name', 'proposer', 'winner',
                  'weight', 'points', 'total_weight', 'total_points', 'punish', 'status',
                  'participants', 'victims', 'max_weight', 'max', 'streak'}
    voter_cols = [c for c in norm_headers if c not in known_cols and c != '']

    inserted = []
    errors = []
    import json
    db = get_db(current_app)
    for i, row in enumerate(reader, start=2):
        row_errors = []

        title_name = (row.get('title_name') or row.get('movie') or row.get('name') or '').strip()
        watcher_name = (row.get('watcher_name') or row.get('proposer') or row.get('winner') or '').strip()

        if not title_name:
            row_errors.append('title_name (or movie/name) is required')
        if not watcher_name:
            row_errors.append('watcher_name (or proposer/winner) is required')
        if row_errors:
            errors.append({'row': i, 'title': title_name or '(empty)', 'errors': row_errors})
            continue

        try:
            weight = int(row.get('weight') or row.get('points') or 0) or 0
        except (ValueError, TypeError):
            weight = 0

        try:
            total_weight = int(row.get('total_weight') or row.get('total_points') or row.get('max_weight') or row.get('max') or 0) or 0
        except (ValueError, TypeError):
            total_weight = 0

        punish_raw = str(row.get('punish') or '').strip().lower()
        judgement = 'punish' if punish_raw in ('y', 'yes', 'true', '1') else ('pass' if punish_raw in ('n', 'no', 'false', '0') else '')

        won_at = (row.get('date') or '').strip()

        votes = {}
        for voter in voter_cols:
            val = str(row.get(voter) or '').strip().lower()
            is_proposer = (voter.lower() == watcher_name.lower())
            if is_proposer:
                # Proposer can only vote Punish or NA per Charter
                if val in ('na', 'n', 'no', 'pass', '0'):
                    votes[voter] = 'na'
                elif val in ('y', 'yes', 'punish', '1'):
                    votes[voter] = 'punish'
            else:
                if val in ('y', 'yes', 'punish', '1'):
                    votes[voter] = 'punish'
                elif val in ('n', 'no', 'pass', '0'):
                    votes[voter] = 'pass'

        votes_json = json.dumps(votes) if votes else '{}'
        # Build participants string from voter names for attendance tracking
        participants = ', '.join(voter_cols)
        db.execute(
            'INSERT INTO winners (title_name, watcher_name, weight, total_weight, participants, status, judgement, votes, won_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (title_name, watcher_name, weight, total_weight, participants, 'active', judgement, votes_json, won_at if won_at else None)
        )
        inserted.append({'title_name': title_name, 'watcher_name': watcher_name})

    if inserted:
        db.commit()
        socketio.emit('winners_changed', {})

    return jsonify({
        'ok': True,
        'inserted': inserted,
        'errors': errors,
        'total': len(inserted) + len(errors),
        'succeeded': len(inserted),
    })


@bp.route('/stats', methods=['GET'])
def get_stats():
    """Return aggregate stats for active history entries."""
    from datetime import datetime, timedelta
    db = get_db(current_app)
    rows = db.execute(
        "SELECT id, title_name, watcher_name, weight, total_weight, participants, status, judgement, votes, won_at "
        "FROM winners WHERE status != 'disabled' ORDER BY won_at DESC"
    ).fetchall()

    cutoff = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')
    recent_rows = [r for r in rows if r['won_at'] and r['won_at'] >= cutoff]

    watchers = db.execute('SELECT id, name, avg_wheel_weight FROM watchers ORDER BY created_at ASC').fetchall()

    def compute_stats_for_rows(source_rows):
        total = len(source_rows)
        result = []
        for watcher in watchers:
            name = watcher['name']
            name_lower = name.lower()
            wid = str(watcher['id'])
            attendance_count = 0
            pick_count = 0
            punish_count = 0
            punish_vote_count = 0
            for row in source_rows:
                participants = [p.strip() for p in (row['participants'] or '').split(',') if p.strip()]
                # Parse votes
                votes_dict = {}
                if row['votes']:
                    try:
                        v = json.loads(row['votes']) if isinstance(row['votes'], str) else row['votes']
                        if isinstance(v, dict):
                            votes_dict = v
                    except (json.JSONDecodeError, TypeError):
                        pass
                # Attendance: must be in participants AND (if votes exist) have a vote entry
                in_participants = name_lower in (p.lower() for p in participants)
                has_vote = name_lower in votes_dict or wid in votes_dict
                if in_participants and (not votes_dict or has_vote):
                    attendance_count += 1
                if (row['watcher_name'] or '').lower() == name_lower:
                    pick_count += 1
                if row['judgement'] == 'punish' and (row['watcher_name'] or '').lower() == name_lower:
                    punish_count += 1
                # Count votes to punish
                for voter_key, vote_val in votes_dict.items():
                    if vote_val == 'punish' and (voter_key.lower() == name_lower or voter_key == wid):
                        punish_vote_count += 1
            result.append({
                'attendance_count': attendance_count,
                'pick_count': pick_count,
                'punish_count': punish_count,
                'punish_vote_count': punish_vote_count,
                'avg_wheel_weight': watcher['avg_wheel_weight'],
                'attendance_pct': round(attendance_count / max(1, total) * 100, 1) if total else 0.0,
                'pick_pct': round(pick_count / max(1, total) * 100, 1) if total else 0.0,
                'adjusted_pick_pct': round(pick_count / max(1, attendance_count) * 100, 1) if attendance_count else 0.0,
                'punish_pct': round(punish_count / max(1, pick_count) * 100, 1) if pick_count else 0.0,
                'punish_vote_pct': round(punish_vote_count / max(1, attendance_count) * 100, 1) if attendance_count else 0.0,
            })
        return result, total

    all_stats, total_sessions = compute_stats_for_rows(rows)
    recent_stats, recent_total = compute_stats_for_rows(recent_rows)

    # Attach names/ids to each stat entry
    for i, watcher in enumerate(watchers):
        all_stats[i]['id'] = watcher['id']
        all_stats[i]['name'] = watcher['name']
        recent_stats[i]['id'] = watcher['id']
        recent_stats[i]['name'] = watcher['name']

    return jsonify({
        'total_active_sessions': total_sessions,
        'cutoff_date': cutoff,
        'recent_total_sessions': recent_total,
        'watchers': all_stats,
        'recent_watchers': recent_stats,
    })


@bp.route('/winners/<int:winner_id>/verdict', methods=['PATCH'])
def set_winner_verdict(winner_id):
    """Set the judgement and per-watcher votes for a winner.
    
    Body: {judgement: 'pass'|'punish', votes: {watcher_id_str: 'pass'|'punish', ...}}
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    judgement = data.get('judgement', '').strip().lower()
    if judgement not in ('pass', 'punish'):
        return jsonify({'error': 'Judgement must be "pass" or "punish"'}), 400

    votes = data.get('votes', {})
    import json
    votes_json = json.dumps(votes)

    db = get_db(current_app)
    db.execute('UPDATE winners SET judgement = ?, votes = ? WHERE id = ?',
               (judgement, votes_json, winner_id))
    db.commit()
    socketio.emit('winners_changed', {})
    return jsonify({'ok': True, 'judgement': judgement, 'winner_id': winner_id, 'votes': votes})


# ── Spin / Punish / Return ──

@bp.route('/spin/process-win', methods=['POST'])
def process_win():
    """Refund: clear all debts owed TO the winner by current participants."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    winner_id = data.get('winner_id')
    participant_ids = data.get('participant_ids', [])
    winner_record_id = data.get('winner_record_id')
    if not winner_id or not participant_ids:
        return jsonify({'error': 'winner_id and participant_ids required'}), 400

    db = get_db(current_app)

    # Record wheel weights for all participants BEFORE modifying any debts
    _record_wheel_weights(db, participant_ids)

    placeholders = ','.join('?' * len(participant_ids))

    # Find debts owed TO the winner by current participants
    cleared = []
    debts = db.execute(
        f'SELECT debtor_id, amount FROM debts WHERE creditor_id = ? AND debtor_id IN ({placeholders}) AND amount != 0',
        [winner_id] + participant_ids
    ).fetchall()
    for d in debts:
        debtor = db.execute('SELECT name FROM watchers WHERE id = ?', (d['debtor_id'],)).fetchone()
        if debtor:
            cleared.append({'debtor_name': debtor['name'], 'debtor_id': d['debtor_id'], 'amount': d['amount']})
        db.execute(
            'UPDATE debts SET amount = 0 WHERE debtor_id = ? AND creditor_id = ?',
            (d['debtor_id'], winner_id)
        )
        # Ledger: record the refund and consume oldest punish entries
        if d['amount'] > 0 and winner_record_id:
            db.execute(
                'INSERT INTO debt_ledger (debtor_id, creditor_id, delta, remaining, winner_id, event_type) '
                'VALUES (?, ?, ?, 0, ?, ?)',
                (d['debtor_id'], winner_id, -d['amount'], winner_record_id, 'refund')
            )
            _consume_debt_entries(db, d['debtor_id'], winner_id, d['amount'])

    db.commit()
    socketio.emit('data_changed', {})
    return jsonify({'cleared': cleared, 'winner_id': winner_id})


@bp.route('/spin/punish', methods=['POST'])
def punish_movie():
    """Winner incurs debt to each non-winner: (streak+1) points per attendee. Streak increments."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    winner_id = data.get('winner_id')
    participant_ids = data.get('participant_ids', [])
    if not winner_id or not participant_ids:
        return jsonify({'error': 'winner_id and participant_ids required'}), 400

    winner_record_id = data.get('winner_record_id')

    db = get_db(current_app)

    winner = db.execute('SELECT id, name, punish_streak FROM watchers WHERE id = ?', (winner_id,)).fetchone()
    if not winner:
        return jsonify({'error': 'Winner not found'}), 404

    streak = winner['punish_streak']
    multiplier = streak + 1

    stolen_from = []
    total_theft = 0

    for pid in participant_ids:
        if pid == winner_id:
            continue

        participant = db.execute('SELECT name FROM watchers WHERE id = ?', (pid,)).fetchone()
        if not participant:
            continue

        # Winner incurs debt to this participant
        existing = db.execute(
            'SELECT id, amount FROM debts WHERE debtor_id = ? AND creditor_id = ?',
            (winner_id, pid)
        ).fetchone()
        prev_debt = existing['amount'] if existing else 0
        new_total = prev_debt + multiplier
        if existing:
            db.execute('UPDATE debts SET amount = ? WHERE debtor_id = ? AND creditor_id = ?',
                       (new_total, winner_id, pid))
        else:
            db.execute('INSERT INTO debts (debtor_id, creditor_id, amount) VALUES (?, ?, ?)',
                       (winner_id, pid, multiplier))

        # Ledger: record this punish entry
        if winner_record_id:
            db.execute(
                'INSERT INTO debt_ledger (debtor_id, creditor_id, delta, remaining, winner_id, event_type) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                (winner_id, pid, multiplier, multiplier, winner_record_id, 'punish')
            )

        stolen_from.append({
            'thief_name': participant['name'],
            'thief_id': pid,
            'amount': multiplier,
            'total_debt': new_total,
        })
        total_theft += multiplier

    # Increment punish streak
    db.execute('UPDATE watchers SET punish_streak = ? WHERE id = ?', (streak + 1, winner_id))

    # Save punish_streak to winner record
    if winner_record_id:
        db.execute('UPDATE winners SET punish_streak = ? WHERE id = ?', (streak + 1, winner_record_id))

    db.commit()
    socketio.emit('data_changed', {})

    return jsonify({
        'stolen_from': stolen_from,
        'total_theft': total_theft,
        'multiplier': multiplier,
        'winner_id': winner_id,
    })


@bp.route('/spin/abort', methods=['POST'])
def abort_session():
    """Mark a winner record as aborted (disabled, no active verdict)."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    winner_record_id = data.get('winner_record_id')
    if not winner_record_id:
        return jsonify({'error': 'winner_record_id required'}), 400

    db = get_db(current_app)
    existing = db.execute('SELECT id FROM winners WHERE id = ?', (winner_record_id,)).fetchone()
    if not existing:
        return jsonify({'error': 'Winner record not found'}), 404

    db.execute(
        'UPDATE winners SET judgement = ?, status = ? WHERE id = ?',
        ('aborted', 'disabled', winner_record_id)
    )
    db.commit()
    socketio.emit('winners_changed', {})
    return jsonify({'ok': True, 'winner_id': winner_record_id})


@bp.route('/spin/pass', methods=['POST'])
def pass_movie():
    """Reset the watcher's punish streak to 0 and clear all debts the winner owes."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    winner_id = data.get('winner_id')
    if not winner_id:
        return jsonify({'error': 'winner_id required'}), 400

    participant_ids = data.get('participant_ids', [])

    db = get_db(current_app)

    winner = db.execute('SELECT id, name, punish_streak FROM watchers WHERE id = ?', (winner_id,)).fetchone()
    if not winner:
        return jsonify({'error': 'Winner not found'}), 404

    streak = winner['punish_streak']
    winner_record_id = data.get('winner_record_id')
    process_win_cleared = data.get('process_win_cleared', [])

    # Clear all debts involving the winner (both directions)
    returned_to = []
    points_saved = 0
    # Include debts already cleared by process-win
    for item in process_win_cleared:
        returned_to.append({'name': item.get('debtor_name', '?'), 'amount': item.get('amount', 0), 'total_debt': 0})
        points_saved += item.get('amount', 0)

    if participant_ids:
        placeholders = ','.join('?' * len(participant_ids))
        # Debts the winner owes to others (winner is debtor)
        debts_owed = db.execute(
            f'SELECT creditor_id, amount FROM debts WHERE debtor_id = ? AND creditor_id IN ({placeholders}) AND amount != 0',
            [winner_id] + participant_ids
        ).fetchall()
        # Debts others owe to the winner (winner is creditor)
        debts_owed_to = db.execute(
            f'SELECT debtor_id, amount FROM debts WHERE creditor_id = ? AND debtor_id IN ({placeholders}) AND amount != 0',
            [winner_id] + participant_ids
        ).fetchall()
        for d in debts_owed:
            creditor = db.execute('SELECT name FROM watchers WHERE id = ?', (d['creditor_id'],)).fetchone()
            if creditor:
                returned_to.append({'name': creditor['name'], 'amount': d['amount'], 'total_debt': 0})
                points_saved += d['amount']
            db.execute(
                'UPDATE debts SET amount = 0 WHERE debtor_id = ? AND creditor_id = ?',
                (winner_id, d['creditor_id'])
            )
            if winner_record_id:
                db.execute(
                    'INSERT INTO debt_ledger (debtor_id, creditor_id, delta, remaining, winner_id, event_type) '
                    'VALUES (?, ?, ?, 0, ?, ?)',
                    (winner_id, d['creditor_id'], -d['amount'], winner_record_id, 'refund')
                )
                _consume_debt_entries(db, winner_id, d['creditor_id'], d['amount'])
        for d in debts_owed_to:
            debtor = db.execute('SELECT name FROM watchers WHERE id = ?', (d['debtor_id'],)).fetchone()
            if debtor:
                returned_to.append({'name': debtor['name'], 'amount': d['amount'], 'total_debt': 0})
                points_saved += d['amount']
            db.execute(
                'UPDATE debts SET amount = 0 WHERE debtor_id = ? AND creditor_id = ?',
                (d['debtor_id'], winner_id)
            )
            if winner_record_id:
                db.execute(
                    'INSERT INTO debt_ledger (debtor_id, creditor_id, delta, remaining, winner_id, event_type) '
                    'VALUES (?, ?, ?, 0, ?, ?)',
                    (d['debtor_id'], winner_id, -d['amount'], winner_record_id, 'refund')
                )
                _consume_debt_entries(db, d['debtor_id'], winner_id, d['amount'])

    db.execute('UPDATE watchers SET punish_streak = 0 WHERE id = ?', (winner_id,))
    db.commit()
    socketio.emit('data_changed', {})

    return jsonify({'ok': True, 'winner_id': winner_id, 'streak': streak, 'points_saved': points_saved, 'returned_to': returned_to})


# ── Admin ──

@bp.route('/admin/verify', methods=['POST'])
def verify_admin():
    """Check if the provided admin password is correct."""
    data = request.get_json(silent=True)
    pw = (data or {}).get('password', '')
    admin_pw = os.environ.get('ADMIN_PASSWORD', 'setadminpass')
    return jsonify({'ok': pw == admin_pw})


@bp.route('/admin/watchers/<int:watcher_id>/reset-streak', methods=['POST'])
def reset_streak(watcher_id):
    """Reset a watcher's punish streak to 0."""
    db = get_db(current_app)
    watcher = db.execute('SELECT id, name, points, punish_streak FROM watchers WHERE id = ?', (watcher_id,)).fetchone()
    if not watcher:
        return jsonify({'error': 'Watcher not found'}), 404
    db.execute('UPDATE watchers SET punish_streak = 0 WHERE id = ?', (watcher_id,))
    db.commit()
    socketio.emit('data_changed', {})
    return jsonify({
        'ok': True,
        'watcher': {
            'id': watcher['id'],
            'name': watcher['name'],
            'points': watcher['points'],
            'punish_streak': 0,
        },
    })


# ── SocketIO Events ──

@bp.route('/debts', methods=['GET'])
def get_debts():
    """Get the full debt matrix for all watchers."""
    db = get_db(current_app)
    watchers = db.execute('SELECT id, name FROM watchers ORDER BY created_at ASC').fetchall()

    # Ensure all watcher pairs have debt entries
    ids = [w['id'] for w in watchers]
    for d_id in ids:
        for c_id in ids:
            if d_id == c_id:
                continue
            existing = db.execute(
                'SELECT id FROM debts WHERE debtor_id = ? AND creditor_id = ?',
                (d_id, c_id)
            ).fetchone()
            if not existing:
                db.execute(
                    'INSERT INTO debts (debtor_id, creditor_id, amount) VALUES (?, ?, 0)',
                    (d_id, c_id)
                )
    db.commit()

    debts = db.execute('SELECT debtor_id, creditor_id, amount FROM debts').fetchall()
    return jsonify({
        'watchers': [dict(w) for w in watchers],
        'debts': [{'debtor_id': d['debtor_id'], 'creditor_id': d['creditor_id'], 'amount': int(d['amount'])} for d in debts],
    })


@bp.route('/debts', methods=['PATCH'])
def update_debt():
    """Update a single debt cell. Body: {debtor_id, creditor_id, amount}"""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    debtor_id = data.get('debtor_id')
    creditor_id = data.get('creditor_id')
    if not debtor_id or not creditor_id:
        return jsonify({'error': 'debtor_id and creditor_id required'}), 400
    if debtor_id == creditor_id:
        return jsonify({'error': 'Cannot owe yourself'}), 400

    try:
        amount = int(data.get('amount', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'amount must be a whole number'}), 400

    db = get_db(current_app)
    existing = db.execute(
        'SELECT id FROM debts WHERE debtor_id = ? AND creditor_id = ?',
        (debtor_id, creditor_id)
    ).fetchone()
    if not existing:
        return jsonify({'error': 'Debt entry not found'}), 404

    db.execute('UPDATE debts SET amount = ? WHERE debtor_id = ? AND creditor_id = ?',
               (amount, debtor_id, creditor_id))
    db.commit()
    socketio.emit('data_changed', {})
    return jsonify({'ok': True, 'debtor_id': debtor_id, 'creditor_id': creditor_id, 'amount': amount})


@bp.route('/media/<folder>', methods=['GET'])
def list_media(folder):
    """List .wav files in static subfolder (music/ or cheers/)."""
    if folder not in ('music', 'cheers'):
        return jsonify({'error': 'Invalid folder'}), 400
    base = os.path.join(os.path.dirname(__file__), 'static', folder)
    try:
        files = sorted(f for f in os.listdir(base) if f.endswith('.wav'))
    except FileNotFoundError:
        files = []
    return jsonify(files)


@socketio.on('spin_completed')
def handle_spin_completed(data):
    """Broadcast spin result to all other connected clients."""
    socketio.emit('spin_completed', data)
