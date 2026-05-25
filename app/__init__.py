import os
from flask import Flask


def create_app():
    """Create and configure the Flask application."""
    app = Flask(__name__)

    # Database path — mounted volume
    db_dir = os.environ.get('DB_DIR', '/data')
    os.makedirs(db_dir, exist_ok=True)
    app.config['DATABASE'] = os.path.join(db_dir, 'wheel.db')

    # Init DB on startup
    from . import models
    models.init_db(app)

    # Register blueprints
    from . import routes
    app.register_blueprint(routes.bp)

    return app
