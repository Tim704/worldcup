# =============================================================================
# World Cup 2026 Fantasy Hub — Python fixture-ingestion container (arm64).
#
# A single-stage image: CPython 3.9 (slim) matching the deployment runtime
# mandated by CONTRACT §2. The service loops every INGEST_INTERVAL_SECS, pulling
# fixtures from the optional upstream feed into PostgreSQL.
#
# Target platform: linux/arm64 (Raspberry Pi 4/5, Raspberry Pi OS Lite).
# requirements.txt pins arm64 (aarch64) wheels, so no C toolchain is needed.
# =============================================================================

# Python 3.9 slim — the contract targets 3.9 (no match/case, no `X | Y` unions).
FROM python:3.9-slim

# Predictable, log-friendly Python:
#   PYTHONUNBUFFERED      → stdout/stderr stream immediately (no buffering),
#                           so `docker logs` shows progress in real time.
#   PYTHONDONTWRITEBYTECODE → skip .pyc files (ephemeral container, no benefit).
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# procps provides `pgrep`, which the compose liveness healthcheck relies on
# (it is NOT present in python:3.9-slim by default).
RUN apt-get update \
    && apt-get install -y --no-install-recommends procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Dependency layer -------------------------------------------------------
# Copy requirements first so the pip layer is cached until the pins change.
# --no-cache-dir keeps the image small (no pip wheel cache baked in).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# ---- Source -----------------------------------------------------------------
# Bring in the ingestion scripts (ingest.py, fixtures.py, …).
COPY . .

# Drop privileges: an unprivileged system user owns /app and runs the loop
# (defense-in-depth, matching the backend image's non-root runtime).
RUN useradd --system --home-dir /app --shell /usr/sbin/nologin ingest \
    && chown -R ingest:ingest /app
USER ingest

# Run the long-lived ingestion loop. Exec form → python is PID 1 and receives
# signals directly for clean shutdown.
CMD ["python", "ingest.py"]
