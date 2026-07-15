#!/bin/sh
set -e

DB_DIR="${DB_DIR:-/data}"
BACKUP_DIR="${DB_DIR}/backups"
DB_FILE="${DB_DIR}/wheel.db"

mkdir -p "${BACKUP_DIR}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/wheel_${TIMESTAMP}.db"

if [ -f "${DB_FILE}" ]; then
    cp "${DB_FILE}" "${BACKUP_FILE}"
    echo "Backup created: ${BACKUP_FILE}"
else
    echo "Database file not found: ${DB_FILE}"
    exit 1
fi

# Remove backups older than 14 days
find "${BACKUP_DIR}" -name "wheel_*.db" -type f -mtime +14 -delete
