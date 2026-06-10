# ============================================================================
# server/Dockerfile — The Almanac Cup API (Contract §9).
#
# Multi-stage build on node:22-alpine:
#   1. builder  — full dev install (npm ci) + TypeScript compile (npm run build);
#   2. runtime  — production-only install (npm ci --omit=dev), dist/ and
#                 migrations/ copied in. Migrations auto-apply on boot
#                 (src/migrate.ts), so the container needs no entrypoint magic.
#
# Deploy target: Raspberry Pi 4/5 (arm64) via docker-compose with
# platform: linux/arm64 and a 256 MiB memory limit for this service.
# ============================================================================

# ---- stage 1: builder ------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Install ALL dependencies (dev included — tsc lives there). Copy only the
# manifests first so Docker layer-caches the install across source edits.
COPY package.json package-lock.json ./
RUN npm ci

# Compile src/ → dist/ (tsc -p tsconfig.json).
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- stage 2: runtime ------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only — no TypeScript, no tsx in the final image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Compiled app + the plain-SQL migrations it applies on boot.
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

# The API listens on PORT (default 8080); compose healthchecks /api/health.
EXPOSE 8080
CMD ["node", "dist/index.js"]
