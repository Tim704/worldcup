# =============================================================================
# World Cup 2026 Fantasy Hub — Rust backend container (arm64 / Raspberry Pi).
#
# Multi-stage build:
#   1. builder  — compiles the `worldcup-hub` release binary on a full Rust
#                 toolchain image.
#   2. runtime  — a slim Debian image carrying ONLY the binary + migrations,
#                 running as a non-root user.
#
# Target platform: linux/arm64 (Raspberry Pi 4/5, Raspberry Pi OS Lite).
# The compose file pins `platform: linux/arm64`; on an amd64 dev box Docker
# BuildKit emulates arm64 via binfmt/qemu.
#
# CRITICAL (CONTRACT §2): the build environment has NO live database. The crate
# uses runtime SQLx queries only, so `cargo build` needs no DATABASE_URL.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — builder: full Rust toolchain on Debian bookworm.
# `rust:1-bookworm` tracks the latest stable Rust 1.x on Debian 12.
# -----------------------------------------------------------------------------
FROM rust:1-bookworm AS builder

# All build work happens under /build.
WORKDIR /build

# ---- Dependency-cache layer -------------------------------------------------
# Copy ONLY the manifest first. With a stub main.rs we compile the full
# dependency graph; because Cargo.toml rarely changes, Docker reuses this
# expensive layer on subsequent builds (only your own src/ triggers a rebuild).
COPY Cargo.toml ./
RUN mkdir -p src \
    && echo 'fn main() { /* dependency-cache stub */ }' > src/main.rs \
    && cargo build --release \
    # Drop the stub artifacts so the real source forces a clean recompile of
    # our own crate (but NOT of the cached dependencies above).
    && rm -rf src target/release/worldcup-hub target/release/deps/worldcup_hub*

# ---- Real source ------------------------------------------------------------
# Now bring in the actual application source and SQL migrations, then build the
# optimised release binary `worldcup-hub`.
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release

# -----------------------------------------------------------------------------
# Stage 2 — runtime: minimal Debian, no toolchain, non-root.
# `debian:bookworm-slim` matches the builder's glibc/OpenSSL ABI, so the
# dynamically linked binary runs without surprises.
# -----------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

# ca-certificates lets the service make outbound TLS calls (rustls trust roots);
# curl backs the compose healthcheck (GET /api/health). --no-install-recommends
# keeps the image lean; clean apt lists after.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Create an unprivileged system user/group. Running as non-root is a baseline
# container-security control (a compromised process cannot trivially escalate).
RUN groupadd --system worldcup \
    && useradd --system --gid worldcup --home-dir /app --shell /usr/sbin/nologin worldcup

WORKDIR /app

# Copy the compiled binary and the migrations directory from the builder stage.
# Migrations travel with the image so the operator can apply them in-container
# (see README: `psql` / `sqlx migrate run`).
COPY --from=builder /build/target/release/worldcup-hub /usr/local/bin/worldcup-hub
COPY --from=builder /build/migrations /app/migrations

# Drop privileges for the running process.
USER worldcup

# The Axum server binds APP_BIND_ADDR (default 0.0.0.0:8080) — see CONTRACT §9.
EXPOSE 8080

# Launch the API. Exec form → the binary is PID 1 and receives signals directly
# (clean shutdown on `docker stop`).
CMD ["worldcup-hub"]
