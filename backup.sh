#!/bin/sh
set -e

BACKUP_DIR="${DB_DIR:-/data}/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp "${DB_DIR:-/data}/wheel.db" "$BACKUP_DIR/wheel_$TIMESTAMP.db"

# Keep only last 14 backups
ls -t "$BACKUP_DIR"/wheel_*.db 2>/dev/null | tail -n +15 | xargs rm -f 2>/dev/null
