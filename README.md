# The Almanac Cup — World Cup 2026

A container-first, full-stack prediction hub for the FIFA World Cup 2026 —
call scorelines (scored **5/2/0**), post public boasts in the **Wagers
marketplace** (the loser owes the forfeit), and climb the leaderboard. The
whole SPA wears the **"Warm Almanac"** design system: cream paper, ink borders,
hard offset shadows. Tuned to run on a single **Raspberry Pi 4/5 (Raspberry Pi
OS Lite, arm64)**.

> **Single source of truth:** [`docs/CONTRACT.md`](docs/CONTRACT.md) (Contract
> v2). Every identifier, enum, route, env var, version and formula is defined
> there. When in doubt, match the contract literally.

v2 replaced the v1 Rust/Axum backend with **Node 20+/Express + TypeScript**
under `server/`, and replaced the old *Bloodline* / *Hall of Shame* features
with the Wagers marketplace. The legacy Rust code in `backend/` is kept for
reference only — it is **no longer built or deployed**.

---

## Monorepo layout

```
worldcup/
├── server/       Node/Express + TypeScript API → PostgreSQL  [SERVER]
│   ├── package.json, tsconfig.json, Dockerfile
│   ├── migrations/0001_init.sql (+ .down.sql)
│   └── src/**  (index, db, migrate, middleware, lib, routes)
├── backend/      LEGACY Rust API (v1) — kept for reference, NOT built
├── frontend/     React 18 + TypeScript + Vite 5 SPA (mobile) [FRONTEND]
│   ├── src/**, package.json
│   └── Dockerfile
├── scripts/      Python 3.9 fixture ingestion                [PYTHON]
│   └── Dockerfile
├── deploy/nginx/nginx.conf   reverse proxy + SPA host        [DEVOPS]
├── docs/CONTRACT.md          authoritative build contract (v2)
├── docker-compose.yml, .env.example, .dockerignore           [DEVOPS]
└── README.md  (this file)                                    [DEVOPS]
```

The mobile-first React frontend lives under **`frontend/`** (bottom-tab views:
`Hub` · `Matches` · `Table` · `Wagers`, plus `Admin` for admins).

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
                         │  backend  (Node/Express :8080)│   host :8080
                         │  • REST API, 5/2/0 scoring,   │
                         │    wager lifecycle, JWT auth  │
                         │  • builds from ./server       │
                         └───────────────┬───────────────┘
                                         │ pg.Pool (max 5)
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

The compose **service name stays `backend`** (nginx resolves it by that name);
only its build context moved to `./server`. All four services pin
`platform: linux/arm64`, `restart: unless-stopped`, a healthcheck (or a
health-gated `depends_on`), and a metric memory limit
(db 512 MiB · backend 256 MiB · ingest 128 MiB · frontend 64 MiB).

| service  | image / build              | container port | host port |
|----------|----------------------------|----------------|-----------|
| db       | `postgres:16-alpine`       | 5432           | 5432      |
| backend  | build `./server`           | 8080           | 8080      |
| ingest   | build `./scripts`          | —              | —         |
| frontend | build (nginx)              | 80             | 8081      |

---

## Run the full stack (Docker)

Requires Docker with the Compose plugin and BuildKit. On a non-arm64 dev box,
enable QEMU emulation once (`docker run --privileged --rm tonistiigi/binfmt --install arm64`).

```bash
cp .env.example .env          # safe local defaults (CONTRACT §8)
docker compose up --build     # build all images and start the stack
```

Then open:

- **SPA**:        http://localhost:8081
- **API health**: http://localhost:8080/api/health  → `{ status, uptime_secs }` (uptime in SI seconds)
- **Postgres**:   `localhost:5432` (user `wc`, password `wc`, db `worldcup`)

Tear down (keep data): `docker compose down`.
Tear down (wipe the database volume): `docker compose down -v`.

---

## Local development (no Docker)

Run Postgres however you like (e.g. `docker compose up db`), then run the two
dev servers directly:

**API** — `server/` (auto-applies migrations on boot, then listens on `PORT`,
default 8080):

```bash
cd server
npm install
# Point at your local Postgres; the compose db is published on localhost:5432.
export DATABASE_URL=postgres://wc:wc@localhost:5432/worldcup
npm run dev          # tsx watch src/index.ts
```

**SPA** — `frontend/` (the Vite dev server proxies `/api` → `http://localhost:8080`,
so no CORS or env tweaking is needed):

```bash
cd frontend
npm install
npm run dev
```

Server unit tests (scoring + wager resolution, `node:test`):
`cd server && npm test`.

---

## Database migrations (automatic)

Migrations are plain `.sql` files in `server/migrations/`, applied
**automatically on container start** by `server/src/migrate.ts`: each file runs
in its own transaction, is tracked in `schema_migrations(version, applied_at)`
(idempotent re-runs), and the runner retries the Postgres connection
30 × every 2 s so the Pi's slow database start never kills the container.
No manual `sqlx`/`psql` step exists anymore.

> **First v2 boot — heads up.** `0001_init.sql` begins by **dropping the legacy
> v1 tables** (`shame_votes`, `hall_of_shame`, `forfeits`, `predictions`,
> `matches`, `users`, …) before creating the v2 schema. This is sanctioned: the
> tournament has not started, and fixtures **re-ingest automatically within
> `INGEST_INTERVAL_SECS`** (default 300 s). v1 predictions and forfeits are
> intentionally not migrated.

To roll back by hand if you ever need to:

```bash
docker compose exec -T db psql -U wc -d worldcup < server/migrations/0001_init.down.sql
```

---

## Auth & admin setup (passwordless)

Login is **username-only**: `POST /api/auth/login {username}` upserts the user
(case-insensitive on `lower(username)`) and returns a 90-day HS256 JWT signed
with `APP_SECRET`. No passwords — the small print says it best: *no passwords.
just don't pick your friend's name.*

Admins are configured by env var: any username listed in the comma-separated
**`ADMIN_USERNAMES`** (default `tom`) gets `is_admin = true` on every login.
Admins unlock the `/admin` view: enter final scores (which settles predictions
and wagers in one transaction), flag "Main Event" matches, and toggle live
status.

## Scoring (5/2/0)

Per prediction vs the final score: **5** points for the exact scoreline,
**2** for the correct outcome (win/draw/win), **0** otherwise — tiers
exclusive, checked top-down. Season total is the sum over final matches.
The pure TypeScript function in `server/src/lib/scoring.ts` is the source of
truth (unit-tested; LaTeX formula in its comment).

## Wagers marketplace (replaces Bloodline / Hall of Shame)

A wager is a machine-evaluable public boast on a match: a `pick`
(home/draw/away), an optional margin ("wins by ≥ N goals"), and a human-readable
claim. Lifecycle: `PENDING → ACCEPTED → RESOLVED_WON | RESOLVED_LOST`. Anyone
else can accept a PENDING wager before the match locks (60 s before kickoff) by
staking a forfeit; when the admin submits the final score the wager resolves
and **the loser owes the forfeit**. Unaccepted wagers whose match locks stay in
the DB as "expired, unclaimed".

---

## Environment variables (CONTRACT §8)

| name                   | default (dev)                       | used by            | notes |
|------------------------|-------------------------------------|--------------------|-------|
| `DATABASE_URL`         | `postgres://wc:wc@db:5432/worldcup` | backend + ingest   | Postgres DSN |
| `PORT`                 | `8080`                              | backend            | bind port inside the container |
| `APP_SECRET`           | `change-me-please`                  | backend            | JWT HS256 secret — **change it** |
| `ADMIN_USERNAMES`      | `tom`                               | backend            | comma-separated admin usernames |
| `VITE_API_BASE`        | `/api`                              | frontend (build)   | `/api` = same-origin nginx proxy |
| `FIXTURE_FEED_URL`     | *(blank)*                           | ingest             | blank → idle/mock mode |
| `INGEST_INTERVAL_SECS` | `300`                               | ingest             | cadence, SI seconds |

`APP_BIND_ADDR` and `RUST_LOG` are retired with the v1 backend.

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
   # Edit .env:
   #   APP_SECRET      → a long random string (it signs every login token)
   #   ADMIN_USERNAMES → the usernames that should get admin powers
   #   VITE_API_BASE   → leave as /api (the nginx container proxies /api/ to
   #                     the backend, so the SPA talks same-origin). Only set
   #                     an absolute origin, e.g. http://<pi-ip>:8080/api, if
   #                     you expose the API separately from the SPA.
   ```

4. **Build & run natively on the Pi** (it *is* arm64, so no emulation needed):

   ```bash
   docker compose up --build -d
   ```

   Migrations apply automatically when the backend container starts; fixtures
   appear once the ingest loop runs (within `INGEST_INTERVAL_SECS`, 300 s by
   default). No manual schema step.

5. **Verify:** `docker compose ps` (all healthy), then browse to
   `http://<pi-ip>:8081` and log in with a name from `ADMIN_USERNAMES`.
   Logs: `docker compose logs -f backend ingest`.

The stack auto-restarts on reboot (`restart: unless-stopped`) and persists data
in the named `pgdata` volume. Memory limits are sized so all four services fit
comfortably within a 4 GiB Pi.

---

## Project conventions

- **Metric system only.** All quantities are SI: durations in seconds, latency
  logged in ms, distance in km, temperature in °C. No imperial units anywhere
  in code, comments or UI.
- **Heavily documented code.** The scoring function
  (`server/src/lib/scoring.ts`) carries its piecewise formula as LaTeX in a
  comment; the wager resolution (`server/src/lib/wagers.ts`) is preceded by a
  `// Chain of Thought:` derivation of every guard. Repo tradition.
- **One pool, parameterised SQL, no N+1.** Raw SQL through a single shared
  `pg.Pool` (`max: 5` — Pi-sized), `$1`-style binds only; leaderboard and
  settlement each run as single statements.
- **File ownership is exclusive.** Each agent writes only its assigned files;
  the contract's layout table is binding.
- **Legacy stays put.** `backend/` (Rust/Axum, v1) is kept for reference and is
  not part of the build; do not point tooling at it.

For anything not covered here, defer to **[`docs/CONTRACT.md`](docs/CONTRACT.md)** — it is authoritative.
