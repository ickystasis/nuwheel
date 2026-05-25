#!/bin/sh
set -e

# Ensure data directory for SQLite
mkdir -p /data

# Start nginx in background
echo "Starting nginx..."
nginx -c /app/nginx/nginx.conf

# Start gunicorn in foreground
echo "Starting gunicorn..."
cd /app
PYTHONPATH=/app exec gunicorn -w 2 -b 127.0.0.1:5000 "app:create_app()"
