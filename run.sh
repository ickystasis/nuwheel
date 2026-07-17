#!/bin/sh
set -e

# Ensure data directory for SQLite
mkdir -p /data

# Set up cron for daily backup at noon
echo "0 12 * * * /bin/sh /app/backup.sh >> /var/log/backup.log 2>&1" | crontab -
crond -b -d 0

# Start nginx in background
echo "Starting nginx..."
nginx -c /app/nginx/nginx.conf

# Start Flask-SocketIO server (eventlet)
echo "Starting Flask-SocketIO..."
cd /app
PYTHONPATH=/app exec python run.py
