# World Cup 2026 Fantasy Hub — Build Contract (authoritative)

> **This file is the single source of truth.** Every service (Rust backend,
> Python ingestion, React frontend, Docker/deploy) MUST conform to the exact
> identifiers, states, formulas, versions and file boundaries defined here.
> When in doubt, match this document literally. Do not invent alternative table
> names, enum values, route paths or env-var names.

---

## 1. Architecture & deployment target

Full-stack, container-first, tuned to run on a **Raspberry Pi 4/5 (Raspberry Pi
OS Lite, arm64)**.

```
worldcup/
├── backend/      Rust API (Axum + SQLx → PostgreSQL)        [agent: BACKEND]
│   ├── Cargo.toml, src/**.rs                                [BACKEND owns]
│   ├── migrations/0001_init.sql (+ .down.sql)               [ALREADY WRITTEN — read only]
│   └── Dockerfile                                           [agent: DEVOPS owns]
├── frontend/     React + TS + Vite SPA (mobile-first)       [agent: FRONTEND]
│   ├── src/** , package.json                                [FRONTEND owns]
│   │   └── components/MatchPredictionCenter.tsx  ← PRESERVE, do not rewrite
│   └── Dockerfile                                           [agent: DEVOPS owns]
├── scripts/      Python fixture ingestion                   [agent: PYTHON owns]
│   └── Dockerfile                                           [agent: DEVOPS owns]
├── deploy/nginx/ nginx reverse proxy config                 [agent: DEVOPS owns]
├── docs/CONTRACT.md                                         [this file]
├── docker-compose.yml, .env.example, .dockerignore          [agent: DEVOPS owns]
└── README.md                                                [agent: DEVOPS owns]
```

**File ownership is exclusive.** An agent writes ONLY the files assigned to it
above. Never edit another agent's files (prevents write races).

### Service topology (docker-compose)
| service   | image / build                     | container port | host port |
|-----------|-----------------------------------|----------------|-----------|
| db        | `postgres:16-alpine`              | 5432           | 5432      |
| backend   | build `./backend`                 | 8080           | 8080      |
| ingest    | build `./scripts`                 | —              | —         |
| frontend  | build `./frontend` (nginx)        | 80             | 8081      |

All services pin `platform: linux/arm64` and set `restart: unless-stopped`,
memory limits, and healthchecks. `db` uses a named volume for persistence.

---

## 2. Tech stack & pinned versions

**Backend (Rust, edition 2021):** crate name `worldcup_hub`, binary `worldcup-hub`.
- `axum = "0.7"`, `tokio = { version = "1", features = ["full"] }`
- `sqlx = { version = "0.7", default-features = false, features = ["runtime-tokio-rustls", "postgres", "uuid", "chrono", "macros"] }`
- `tower-http = { version = "0.5", features = ["cors", "trace"] }`
- `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`
- `uuid = { version = "1", features = ["v4", "serde"] }`
- `chrono = { version = "0.4", features = ["serde"] }`
- `thiserror = "1"`, `tracing = "0.1"`, `tracing-subscriber = { version = "0.3", features = ["env-filter"] }`
- `anyhow = "1"` (startup only), `dotenvy = "0.15"`

> **CRITICAL compile constraint:** the build environment has **no live database**.
> Therefore use **runtime SQLx queries only** — `sqlx::query_as::<_, T>("…").bind(…)`
> with `#[derive(sqlx::FromRow)]` structs. **Do NOT use the compile-time-checked
> `sqlx::query!` / `query_as!` macros** (they require `DATABASE_URL` at build time).

**Frontend:** React 18 + TypeScript (strict) + Vite 5 (already scaffolded).
Add `react-router-dom@^6`. Keep `tsconfig` strict incl. `noUnusedLocals`.

**Python:** target **3.9** compatibility (deployment uses 3.9). Therefore:
- NO `match`/`case` statements, NO `X | Y` union syntax. Use `typing.Optional`,
  `typing.Union`, `typing.List`, etc.
- deps (`scripts/requirements.txt`): `requests`, `psycopg2-binary` (arm64 wheels),
  `python-dotenv`. Keep them importable but guard network/db calls behind
  `if __name__ == "__main__":` so `python -m py_compile` always succeeds.

---

## 3. Database schema (canonical identifiers)

The full DDL is **already written** at `backend/migrations/0001_init.sql` — read
it and mirror it EXACTLY. Summary of names every service must use verbatim:

**Enums:** `outcome_1x2`('home'|'draw'|'away'), `match_status`('scheduled'|'live'|'final'),
`proof_kind`('image'|'video'|'link'), `forfeit_state`('pending'|'active'|'unsettled'|'resolved').

**Tables & key columns**
- `users(id, username, display_name, elo_rating, total_points, created_at)`
- `matches(id, ext_ref, home_team, away_team, group_label, venue, kickoff_at, lock_at GENERATED = kickoff_at − 1min, status, home_score, away_score, created_at)`
- `predictions(id, user_id→users, match_id→matches, outcome, exact_home, exact_away, is_locked, points_awarded, created_at, updated_at)` UNIQUE(user_id, match_id)
- `forfeits(id, challenger_id→users, opponent_id→users, match_id→matches, stake, state, loser_id→users, created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at)` CHECK(challenger_id≠opponent_id)
- `hall_of_shame(id, forfeit_id→forfeits UNIQUE, loser_id→users, proof_url, proof_kind, caption, verified, created_at)`
- `shame_votes(id, entry_id→hall_of_shame, voter_id→users, vote ∈ {−1,+1}, created_at)` UNIQUE(entry_id, voter_id)

Rust `FromRow` structs and TS interfaces must use these exact field names
(snake_case in Rust/SQL; the frontend may keep snake_case in its API types to
avoid serde renaming).

---

## 4. The Bloodline state machine (REQUIRES Chain-of-Thought comments)

States: `pending → active → unsettled → resolved` (resolved is terminal).
Transitions (each maps to one API call or a system tick):

| from        | event                          | to          | side effects |
|-------------|--------------------------------|-------------|--------------|
| pending     | `accept`                       | active      | set `accepted_at` |
| pending     | `decline`                      | resolved    | set `resolved_at` (outcome: declined) |
| pending     | `expire` (tick, age > TTL)     | resolved    | after max nudges → void |
| active      | `settle` (match final)         | unsettled   | set `unsettled_at`, set `loser_id` from match result vs wager |
| unsettled   | `submit_proof`                 | unsettled   | create `hall_of_shame` row (verified=false) |
| unsettled   | tribunal pass (votes ≥ θ)      | resolved    | set `hall_of_shame.verified=true`, `resolved_at` |
| unsettled   | `nudge` (tick, overdue)        | unsettled   | `nudge_count++`, set `last_nudge_at` |
| unsettled   | `nudge` when nudge_count ≥ MAX | resolved    | resolved as **defaulted** (auto-shame) |

**Timeout / nudge constants** (metric SI seconds): pending TTL `PENDING_TTL_SECS = 172800` (48 h);
proof window `PROOF_WINDOW_SECS = 86400` (24 h); nudge interval `NUDGE_INTERVAL_SECS = 21600` (6 h);
`MAX_NUDGES = 3`. Tribunal threshold `TRIBUNAL_NET_VOTES = 3` (net thumbs-up).

The Rust function that performs a transition MUST:
1. Begin with a `// Chain of Thought:` block deriving WHY each guard exists
   (invalid transitions rejected, idempotency, the timeout/nudge escalation
   ladder) BEFORE the implementation.
2. Take inputs by **reference / borrow** where possible (no needless `.clone()`).
3. Return a `Result<Forfeit, AppError>`; reject illegal transitions with a typed
   error (e.g. `AppError::IllegalTransition { from, event }`).

Model the transition as a pure guard function
`fn next_state(current: &ForfeitState, event: &ForfeitEvent) -> Result<ForfeitState, AppError>`
plus a DB-applying wrapper. Keep the pure core unit-testable (`#[cfg(test)]`).

---

## 5. Scoring algorithm (REQUIRES LaTeX in comments)

Document each formula in code comments using strict LaTeX. Implement in
`backend/src/scoring.rs` as pure functions (borrow inputs, return numbers).

**(a) Per-match fantasy points.** For prediction $(p_h, p_a)$ vs actual
$(a_h, a_a)$, with indicator $[\,\cdot\,]$:

$$
P_{\text{base}} =
\begin{cases}
5 & \text{if } [p_h = a_h \wedge p_a = a_a] \quad(\text{exact score})\\
3 & \text{if } [(p_h - p_a) = (a_h - a_a)] \quad(\text{correct goal difference})\\
2 & \text{if } [\operatorname{sgn}(p_h - p_a) = \operatorname{sgn}(a_h - a_a)] \quad(\text{correct result})\\
0 & \text{otherwise}
\end{cases}
$$

(tiers are exclusive, checked top-down).

**(b) Contrarian multiplier.** With crowd probability $p_o \in (0,1]$ of the
predicted outcome and $\alpha = 0.5$:

$$ m = 1 + \alpha\,(1 - p_o), \qquad P_{\text{total}} = \big\lceil P_{\text{base}} \cdot m \big\rceil . $$

**(c) Elo expectation & update** (leaderboard ranking weight), $K = 24$:

$$ E_A = \frac{1}{1 + 10^{(R_B - R_A)/400}}, \qquad R_A' = R_A + K\,(S_A - E_A). $$

where $S_A \in \{1, 0.5, 0\}$ is the realized result for player A.

**(d) Aggregate.** A user's season total is
$$ P_{\text{season}} = \sum_{i} P_{\text{total}}^{(i)} . $$

---

## 6. HTTP API surface (backend, base path `/api`)

JSON in/out. CORS open in dev. Return typed errors as
`{ "error": { "code": "...", "message": "..." } }`.

```
GET  /api/health                         → { status, uptime_secs }
GET  /api/hub?user_id=:uuid              → { upcoming_matches[], standings[], active_forfeits[] }
GET  /api/matches                        → Match[]
GET  /api/matches/:id                    → Match
GET  /api/standings                      → GroupStanding[]
GET  /api/leaderboard                    → LeaderboardRow[]   (Elo + points)

POST /api/predictions                    → upsert {user_id, match_id, outcome, exact_home?, exact_away?}
                                           server REJECTS writes when now ≥ matches.lock_at (HTTP 409)
GET  /api/predictions?user_id=:uuid      → Prediction[]

# The Bloodline
POST /api/forfeits                        {challenger_id, opponent_id, match_id?, stake}     → Forfeit(pending)
POST /api/forfeits/:id/accept             → Forfeit(active)
POST /api/forfeits/:id/decline            → Forfeit(resolved)
POST /api/forfeits/:id/settle             {loser_id}            → Forfeit(unsettled)
POST /api/forfeits/:id/proof              {proof_url, proof_kind, caption?}  → Forfeit(unsettled)+HallOfShame
POST /api/forfeits/:id/nudge              → Forfeit (nudge or auto-resolve)
GET  /api/forfeits?user_id=:uuid&state=   → Forfeit[]

# Hall of Shame / tribunal
GET  /api/hall                            → HallEntry[]   (with vote tallies)
POST /api/hall/:entryId/vote              {voter_id, vote: 1|-1}   → tallies; may flip verified + resolve forfeit
```

Routes live in `backend/src/routes/{hub,matches,predictions,forfeits,hall}.rs`,
re-exported via `backend/src/routes/mod.rs` and mounted in `main.rs`.

---

## 7. Frontend spec (mobile-first)

SPA with a **bottom tab bar** (thumb-reachable) — 4 tabs:
`Hub` · `Predict` · `Bloodline` · `Shame`. Use `react-router-dom`.

- **Hub** (`src/views/Dashboard.tsx`): upcoming matches, group standings, active
  forfeits. The real-time dashboard.
- **Predict** (`src/views/PredictView.tsx`): wraps the EXISTING
  `components/MatchPredictionCenter.tsx` (do not rewrite it).
- **Bloodline** (`src/views/BloodlineView.tsx` + `components/ForfeitModal.tsx`):
  list of forfeits by state + a **Forfeit Creation modal** (challenge a friend,
  enter stake, pick a match). Reflect the 4 states with distinct visual chips.
- **Shame** (`src/views/HallOfShame.tsx`): proof ledger cards with image/video
  link preview + thumbs up/down tribunal voting.

**API client** in `src/api/client.ts` — `fetch` wrapper, base
`import.meta.env.VITE_API_BASE ?? 'http://localhost:8080/api'`. Types in
`src/types/models.ts` mirroring §3 (snake_case fields). Provide mock fallbacks so
views render without a backend.

**Wiring:** update `src/main.tsx` to render `<App/>` (a `BrowserRouter` shell with
the tab bar). Keep `index.css` minimal reset.

### Shared visual language (match the existing MatchPredictionCenter — "Broadcast Editorial")
Reuse these tokens so every view is cohesive:
```
--paper:#f1ece0; --paper-2:#e6dfce; --ink:#0d0d0b; --ink-2:#17170f;
--signal:#ff3a0e; --volt:#d6ff15; --muted:#7a7060;
fonts: 'Anton' (display caps), 'Archivo' (body), 'Space Mono' (data/labels)
motifs: hard offset shadows (e.g. 8px 8px 0 ink), uppercase Anton headers,
        Space Mono micro-labels, diagonal/skew accents. No soft purple gradients.
```

---

## 8. Coding standards (apply everywhere)

- **Metric system only.** Spacing in px/rem (document as metric); any physical
  quantity in SI (distance km, temp °C); log latency in ms, durations in seconds.
- **Performance:** Rust borrows over clones; one shared `PgPool` (connection
  pooling, `max_connections` tuned small for the Pi, e.g. 5). No N+1 in the
  leaderboard / standings queries.
- **Docs:** heavily commented, clean snippets. State machine → Chain-of-Thought
  comment first. Scoring → LaTeX comments.
- **Errors:** one `AppError` enum (`thiserror`) implementing `IntoResponse`.
- **Logging:** `tracing` with `RUST_LOG`/env-filter; structured, metric units.

---

## 9. Environment variables (names are fixed)
```
DATABASE_URL=postgres://wc:wc@db:5432/worldcup      # backend + ingest
APP_BIND_ADDR=0.0.0.0:8080                           # backend
RUST_LOG=info,worldcup_hub=debug                     # backend
VITE_API_BASE=http://localhost:8080/api              # frontend build-time
FIXTURE_FEED_URL=...                                 # python ingestion (optional)
INGEST_INTERVAL_SECS=300                             # python loop cadence (metric)
```
`.env.example` (DEVOPS) documents all of the above with safe defaults.
