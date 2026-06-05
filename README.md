# World Cup 2026 Fantasy Hub

A container-first, full-stack fantasy hub for the FIFA World Cup 2026 — predict
scorelines, wager friendly punishments in **The Bloodline**, and immortalise the
losers in the **Hall of Shame** tribunal. Tuned to run on a single **Raspberry
Pi 4/5 (Raspberry Pi OS Lite, arm64)**.

> **Single source of truth:** [`docs/CONTRACT.md`](docs/CONTRACT.md). Every
> identifier, enum, route, env var, version and formula is defined there. When
> in doubt, match the contract literally.

---

## Monorepo layout

```
worldcup/
├── backend/      Rust API — Axum + SQLx → PostgreSQL          [BACKEND]
│   ├── Cargo.toml, src/**.rs
│   ├── migrations/0001_init.sql (+ .down.sql)
│   └── Dockerfile                                             [DEVOPS]
├── frontend/     React 18 + TypeScript + Vite 5 SPA (mobile)  [FRONTEND]
│   ├── src/**, package.json
│   └── Dockerfile                                             [DEVOPS]
├── scripts/      Python 3.9 fixture ingestion                 [PYTHON]
│   └── Dockerfile                                             [DEVOPS]
├── deploy/nginx/nginx.conf   reverse proxy + SPA host         [DEVOPS]
├── docs/CONTRACT.md          authoritative build contract
├── docker-compose.yml, .env.example, .dockerignore           [DEVOPS]
└── README.md  (this file)                                     [DEVOPS]
```

The mobile-first React frontend lives under **`frontend/`** (four bottom-tab
views: `Hub` · `Predict` · `Bloodline` · `Shame`).

---

## Architecture

```
                         ┌──────────────────────────────┐
       browser  ─HTTP─▶  │  frontend  (nginx :80)        │   host :8081
                         │  • serves the Vite SPA bundle │
                         │  • proxies /api/  ───────────┐│
                         └───────────────────────────────┘
                                                        │
                                                  /api/ │ (proxy_pass)
                                                        ▼
                         ┌──────────────────────────────┐
                         │  backend  (Rust/Axum :8080)   │   host :8080
                         │  • REST API, scoring, state   │
                         │    machine (The Bloodline)    │
                         └───────────────┬───────────────┘
                                         │ SQLx (PgPool)
                                         ▼
                         ┌──────────────────────────────┐
                         │  db  (postgres:16-alpine)     │   host :5432
                         │  • named volume `pgdata`      │
                         └───────────────▲───────────────┘
                                         │ psycopg2
                         ┌───────────────┴───────────────┐
                         │  ingest  (Python 3.9 loop)    │   (no exposed port)
                         │  • pulls fixtures every        │
                         │    INGEST_INTERVAL_SECS        │
                         └──────────────────────────────┘
```

All four services pin `platform: linux/arm64`, `restart: unless-stopped`, a
healthcheck (or health-gated `depends_on`), and a metric memory limit
(db 512 MiB · backend 256 MiB · ingest 128 MiB · frontend 64 MiB).

| service  | image / build              | container port | host port |
|----------|----------------------------|----------------|-----------|
| db       | `postgres:16-alpine`       | 5432           | 5432      |
| backend  | build `./backend`          | 8080           | 8080      |
| ingest   | build `./scripts`          | —              | —         |
| frontend | build (nginx)              | 80             | 8081      |

---

## Run locally

Requires Docker with the Compose plugin and BuildKit. On a non-arm64 dev box,
enable QEMU emulation once (`docker run --privileged --rm tonistiigi/binfmt --install arm64`).

```bash
cp .env.example .env          # safe local defaults (CONTRACT §9)
docker compose up --build     # build all images and start the stack
```

Then open:

- **SPA**:        http://localhost:8081
- **API health**: http://localhost:8080/api/health  → `{ status, uptime_secs }`
- **Postgres**:   `localhost:5432` (user `wc`, password `wc`, db `worldcup`)

Tear down (keep data): `docker compose down`.
Tear down (wipe the database volume): `docker compose down -v`.

---

## Applying database migrations

The canonical schema is `backend/migrations/0001_init.sql` (+ its `.down.sql`).
The backend image carries the `migrations/` directory, so either approach works.

**Option A — `sqlx migrate run` (recommended, idempotent, tracks versions):**

```bash
# From a host with the sqlx CLI installed:
#   cargo install sqlx-cli --no-default-features --features postgres
export DATABASE_URL=postgres://wc:wc@localhost:5432/worldcup
sqlx migrate run --source backend/migrations
```

**Option B — raw `psql` (no extra tooling):**

```bash
# Pipe the migration straight into the running db container.
docker compose exec -T db psql -U wc -d worldcup < backend/migrations/0001_init.sql

# To roll back:
docker compose exec -T db psql -U wc -d worldcup < backend/migrations/0001_init.down.sql
```

---

## Deploy to a Raspberry Pi (arm64, Raspberry Pi OS Lite)

1. **Provision the Pi.** Flash *Raspberry Pi OS Lite (64-bit)*, enable SSH, boot
   and update: `sudo apt update && sudo apt full-upgrade -y`.

2. **Install Docker + Compose plugin:**

   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker "$USER"   # re-login to take effect
   sudo apt install -y docker-compose-plugin
   ```

3. **Copy the repo to the Pi** (e.g. `git clone` or `rsync`), then configure:

   ```bash
   cp .env.example .env
   # Edit .env: set VITE_API_BASE to the Pi's reachable origin, e.g.
   #   VITE_API_BASE=http://<pi-ip>:8080/api
   ```

4. **Build & run natively on the Pi** (it *is* arm64, so no emulation needed):

   ```bash
   docker compose up --build -d
   ```

5. **Apply migrations** once the `db` service is healthy (see section above).

6. **Verify:** `docker compose ps` (all healthy), then browse to
   `http://<pi-ip>:8081`. Logs: `docker compose logs -f backend ingest`.

The stack auto-restarts on reboot (`restart: unless-stopped`) and persists data
in the named `pgdata` volume. Memory limits are sized so all four services fit
comfortably within a 4 GiB Pi.

---

## Project conventions

- **Metric system only.** All quantities are SI: spacing in px/rem, durations in
  seconds, distance in km, temperature in °C, latency logged in ms. No imperial
  units anywhere in code, comments or UI.
- **LaTeX scoring.** The scoring algorithm (`backend/src/scoring.rs`) documents
  every formula as strict LaTeX in comments — per-match points (exact 5 /
  goal-difference 3 / result 2), the contrarian multiplier
  `m = 1 + α(1 − pₒ)`, and the Elo update with `K = 24`. See CONTRACT §5.
- **Chain-of-Thought state machine.** *The Bloodline* forfeit lifecycle
  (`pending → active → unsettled → resolved`) is implemented as a pure guard
  function preceded by a `// Chain of Thought:` block deriving each guard,
  idempotency and the nudge-escalation ladder. See CONTRACT §4.
- **File ownership is exclusive.** Each agent writes only its assigned files;
  the contract's layout table is binding.
- **Pinned versions, runtime SQLx.** Versions are pinned per CONTRACT §2; the
  backend uses runtime SQLx queries only (no compile-time `query!` macros) so it
  builds with no live database.

For anything not covered here, defer to **[`docs/CONTRACT.md`](docs/CONTRACT.md)** — it is authoritative.
