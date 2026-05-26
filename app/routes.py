import os
from flask import Blueprint, request, jsonify, current_app
from .models import get_db
from .socketio_ext import socketio

bp = Blueprint('api', __name__, url_prefix='/api')


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


# ── Data ──

@bp.route('/data', methods=['GET'])
def get_data():
    """Get all watchers with their titles and points."""
    db = get_db(current_app)
    watchers = db.execute('SELECT id, name, points, punish_streak FROM watchers ORDER BY created_at ASC').fetchall()
    result = []
    for w in watchers:
        titles = db.execute(
            'SELECT id, name, points FROM titles WHERE watcher_id = ? ORDER BY created_at ASC',
            (w['id'],)
        ).fetchall()
        result.append({
            'id': w['id'],
            'name': w['name'],
            'points': w['points'],
            'punish_streak': w['punish_streak'],
            'titles': [dict(t) for t in titles],
        })
    return jsonify(result)


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

    try:
        points = int(data.get('points', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'Points must be a number'}), 400
    if points < -9999 or points > 9999:
        return jsonify({'error': 'Points must be between -9999 and 9999'}), 400

    db = get_db(current_app)

    # Check for duplicate name (case-insensitive)
    existing = db.execute('SELECT id FROM watchers WHERE LOWER(name) = LOWER(?)', (name,)).fetchone()
    if existing:
        return jsonify({'error': f'A watcher named "{name}" already exists'}), 409

    db.execute('INSERT INTO watchers (name, points) VALUES (?, ?)', (name, points))
    db.commit()
    socketio.emit('data_changed', {})
    row = db.execute('SELECT id, name, points FROM watchers WHERE id = last_insert_rowid()').fetchone()
    return jsonify({'id': row['id'], 'name': row['name'], 'points': row['points'], 'titles': []}), 201


@bp.route('/watchers/<int:watcher_id>', methods=['DELETE'])
def delete_watcher(watcher_id):
    """Remove a watcher and all their titles."""
    db = get_db(current_app)
    db.execute('DELETE FROM titles WHERE watcher_id = ?', (watcher_id,))
    db.execute('DELETE FROM watchers WHERE id = ?', (watcher_id,))
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
    if points > 100:
        return jsonify({'error': 'Points must be 100 or less'}), 400

    db = get_db(current_app)

    # Enforce point budget: total title points cannot exceed watcher's personal points
    points = _enforce_title_budget(db, watcher_id, points)
    if points < 0.1:
        return jsonify({'error': 'Not enough budget remaining for this title (min 0.1)'}), 400

    count = db.execute(
        'SELECT COUNT(*) as c FROM titles WHERE watcher_id = ?', (watcher_id,)
    ).fetchone()['c']
    if count >= 3:
        return jsonify({'error': 'Maximum 3 titles per watcher'}), 409

    db.execute('INSERT INTO titles (watcher_id, name, points) VALUES (?, ?, ?)',
               (watcher_id, name, points))
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
        if points > 100:
            return jsonify({'error': 'Points must be 100 or less'}), 400

        # Enforce point budget
        title_row = db.execute('SELECT watcher_id FROM titles WHERE id = ?', (title_id,)).fetchone()
        if title_row:
            points = _enforce_title_budget(db, title_row['watcher_id'], points, exclude_title_id=title_id)
        if points < 0.1:
            return jsonify({'error': 'Not enough budget remaining for this title (min 0.1)'}), 400

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


@bp.route('/titles/<int:title_id>', methods=['DELETE'])
def delete_title(title_id):
    """Remove a title."""
    db = get_db(current_app)
    db.execute('DELETE FROM titles WHERE id = ?', (title_id,))
    db.commit()
    socketio.emit('data_changed', {})
    return jsonify({'ok': True})


# ── Winners ──

@bp.route('/winners', methods=['GET'])
def list_winners():
    """Get all previous winners, newest first."""
    db = get_db(current_app)
    rows = db.execute(
        'SELECT id, title_name, watcher_name, weight, total_weight, participants, judgement, won_at '
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

    db = get_db(current_app)
    db.execute(
        'INSERT INTO winners (title_name, watcher_name, weight, total_weight, participants) VALUES (?, ?, ?, ?, ?)',
        (title_name, watcher_name, weight, total_weight, participants)
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


# ── Spin / Punish / Return ──

@bp.route('/spin/process-win', methods=['POST'])
def process_win():
    """When someone wins, return any points they've stolen from current participants."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    winner_id = data.get('winner_id')
    participant_ids = data.get('participant_ids', [])
    if not winner_id or not participant_ids:
        return jsonify({'error': 'winner_id and participant_ids required'}), 400

    db = get_db(current_app)

    # Find thefts where the winner stole from current participants
    placeholders = ','.join('?' * len(participant_ids))
    thefts = db.execute(
        f'SELECT id, thief_id, victim_id, amount FROM thefts '
        f'WHERE thief_id = ? AND victim_id IN ({placeholders})',
        [winner_id] + participant_ids
    ).fetchall()

    returned = []
    if thefts:
        # For each theft, return points: sub from thief, add to victim
        for t in thefts:
            # Get victim name
            victim = db.execute('SELECT name FROM watchers WHERE id = ?', (t['victim_id'],)).fetchone()
            if not victim:
                continue

            # Transfer points back
            thief_pts = db.execute('SELECT points FROM watchers WHERE id = ?', (t['thief_id'],)).fetchone()
            victim_pts = db.execute('SELECT points FROM watchers WHERE id = ?', (t['victim_id'],)).fetchone()
            if not thief_pts or not victim_pts:
                continue

            new_thief = thief_pts['points'] - t['amount']
            new_victim = victim_pts['points'] + t['amount']
            db.execute('UPDATE watchers SET points = ? WHERE id = ?', (new_thief, t['thief_id']))
            db.execute('UPDATE watchers SET points = ? WHERE id = ?', (new_victim, t['victim_id']))

            returned.append({
                'victim_name': victim['name'],
                'victim_id': t['victim_id'],
                'amount': t['amount'],
            })

        # Delete the processed thefts
        theft_ids = [t['id'] for t in thefts]
        del_placeholders = ','.join('?' * len(theft_ids))
        db.execute(f'DELETE FROM thefts WHERE id IN ({del_placeholders})', theft_ids)

    db.commit()

    socketio.emit('data_changed', {})

    # Get updated winner points
    winner = db.execute('SELECT id, name, points FROM watchers WHERE id = ?', (winner_id,)).fetchone()

    return jsonify({
        'returned': returned,
        'winner': dict(winner) if winner else None,
    })


@bp.route('/spin/punish', methods=['POST'])
def punish_movie():
    """Non-winners each steal (streak+1) points from the winner. Streak increments."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    winner_id = data.get('winner_id')
    participant_ids = data.get('participant_ids', [])
    if not winner_id or not participant_ids:
        return jsonify({'error': 'winner_id and participant_ids required'}), 400

    db = get_db(current_app)

    # Get winner with streak info
    winner = db.execute('SELECT id, name, points, punish_streak FROM watchers WHERE id = ?', (winner_id,)).fetchone()
    if not winner:
        return jsonify({'error': 'Winner not found'}), 404

    # Streak multiplier: first punish = 1, second = 2, third = 3, etc.
    streak = winner['punish_streak']
    multiplier = streak + 1

    stolen_from = []
    total_theft = 0

    for pid in participant_ids:
        if pid == winner_id:
            continue  # skip the winner

        participant = db.execute('SELECT name FROM watchers WHERE id = ?', (pid,)).fetchone()
        if not participant:
            continue

        # Each non-winner steals `multiplier` points from the winner
        db.execute('UPDATE watchers SET points = points + ? WHERE id = ?', (multiplier, pid))

        # Record the theft with the multiplied amount
        db.execute('INSERT INTO thefts (thief_id, victim_id, amount) VALUES (?, ?, ?)',
                   (pid, winner_id, multiplier))

        stolen_from.append({
            'thief_name': participant['name'],
            'thief_id': pid,
            'amount': multiplier,
        })
        total_theft += multiplier

    # Single winner update: deduct total stolen points at once
    if total_theft > 0:
        new_winner_pts = winner['points'] - total_theft
        db.execute('UPDATE watchers SET points = ? WHERE id = ?', (new_winner_pts, winner_id))

    # Increment punish streak after this punish
    db.execute('UPDATE watchers SET punish_streak = ? WHERE id = ?', (streak + 1, winner_id))

    db.commit()

    socketio.emit('data_changed', {})

    # Get final winner points and streak
    final_winner = db.execute('SELECT id, name, points, punish_streak FROM watchers WHERE id = ?', (winner_id,)).fetchone()

    return jsonify({
        'stolen_from': stolen_from,
        'total_theft': total_theft,
        'winner': dict(final_winner) if final_winner else None,
        'multiplier': multiplier,
    })


@bp.route('/spin/pass', methods=['POST'])
def pass_movie():
    """When a movie passes, reset the watcher's punish streak to 0."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    winner_id = data.get('winner_id')
    if not winner_id:
        return jsonify({'error': 'winner_id required'}), 400

    db = get_db(current_app)

    # Reset punish streak
    db.execute('UPDATE watchers SET punish_streak = 0 WHERE id = ?', (winner_id,))
    db.commit()

    socketio.emit('data_changed', {})

    final_winner = db.execute('SELECT id, name, points, punish_streak FROM watchers WHERE id = ?', (winner_id,)).fetchone()

    return jsonify({
        'ok': True,
        'winner': dict(final_winner) if final_winner else None,
    })


# ── Admin ──

@bp.route('/admin/verify', methods=['POST'])
def verify_admin():
    """Check if the provided admin password is correct."""
    data = request.get_json(silent=True)
    pw = (data or {}).get('password', '')
    admin_pw = os.environ.get('ADMIN_PASSWORD', 'setadminpass')
    return jsonify({'ok': pw == admin_pw})
