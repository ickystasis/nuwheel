import os
from flask import Flask
from .socketio_ext import socketio

VERSION = '1.8.7'


def create_app():
    """Create and configure the Flask application."""
    app = Flask(__name__)

    # Database path — mounted volume
    db_dir = os.environ.get('DB_DIR', '/data')
    os.makedirs(db_dir, exist_ok=True)
    app.config['DATABASE'] = os.path.join(db_dir, 'wheel.db')
    app.config['SITE_TITLE'] = os.environ.get('SITE_TITLE', 'Wheel of Doom(b)')

    # Init DB on startup
    from . import models
    models.init_db(app)

    # Init SocketIO
    socketio.init_app(app, cors_allowed_origins="*")

    # Register blueprints
    from . import routes
    app.register_blueprint(routes.bp)

    return app
