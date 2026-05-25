from flask import Blueprint, request, jsonify, current_app
from .models import get_db

bp = Blueprint('api', __name__, url_prefix='/api')


@bp.route('/movies', methods=['GET'])
def list_movies():
    """Get all movies ordered by creation date."""
    db = get_db(current_app)
    rows = db.execute('SELECT id, name FROM movies ORDER BY created_at ASC').fetchall()
    return jsonify([dict(r) for r in rows])


@bp.route('/movies', methods=['POST'])
def add_movie():
    """Add a new movie."""
    data = request.get_json(silent=True)
    if not data or not data.get('name', '').strip():
        return jsonify({'error': 'Movie name is required'}), 400

    name = data['name'].strip()
    if len(name) > 200:
        return jsonify({'error': 'Movie name too long (max 200 chars)'}), 400

    db = get_db(current_app)

    # Check for duplicate
    existing = db.execute('SELECT id FROM movies WHERE name = ?', (name,)).fetchone()
    if existing:
        return jsonify({'error': 'Movie already in the list'}), 409

    db.execute('INSERT INTO movies (name) VALUES (?)', (name,))
    db.commit()

    row = db.execute('SELECT id, name FROM movies WHERE id = last_insert_rowid()').fetchone()
    return jsonify(dict(row)), 201


@bp.route('/movies/<int:movie_id>', methods=['DELETE'])
def delete_movie(movie_id):
    """Remove a movie by its ID."""
    db = get_db(current_app)
    db.execute('DELETE FROM movies WHERE id = ?', (movie_id,))
    db.commit()
    return jsonify({'ok': True})


@bp.route('/movies', methods=['DELETE'])
def clear_movies():
    """Remove all movies."""
    db = get_db(current_app)
    db.execute('DELETE FROM movies')
    db.commit()
    return jsonify({'ok': True})
