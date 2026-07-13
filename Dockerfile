# ============================================================
#  Multi-stage Dockerfile — Wheel of Doom(b)
#  Single container: nginx + gunicorn + Flask + SQLite
# ============================================================

# ---- Stage 1: Python deps ----
FROM python:3.12-alpine AS builder

WORKDIR /build
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# ---- Stage 2: Runtime ----
FROM python:3.12-alpine

# Install nginx
RUN apk add --no-cache nginx

# Copy Python packages from builder
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Create app directory
WORKDIR /app

# Copy application code
COPY app/          app/
COPY nginx/        nginx/
COPY run.py        .

# Create data dir for SQLite
RUN mkdir -p /data

EXPOSE 9642

ENTRYPOINT sh -c '\
    mkdir -p /data && \
    echo "Starting nginx..." && \
    nginx -c /app/nginx/nginx.conf && \
    echo "Starting Flask-SocketIO..." && \
    cd /app && \
    PYTHONPATH=/app exec python run.py\
'
