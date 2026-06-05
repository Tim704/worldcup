# =============================================================================
# World Cup 2026 Fantasy Hub — React/Vite frontend container (arm64).
#
# Multi-stage build:
#   1. builder — Node 22 (Alpine) installs deps and runs the Vite production
#                build, baking in the build-time VITE_API_BASE.
#   2. runtime — nginx (Alpine) serves the static `dist/` bundle and reverse-
#                proxies /api/ to the backend (see deploy/nginx/nginx.conf).
#
# Target platform: linux/arm64 (Raspberry Pi 4/5, Raspberry Pi OS Lite).
#
# BUILD CONTEXT: the repository ROOT (compose sets `context: .`,
# `dockerfile: frontend/Dockerfile`). This is required so the runtime stage can
# COPY deploy/nginx/nginx.conf, which lives OUTSIDE frontend/. Therefore every
# COPY path below is written relative to the repo root.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — builder: compile the SPA with Vite.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

# VITE_API_BASE is a BUILD-TIME variable (Vite inlines import.meta.env.* at
# build). It must be passed via `--build-arg` (compose does this). Default per
# CONTRACT §9 points the browser at the host-exposed backend.
ARG VITE_API_BASE=http://localhost:8080/api
ENV VITE_API_BASE=${VITE_API_BASE}

WORKDIR /app

# ---- Dependency layer -------------------------------------------------------
# Copy the lockfile + manifest first so `npm ci` is cached until deps change.
# `npm ci` installs the EXACT, reproducible tree from package-lock.json; if the
# lockfile is ever out of sync, fall back to a plain install.
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install

# ---- Build ------------------------------------------------------------------
# Bring in the frontend source and produce the optimised static bundle under
# /app/dist. `npm run build` runs `tsc --noEmit` (strict) then `vite build`.
COPY frontend/ ./
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2 — runtime: nginx serving the static bundle.
# -----------------------------------------------------------------------------
FROM nginx:alpine AS runtime

# Replace the stock server block with our SPA + /api/ proxy configuration.
COPY deploy/nginx/nginx.conf /etc/nginx/conf.d/default.conf

# Ship the compiled SPA into nginx's web root.
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx listens on port 80 inside the container (compose maps host 8081 → 80).
EXPOSE 80

# nginx:alpine's base image already sets `CMD ["nginx", "-g", "daemon off;"]`,
# which keeps nginx in the foreground as PID 1 — no override needed.
