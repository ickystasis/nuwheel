#!/usr/bin/env python3
"""Entry point for Flask-SocketIO server with eventlet."""
import eventlet

eventlet.monkey_patch()

from app import create_app
from app.socketio_ext import socketio

app = create_app()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
