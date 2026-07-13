"""Flask-SocketIO instance for real-time updates."""
from flask_socketio import SocketIO

socketio = SocketIO(async_mode='threading')
