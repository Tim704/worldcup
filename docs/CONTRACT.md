# The Almanac Cup — World Cup 2026 · Build Contract v2 (authoritative)

> **This file is the single source of truth.** It SUPERSEDES Contract v1
> (Rust/Axum backend, "Broadcast Editorial" frontend, Bloodline/Hall-of-Shame).
> v2 replaces the backend with **Node 20+/Express + TypeScript** under
> `server/`, simplifies scoring to **5/2/0**, replaces the Bloodline with a
> **public Wagers marketplace**, adds **passwordless username auth** and
> **featured "Main Event" matches**, and restyles the entire SPA to the
> **"Warm Almanac"** design system. The Python ingest service
> (`scripts/`) and the nginx proxy (`deploy/nginx/nginx.conf`) are **UNCHANGED**.
> When in doubt, match this document literally. Do not invent alternative table
> names, enum values, route paths or env-var names.

---

## 1. Topology & file ownership

```
worldcup/
├── server/       Node/Express + TS API → PostgreSQL      [agent: SERVER owns — NEW]
│   ├── package.json, tsconfig.json, Dockerfile
│   ├── migrations/0001_init.sql (+ .down.sql)
│   └── src/** (index, db, migrate, middleware, lib, routes)
├── backend/      LEGACY Rust API — leave untouched, no longer deployed
├── frontend/     React 18 + TS + Vite 5 SPA              [agent: FRONTEND owns src/**, index.html, vite.config.ts]
├── scripts/      Python ingest — UNCHANGED (do not edit)
├── deploy/nginx/ nginx.conf — UNCHANGED (still proxies /api/ → backend service :8080)
├── docs/CONTRACT.md   this file (already written — read only)
├── docker-compose.yml, .env.example, .dockerignore,
│   README.md, CLAUDE.md                                  [agent: DEVOPS owns]
```

**File ownership is exclusive.** An agent writes ONLY the files assigned above.
The compose **service name stays `backend`** (nginx resolves it by that name);
only its build context changes to `./server`.

Deployment target is unchanged: Raspberry Pi 4/5, arm64, Docker Compose,
`platform: linux/arm64`, `restart: unless-stopped`, healthchecks, metric memory
limits (db 512 MiB · backend 256 MiB · ingest 128 MiB · frontend 64 MiB).

---

## 2. Tech stack & pinned dependencies

**Server (`server/`)** — TypeScript strict, ES2022, `module: NodeNext`.

```jsonc
// dependencies
"express": "^4.19.2", "pg": "^8.12.0", "jsonwebtoken": "^9.0.2",
"cors": "^2.8.5", "dotenv": "^16.4.5"
// devDependencies
"typescript": "^5.6.3", "tsx": "^4.19.0", "@types/node": "^22",
"@types/express": "^4.17.21", "@types/pg": "^8.11.6",
"@types/jsonwebtoken": "^9.0.6", "@types/cors": "^2.8.17"
```

Scripts: `dev` = `tsx watch src/index.ts` · `build` = `tsc -p tsconfig.json` ·
`start` = `node dist/index.js` · `test` = `tsx --test src/lib/scoring.test.ts src/lib/wagers.test.ts`.

No ORM. Raw SQL through one shared `pg.Pool` (`max: 5` — Pi-sized), always
parameterised (`$1`-style binds). Migrations are plain `.sql` files applied by
`src/migrate.ts` on boot (tracked in a `schema_migrations(version, applied_at)`
table, each file in a transaction, idempotent, with a connect-retry loop —
30 attempts × 2 s — so the Pi's slow Postgres start never kills the container).

**Frontend** — React 18 + TypeScript (strict, `noUnusedLocals`,
`noUnusedParameters`) + Vite 5 + `react-router-dom@^6`. **NO new npm
dependencies.** Add a dev-server proxy in `vite.config.ts`:
`server: { proxy: { '/api': 'http://localhost:8080' } }`.

**Python** `scripts/` — untouched. It upserts
`matches(ext_ref, home_team, away_team, group_label, venue, kickoff_at)` with
`ON CONFLICT (ext_ref)`; the v2 schema MUST keep those columns and the unique
`ext_ref` so ingest keeps working verbatim.

---

## 3. Database schema (canonical DDL — `server/migrations/0001_init.sql`)

The migration first **drops the legacy v1 objects** (sanctioned: the tournament
has not started; fixtures re-ingest automatically within
`INGEST_INTERVAL_SECS`), then creates the v2 schema. Mirror this DDL exactly:

```sql
-- v1 → v2 upgrade: legacy objects out (CASCADE), pgcrypto for gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DROP TABLE IF EXISTS shame_votes, hall_of_shame, forfeits, predictions, matches, users CASCADE;
DROP TYPE  IF EXISTS outcome_1x2, proof_kind, forfeit_state, match_status, wager_state, wager_pick CASCADE;
DROP FUNCTION IF EXISTS calc_lock_time(TIMESTAMPTZ);

CREATE TYPE match_status AS ENUM ('scheduled', 'live', 'final');
CREATE TYPE wager_state  AS ENUM ('PENDING', 'ACCEPTED', 'RESOLVED_WON', 'RESOLVED_LOST');
CREATE TYPE wager_pick   AS ENUM ('home', 'draw', 'away');

CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username     TEXT        NOT NULL,
    display_name TEXT        NOT NULL,
    is_admin     BOOLEAN     NOT NULL DEFAULT false,
    total_points INTEGER     NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_username_not_blank CHECK (length(btrim(username)) > 0)
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

-- IMMUTABLE wrapper so the GENERATED column below is legal (fixed 60 s shift
-- is timezone-independent; `timestamptz - interval` alone is only STABLE).
CREATE FUNCTION calc_lock_time(k_time TIMESTAMPTZ) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE AS $$ SELECT k_time - INTERVAL '1 minute'; $$;

CREATE TABLE matches (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ext_ref     TEXT UNIQUE,                  -- ingest idempotency key (KEEP)
    home_team   TEXT         NOT NULL,
    away_team   TEXT         NOT NULL,
    group_label TEXT,
    venue       TEXT,
    kickoff_at  TIMESTAMPTZ  NOT NULL,
    lock_at     TIMESTAMPTZ  GENERATED ALWAYS AS (calc_lock_time(kickoff_at)) STORED,
    status      match_status NOT NULL DEFAULT 'scheduled',
    home_score  SMALLINT     CHECK (home_score IS NULL OR home_score >= 0),
    away_score  SMALLINT     CHECK (away_score IS NULL OR away_score >= 0),
    is_featured BOOLEAN      NOT NULL DEFAULT false,   -- "Main Event" flag
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT matches_distinct_teams CHECK (home_team <> away_team)
);
CREATE INDEX idx_matches_kickoff  ON matches (kickoff_at);
CREATE INDEX idx_matches_status   ON matches (status);
CREATE INDEX idx_matches_featured ON matches (is_featured) WHERE is_featured;

CREATE TABLE predictions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    match_id       UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    pred_home      SMALLINT    NOT NULL CHECK (pred_home BETWEEN 0 AND 20),
    pred_away      SMALLINT    NOT NULL CHECK (pred_away BETWEEN 0 AND 20),
    points_awarded INTEGER,                   -- NULL until the match is final
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT predictions_one_per_user_match UNIQUE (user_id, match_id)
);
CREATE INDEX idx_predictions_match ON predictions (match_id);
CREATE INDEX idx_predictions_user  ON predictions (user_id);

CREATE TABLE wagers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id    UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    creator_id  UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    acceptor_id UUID        REFERENCES users(id)            ON DELETE SET NULL,
    pick        wager_pick  NOT NULL,
    margin      SMALLINT    CHECK (margin IS NULL OR margin BETWEEN 1 AND 10),
    claim       TEXT        NOT NULL CHECK (length(btrim(claim)) BETWEEN 3 AND 140),
    forfeit     TEXT        CHECK (forfeit IS NULL OR length(btrim(forfeit)) BETWEEN 3 AND 140),
    state       wager_state NOT NULL DEFAULT 'PENDING',
    winner_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
    loser_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    CONSTRAINT wagers_distinct_parties CHECK (acceptor_id IS NULL OR acceptor_id <> creator_id),
    CONSTRAINT wagers_margin_needs_side CHECK (margin IS NULL OR pick <> 'draw')
);
CREATE INDEX idx_wagers_state ON wagers (state);
CREATE INDEX idx_wagers_match ON wagers (match_id);
```

`0001_init.down.sql` reverses everything created here (tables, types, function,
extension left in place). All timestamps are TIMESTAMPTZ (UTC). API JSON
serialises them as ISO-8601 UTC strings.

---

## 4. Scoring algorithm (5/2/0) — `server/src/lib/scoring.ts`

Pure, unit-tested function; document the piecewise formula in a comment
(LaTeX-style, repo tradition). For prediction $(p_h, p_a)$ vs final score
$(a_h, a_a)$:

$$
P =
\begin{cases}
5 & \text{if } p_h = a_h \wedge p_a = a_a & (\text{exact score})\\
2 & \text{if } \operatorname{sgn}(p_h - p_a) = \operatorname{sgn}(a_h - a_a) & (\text{correct outcome})\\
0 & \text{otherwise}
\end{cases}
$$

Tiers exclusive, checked top-down. `sgn` equality means: home-win predicted &
home won, draw predicted & drawn, away predicted & away won. Season total
$= \sum P$ over final matches.

**Settlement pipeline** (`server/src/lib/settle.ts` → `settleMatch(id, home, away)`,
ONE transaction):
1. `UPDATE matches SET home_score=$1, away_score=$2, status='final' WHERE id=$3`.
2. Fetch all predictions for the match; compute points with the **pure TS
   function** (it is the source of truth, not SQL); write back in ONE statement
   via `UPDATE predictions p SET points_awarded = v.pts, updated_at = now()
   FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::int[]) AS pts) v WHERE p.id = v.id`.
3. Recompute every user's total in ONE statement (no N+1):
   `UPDATE users u SET total_points = COALESCE((SELECT SUM(p.points_awarded) FROM predictions p WHERE p.user_id = u.id AND p.points_awarded IS NOT NULL), 0)`.
4. Resolve this match's ACCEPTED wagers (§5), batch-updated the same way.
5. Commit. Re-submitting a corrected score MUST be idempotent: the same
   pipeline re-runs and may flip points and wager outcomes.

`settleMatch` has TWO callers: `POST /api/admin/matches/:id/score` (manual /
correction) and the **automatic live-score poller** (`server/src/lib/liveScores.ts`).
The poller (enabled only when `FOOTBALL_DATA_TOKEN` is set, §8) polls
football-data.org every `LIVE_POLL_SECS`: in-play matches get the running score
+ `status='live'` (display only, no settlement); a FINISHED match is settled
exactly once via `settleMatch`, then never re-touched (a row already `final` is
skipped). The admin route remains for corrections.

---

## 5. Wager lifecycle — `server/src/lib/wagers.ts`

A wager is a machine-evaluable public boast: `pick` (home/draw/away) plus an
optional `margin` ("wins by ≥ N goals", only for non-draw picks), with a
human `claim` for display. States (exactly these four, from the **creator's**
perspective): `PENDING → ACCEPTED → RESOLVED_WON | RESOLVED_LOST`.

| from     | event                       | guard                                              | to            | effects |
|----------|-----------------------------|----------------------------------------------------|---------------|---------|
| —        | create                      | auth; match exists; `now < lock_at`; valid fields  | PENDING       | row inserted |
| PENDING  | accept `{forfeit}`          | auth; acceptor ≠ creator; `now < lock_at`; forfeit text 3–140 chars | ACCEPTED | set `acceptor_id`, `forfeit`, `accepted_at` |
| PENDING  | delete (creator only)       | state still PENDING                                | (row deleted) | — |
| ACCEPTED | settle (admin score submit) | match final                                        | RESOLVED_WON / RESOLVED_LOST | set `winner_id`, `loser_id`, `resolved_at` |

Resolution rule (pure function, precede it with a `// Chain of Thought:` comment
deriving each guard — repo tradition): with final diff $d = a_h - a_a$,

- `actual = d > 0 ? 'home' : d < 0 ? 'away' : 'draw'`
- creator wins iff `pick === actual && (margin == null || |d| >= margin)`
- creator wins → `RESOLVED_WON`, `winner_id = creator_id`, `loser_id = acceptor_id`;
  otherwise `RESOLVED_LOST` with the ids swapped. **The loser owes the `forfeit`.**

PENDING wagers whose match locks without an acceptor stay PENDING in the DB but
are no longer acceptable (guard) and the UI shows them as "expired, unclaimed".

---

## 6. Auth (passwordless) & HTTP API surface (base `/api`)

**Login = upsert by username.** `POST /api/auth/login {username, display_name?}`
— trim; validate `^[A-Za-z0-9_ ]{2,20}$`; lookup `lower(username)`; create if
absent (display_name defaults to the username as typed). If the lowercased
username appears in env `ADMIN_USERNAMES` (comma-separated), set
`is_admin = true` on every login. Respond `{ token, user }`.

**Token:** JWT HS256 signed with env `APP_SECRET`, payload `{ sub: user.id,
username }`, expiry 90 days. Client sends `Authorization: Bearer <token>`;
the SPA persists it in `localStorage` (key `almanac_token`). Middleware:
`requireAuth` (401 `UNAUTHENTICATED`), `optionalAuth`, `requireAdmin`
(403 `FORBIDDEN`, checks `users.is_admin` from the DB, not the token).

**Errors:** every error is `{ "error": { "code": "...", "message": "..." } }`
via one `AppError` class + Express error middleware. Codes used:
`VALIDATION` 400 · `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 ·
`MATCH_LOCKED` 409 · `WAGER_CONFLICT` 409 · `INTERNAL` 500.

```
GET  /api/health                          → { status: 'ok', uptime_secs }      (uptime in metric SI seconds)
POST /api/auth/login                      → { token, user: User }
GET  /api/auth/me              (auth)     → User

GET  /api/matches              (opt auth) → MatchWithMine[]  kickoff_at ASC; my_prediction joined when authed
GET  /api/matches/next         (opt auth) → { match: MatchWithMine | null }    first match with lock_at > now
GET  /api/matches/:id          (opt auth) → MatchWithMine
GET  /api/matches/:id/predictions (opt auth) → PredictionWithUser[]  commit-to-reveal: once now ≥ lock_at (anyone) OR caller has saved their own call for it; else 409 MATCH_LOCKED

POST /api/predictions          (auth)     {match_id, pred_home, pred_away} → Prediction
                                           upsert on (user_id, match_id); 409 MATCH_LOCKED when now ≥ lock_at; scores 0–20
GET  /api/predictions/mine     (auth)     → Prediction[]

GET  /api/leaderboard                     → LeaderboardRow[]

GET  /api/wagers?state=&user_id=          → WagerView[] newest first (joined usernames + match info)
POST /api/wagers               (auth)     {match_id, pick, margin?, claim} → WagerView
POST /api/wagers/:id/accept    (auth)     {forfeit} → WagerView
DELETE /api/wagers/:id         (auth)     creator only, PENDING only → { deleted: true }

POST /api/admin/matches/:id/score   (admin) {home_score, away_score} → { match, predictions_scored, wagers_resolved }
POST /api/admin/matches/:id/feature (admin) {is_featured} → Match
POST /api/admin/matches/:id/status  (admin) {status: 'scheduled'|'live'} → Match   ('final' only via /score)
```

Leaderboard in ONE query (no N+1), ranked by `total_points` DESC, ties broken
by exact hits DESC then `lower(username)` ASC, rank via `DENSE_RANK()`:

```sql
SELECT u.id AS user_id, u.username, u.display_name, u.total_points,
       COUNT(p.id) FILTER (WHERE p.points_awarded = 5)        AS exact_hits,
       COUNT(p.id) FILTER (WHERE p.points_awarded = 2)        AS outcome_hits,
       COUNT(p.id) FILTER (WHERE p.points_awarded IS NOT NULL) AS predictions_settled,
       DENSE_RANK() OVER (ORDER BY u.total_points DESC)        AS rank
FROM users u LEFT JOIN predictions p ON p.user_id = u.id
GROUP BY u.id
ORDER BY u.total_points DESC, exact_hits DESC, lower(u.username) ASC;
```

Server layout: `src/index.ts` (boot: dotenv → migrate → mount → listen on
`PORT`, default 8080, log a structured line per request: method, path, status,
latency in ms), `src/db.ts` (Pool), `src/migrate.ts`, `src/error.ts`,
`src/middleware/auth.ts`, `src/lib/{scoring,wagers,validate}.ts` (+ `.test.ts`
for scoring & wagers using `node:test`), `src/routes/{auth,matches,predictions,leaderboard,wagers,admin,health}.ts`,
`src/types.ts`. CORS open. Request bodies via `express.json()`.

### Shared API types (TS interfaces — snake_case fields, both sides)

```ts
User           { id, username, display_name, is_admin, total_points, created_at }
Match          { id, ext_ref, home_team, away_team, group_label, venue, kickoff_at,
                 lock_at, status: 'scheduled'|'live'|'final', home_score, away_score, is_featured }
MatchWithMine  = Match & { my_prediction: Prediction | null }
Prediction     { id, user_id, match_id, pred_home, pred_away, points_awarded, created_at, updated_at }
PredictionWithUser = Prediction & { username, display_name }
LeaderboardRow { rank, user_id, username, display_name, total_points, exact_hits, outcome_hits, predictions_settled }
WagerView      { id, match_id, creator_id, acceptor_id, pick: 'home'|'draw'|'away', margin,
                 claim, forfeit, state: 'PENDING'|'ACCEPTED'|'RESOLVED_WON'|'RESOLVED_LOST',
                 winner_id, loser_id, created_at, accepted_at, resolved_at,
                 creator_username, acceptor_username, winner_username, loser_username,
                 home_team, away_team, kickoff_at, lock_at, match_status, home_score, away_score }
```

Numeric SQL aggregates (`COUNT`, `SUM`, `DENSE_RANK`) come back from `pg` as
strings — cast to `Number` before responding.

---

## 7. Frontend spec — the "Warm Almanac" realization

### 7.1 Design system (STRICT — do not deviate)

A cozy printed-paper aesthetic with neo-brutalist bones: cream paper, ink
borders, hard offset shadows (zero blur), Fraunces serif display + Hanken
Grotesk body. Risograph zine meets field journal. Refined, not loud. Every
screen reads as a well-made paper object. No Material UI / Bootstrap / Tailwind.

All tokens and base components live in **`frontend/src/styles/almanac.css`**
(imported once in `main.tsx`); view-specific styles may be co-located
`<style>` blocks but MUST consume the CSS variables.

```css
:root {
  --bg: #FBF6EC; --ink: #2B2420; --card: #FFFDF8; --inset: #FBF6EC;
  --muted: #6B5F54; --muted2: #8A7E72;
  --accent: #E9A23B; --gold: #B08442;
  --track: #EADFCE; --hero: #FFF6E4;
  --hair: rgba(43,36,32,.12); --hair2: rgba(43,36,32,.25);
  --shadow: rgba(43,36,32,.9); --focus: rgba(43,36,32,.08);
  --grad1: rgba(233,162,59,.18); --grad2: rgba(42,157,143,.16);
  color-scheme: light;
}
[data-theme="dark"] {
  --bg: #15120D; --ink: #F1E7D6; --card: #221C15; --inset: #2B241B;
  --muted: #C7BAA6; --muted2: #9E9282;
  --accent: #E9A23B; --gold: #D9B271;
  --track: #3A3329; --hero: #2A2017;
  --hair: rgba(241,231,214,.14); --hair2: rgba(241,231,214,.26);
  --shadow: rgba(0,0,0,.55); --focus: rgba(241,231,214,.1);
  --grad1: rgba(233,162,59,.10); --grad2: rgba(42,157,143,.10);
  color-scheme: dark;
}
```

Identity/jewel palette for state & charts: gold `#E9A23B` · teal `#2A9D8F` ·
coral `#E8654F` · forest `#2E9E5B` · blue `#2D65A4` · violet `#6C5CE7`.
Text on light accents = `#2B2420`; on dark fills = `#FFF7EA`.
`--ink` is for text and EVERY border; `--hair`/`--hair2` are for divider
lines/gridlines ONLY — never box outlines.

Background (never flat):
```css
body {
  background:
    radial-gradient(1200px 600px at 80% -20%, var(--grad1), transparent 60%),
    radial-gradient(900px 500px at -10% 110%, var(--grad2), transparent 60%),
    var(--bg);
}
```

Typography — load via Google Fonts (rewrite `src/lib/fonts.ts`, same
idempotent-loader pattern):
`https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Hanken+Grotesk:wght@400;500;600;700&display=swap`
- Fraunces 900 — big numbers, hero clocks, scores ("stamped" numerals).
- Fraunces 600 — card headings, day/section headers.
- Hanken Grotesk — all body, buttons, labels.
- Kicker — 11–12 px, `letter-spacing:.28em`, uppercase, 700, color `--gold`. Use above sections.
- Numbers: `font-variant-numeric: tabular-nums;`.

Three structural signatures (everywhere):
1. `border: 1.5px solid var(--ink)` on every surface (cards, inputs, chips, buttons).
2. Hard offset shadow, zero blur: cards `6px 6px 0 var(--shadow)`, buttons `3px 3px 0`, small things `2px 2px 0`.
3. Press interaction: hover `transform:translate(-1px,-1px)`; active
   `transform:translate(2px,2px); box-shadow:1px 1px 0 var(--shadow)`.

Radii: cards 18–22 px · inputs/buttons 12 px · inset cells 14–16 px · pills
999 px · tiny badges 6 px. Selected/active states get an ink fill ("pressed on").

Base classes (implement verbatim in almanac.css, then extend):
```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Hanken Grotesk', sans-serif; color: var(--ink); min-height: 100vh; padding: 28px 18px 60px; }
.wrap { max-width: 760px; margin: 0 auto; }
.kicker { font-size: 12px; letter-spacing: .28em; text-transform: uppercase; font-weight: 700; color: var(--gold); }
.title { font-family: 'Fraunces', serif; font-weight: 900; line-height: .95; font-size: clamp(38px, 9vw, 68px); letter-spacing: -.02em; }
.sub { font-size: 15px; color: var(--muted); max-width: 46ch; }
.card { background: var(--card); border: 1.5px solid var(--ink); border-radius: 22px; padding: 22px; box-shadow: 6px 6px 0 var(--shadow); }
.card h2 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 22px; }
.hint { font-size: 13px; color: var(--muted); }
.btn { font-family: inherit; font-weight: 600; background: var(--accent); color: #2B2420; border: 1.5px solid var(--ink); border-radius: 12px; padding: 13px 22px; cursor: pointer; box-shadow: 3px 3px 0 var(--shadow); transition: transform .08s, box-shadow .08s; }
.btn:hover { transform: translate(-1px, -1px); }
.btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--shadow); }
.input { width: 100%; font: inherit; background: var(--inset); border: 1.5px solid var(--ink); border-radius: 12px; padding: 12px 14px; outline: none; }
.input:focus { box-shadow: 3px 3px 0 var(--focus); }
.chip { font-weight: 700; border: 1.5px solid var(--ink); border-radius: 999px; padding: 11px 20px; cursor: pointer; background: var(--card); box-shadow: 3px 3px 0 var(--shadow); }
.chip.on { background: var(--ink); color: var(--card); }
```

Match-state jewel coding: upcoming → gold chip; **live** → coral `#E8654F`
chip (text `#FFF7EA`) with a subtle pulse; **final** → ink-filled chip.
Featured "Main Event" cards: `background: var(--hero)`, bigger Fraunces type,
bolder presence (still 1.5px ink border + 6px shadow).

Voice & copy: warm, witty, a little self-aware; short sentences; lowercase ease
in the small print; no marketing-speak, no exclamation spam, never "Welcome
to…". Canned strings (use these exact ones where they fit):
- empty matches: `no fixtures yet. the ingest checks in soon.`
- empty market: `the market is quiet. someone say something confident.`
- empty leaderboard: `no points yet. the theory is untested.`
- login hint: `no passwords. just don't pick your friend's name.`
- locked match: `locked. the ball is rolling.`

Accessibility: visible `:focus-visible` outline (`2px solid var(--ink)`,
`outline-offset: 2px`), `aria-label`s on the tab bar and icon buttons, modals
are `role="dialog"` `aria-modal="true"`, close on Escape and backdrop click.
Respect `prefers-reduced-motion`.

Theme: `data-theme` on `<html>`; default = `prefers-color-scheme`; toggle in
the header; persist as localStorage `almanac_theme`.

### 7.2 App structure (files)

```
src/styles/almanac.css     design system (above)
src/lib/fonts.ts           Fraunces + Hanken Grotesk loader (rewrite)
src/lib/datetime.ts        timezone engine (below)
src/api/client.ts          fetch wrapper: API_BASE = import.meta.env.VITE_API_BASE || '/api';
                           injects Bearer token; unwraps { error } envelope into a typed ApiError
src/types/models.ts        interfaces from §6 (snake_case)
src/state/AuthContext.tsx  AuthProvider + useAuth(); token in localStorage 'almanac_token';
                           on boot re-validates via GET /api/auth/me (drop token on 401)
src/App.tsx                shell: AuthProvider → unauthenticated? LoginView :
                           BrowserRouter + routes + bottom tab bar + theme toggle
src/main.tsx               imports styles/almanac.css + index.css, renders <App/>
src/index.css              minimal reset only (update body bg to var(--bg))
src/views/LoginView.tsx    hero card: kicker 'the almanac · wc 2026', .title, username input, btn
src/views/HubView.tsx      NextUpWidget + Main Events rail + top-3 leaderboard snippet + my open wagers
src/views/MatchesView.tsx  filter chips (all · main events · upcoming · finished), day-grouped feed
src/views/LeaderboardView.tsx  full rankings
src/views/WagersView.tsx   open market · mine · settled ledger; composer + accept modals
src/views/AdminView.tsx    admin-only: score entry, feature & live toggles
src/components/MatchCard.tsx, ScoreStepper.tsx, NextUpWidget.tsx,
   MainEventCard.tsx, WagerCard.tsx, WagerComposerModal.tsx,
   AcceptWagerModal.tsx, Modal.tsx, StateChip.tsx, EmptyState.tsx
```

**DELETE** (legacy, replaced — git history preserves them):
`src/views/Dashboard.tsx`, `src/views/PredictView.tsx`,
`src/views/BloodlineView.tsx`, `src/views/HallOfShame.tsx`,
`src/components/MatchPredictionCenter.tsx`, `src/components/ForfeitModal.tsx`.

Routes & bottom tab bar (mobile-first, thumb-reachable, Warm Almanac styling —
paper bar, ink top border, active tab = ink-filled "pressed" pill):
`/hub` Hub · `/matches` Matches · `/table` Table · `/wagers` Wagers
(+ `/admin` tab visible only when `user.is_admin`). Default → `/hub`.
`index.html`: title `The Almanac Cup · WC 2026`, `theme-color` `#FBF6EC`.

### 7.3 Timezone engine — `src/lib/datetime.ts`

Server times are UTC ISO strings; format in the BROWSER's local timezone via
`Intl.DateTimeFormat` (no hand-rolled offsets). Exports:
- `formatKickoff(iso): string` — `Today, 3:00 PM` · `Tomorrow, 8:00 PM` ·
  same week `Saturday, 6:00 PM` · else `Sat 13 Jun, 6:00 PM` (locale-aware
  hour format — let Intl decide 12/24 h).
- `formatCountdown(iso, now?): string` — `kicks off in 2 h 05 min`,
  `in 3 days`, `locked` when past lock (durations in metric units: min/h/days).
- `dayKey(iso)` + `formatDayHeading(iso)` — grouping for the feed
  (`Today` / `Tomorrow` / `Saturday 13 June`).
- `displayState(match, now): 'upcoming'|'live'|'final'` — `final` if status
  final; `live` if status live OR (`now ≥ kickoff_at` and within
  `LIVE_WINDOW_SECS = 7800` — 130 min in SI seconds); else `upcoming`.
- `isLocked(match, now): boolean` — `now ≥ lock_at`.

### 7.4 Behaviour requirements

- **NextUpWidget (Actionable Prompt):** shows the chronologically next
  unlocked match (`GET /api/matches/next`) with an inline `ScoreStepper`
  (− / value / + per side, 0–20, Fraunces 900 numerals) and a save button —
  `your call: Brazil 2 – 1 France` once saved; editable until lock; countdown
  line beneath. When nothing is upcoming: a quiet card, `nothing to call.
  the almanac rests.`
- **Match feed:** grouped by local day with Fraunces 600 day headings;
  Main Events pinned in a hero rail on top of the Hub AND given hero styling
  inside the feed. Each card: teams (Fraunces 600), group/venue small print,
  local time via `formatKickoff`, StateChip, my prediction (or stepper until
  lock), final score in Fraunces 900 with my earned points badge (`+5 exact` /
  `+2 outcome` / `0`) once final.
- **Predictions privacy (commit-to-reveal):** others' predictions for a match
  become visible once it locks OR once the caller has saved their own call for
  it (server enforces; UI offers a "the table's calls" expander whenever it is
  revealable — pre-lock once you've predicted, plus all locked/final cards). A
  pre-lock peek carries a "still moving" note since calls remain editable until
  kickoff.
- **Leaderboard:** rank numerals Fraunces 900; chips for exact/outcome hit
  counts; the signed-in user's row ink-filled ("pressed on"); top three get
  jewel-tone rank badges (gold/teal/coral).
- **Wagers:** market shows PENDING wagers on unlocked matches (accept button
  opens AcceptWagerModal: shows the claim + match, REQUIRES typing a forfeit,
  confirm = `seal it`). Composer modal: pick an unlocked match, side chips
  (home/draw/away), optional margin stepper (`by 2+ goals`), claim text.
  "mine" lists wagers I created/accepted with state chips
  (PENDING gold · ACCEPTED teal · RESOLVED_WON forest · RESOLVED_LOST coral);
  creator can withdraw while PENDING. "settled" ledger reads
  `@loser owes @winner: <forfeit>`.
- **Admin:** score inputs + `make it official` button per match (calls
  /score, then refreshes), feature toggle (`main event` chip), live toggle.
  Hidden from non-admins (route guard + no tab).
- **Data freshness:** Hub & Matches refetch every 60 s (clear on unmount,
  pause when `document.hidden`).
- **Errors/loading:** every view has a loading hint (`checking the post…`)
  and an error card with a retry button (`the wire is down. try again.`).

---

## 8. Environment variables (names fixed)

```
DATABASE_URL=postgres://wc:wc@db:5432/worldcup   # server + ingest
PORT=8080                                        # server bind port
APP_SECRET=change-me-please                      # JWT signing secret (HS256)
ADMIN_USERNAMES=tom                              # comma-separated admin usernames
VITE_API_BASE=/api                               # frontend build-time API base ('/api' = same-origin nginx proxy)
FIXTURE_FEED_URL=http://localhost:8091/fixtures  # python ingest feed — REQUIRED (feed-only; no sample fallback)
INGEST_INTERVAL_SECS=300                         # ingest cadence, SI seconds
FOOTBALL_DATA_TOKEN=                             # server: enables the live-score + auto-settlement poller (football-data.org); unset = disabled
LIVE_POLL_SECS=60                                # server: live-score poll cadence, SI seconds (floor 20)
FD_COMPETITION=WC                                # server: football-data competition code
FD_EXT_REF_PREFIX=FD-                            # server: ext_ref prefix matching the ingest adapter (FD-<id>)
```

`APP_BIND_ADDR` and `RUST_LOG` are RETIRED. The server warns loudly when
`APP_SECRET` is unset (dev fallback `dev-secret-change-me`). The live-score
poller is OFF unless `FOOTBALL_DATA_TOKEN` is set, so the API runs fine without
it (e.g. local dev).

---

## 9. DevOps deltas (docker-compose / Dockerfile / docs)

- `docker-compose.yml`: `backend` service now `build: { context: ./server }`;
  env block per §8 (`DATABASE_URL`, `PORT`, `APP_SECRET`, `ADMIN_USERNAMES`,
  with `${VAR:-default}` passthrough); healthcheck switches to BusyBox wget:
  `wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1`;
  everything else (ports, mem limits, arm64 pins, health-gated depends_on,
  frontend build args) unchanged.
- `server/Dockerfile`: multi-stage on `node:22-alpine` — builder runs `npm ci`
  + `npm run build`; runtime installs `npm ci --omit=dev`, copies `dist/` and
  `migrations/`, `EXPOSE 8080`, `CMD ["node", "dist/index.js"]`. Migrations
  auto-apply on boot.
- `.dockerignore`: ensure `server/node_modules` and `server/dist` are excluded.
- `frontend/Dockerfile` & `deploy/nginx/nginx.conf`: unchanged.
- `README.md` + `CLAUDE.md`: rewrite stack description (Node/Express + TS),
  update run/deploy/migration instructions (migrations run automatically on
  container start; first v2 boot DROPS legacy v1 tables — fixtures re-ingest
  automatically), document the new env vars and admin setup, keep the Pi
  deployment guide, replace Bloodline/Hall-of-Shame references with the
  Wagers marketplace, note `backend/` (Rust) is legacy and no longer built.

## 10. Coding standards

Metric/SI units everywhere (durations in seconds, latency logged in ms).
Heavily documented code; the scoring function carries the LaTeX formula
comment; the wager resolution carries a `// Chain of Thought:` derivation.
TypeScript strict on both sides; no `any` unless quarantined at the SQL
boundary with a typed cast. One shared pool, parameterised SQL only, no N+1.
Frontend: function components + hooks only; fetch through `api/client.ts`;
all visible copy follows §7 voice.

## 11. Tournament Predictor (v2.1 extension)

A per-user whole-tournament prediction: the group stage called group by group,
then an interactive knockout tree from the round of 32 down to the champion.
Everything below follows the v2 conventions in §2–§10 (snake_case wire fields,
parameterised SQL, one pool, error envelope, Warm Almanac tokens only).

### 11.1 Schema — `server/migrations/0002_bracket_predictions.sql` (reversible)

```sql
CREATE TABLE bracket_predictions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_picks   JSONB       NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(group_picks) = 'object'),
    third_picks   JSONB       NOT NULL DEFAULT '[]'::jsonb
                  CHECK (jsonb_typeof(third_picks) = 'array'),
    bracket_picks JSONB       NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(bracket_picks) = 'object'),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT bracket_predictions_one_per_user UNIQUE (user_id)
);
```

The prophecy is ONE document per user, replaced atomically (it is internally
interdependent — a group re-order cascades through the knockout tree).
Down-migration: `0002_bracket_predictions.down.sql` drops the table.

### 11.2 Document shapes (validated by `server/src/lib/bracketPicks.ts`)

- `group_picks` — `{ "A": ["Mexico", …], … }`: per group letter (A–L), the
  predicted finishing order; index 0 = group winner; ≤ 4 distinct trimmed
  team names (1–60 chars); PARTIAL orders are legal.
- `third_picks` — `[ "A", "C", … ]`: ≤ 8 distinct group letters whose
  3rd-placed team takes a best-third berth (letters, not names, so a group
  re-order re-points the pick automatically).
- `bracket_picks` — `{ "M74": "Mexico", … }`: picked winner per knockout
  slot, keyed by FIFA match number `M73`–`M102`, `M104` (M103, the
  third-place match, is not part of the predictor).

Team names are NOT cross-checked against `matches` (the document is
self-referential and a user can only corrupt their own prophecy).

### 11.3 Routes — `server/src/routes/bracket.ts`, mounted at `/api/bracket`

| method · path             | auth | body                                          | →                                        |
|---------------------------|------|-----------------------------------------------|------------------------------------------|
| GET  `/api/bracket`         | yes  | —                                             | `{ bracket: BracketPrediction \| null }`  |
| GET  `/api/bracket/:userId` | yes  | —                                             | `{ user, bracket: BracketPrediction \| null }` — browse another player's tree (read-only); 404 on unknown player |
| POST `/api/bracket`         | yes  | `{ group_picks, third_picks, bracket_picks }` | upserted `BracketPrediction`              |

No lock guard: the bracket is a season-long living document. Upsert is a
single `INSERT … ON CONFLICT (user_id) DO UPDATE` statement; all three JSONB
params are `JSON.stringify`-ed and cast `::jsonb` (a bare JS array would be
encoded as a Postgres array literal otherwise).

### 11.4 Shared API type (both `server/src/types.ts` & `frontend/src/types/models.ts`)

```ts
export type BracketGroupPicks = Record<string, string[]>;
export type BracketThirdPicks = string[];
export type BracketSlotPicks  = Record<string, string>;

export interface BracketPrediction {
  id: string;
  user_id: string;
  group_picks: BracketGroupPicks;
  third_picks: BracketThirdPicks;
  bracket_picks: BracketSlotPicks;
  created_at: string; // ISO-8601 UTC
  updated_at: string; // ISO-8601 UTC
}
```

### 11.5 Frontend — route `/bracket`, tab "Bracket"

- `views/BracketView.tsx` — two lenses ("group stage" | "knockout"), explicit
  save with dirty flag, one parallel fetch on mount (matches + my bracket +
  leaderboard), no polling. A "whose prophecy" people picker (from the
  leaderboard) flips the whole view between MY editable picks and any other
  player's READ-ONLY tree (`GET /api/bracket/:userId`); the knockout lens is a
  real two-sided bracket — eight flow columns (`R32 R16 QF SF · SF QF R16 R32`)
  on an explicit CSS grid, each tie row-SPANS so it sits centred between the two
  it feeds from, with gray pseudo-element connector lines. The FINAL is lifted
  out and crowns the two middle semi-finals from ABOVE (a `⊓` connector drops
  onto both). It breaks out to full viewport width and scrolls when it can't
  fit, above a champion hero naming the losing finalist.
- `lib/bracket.ts` — the engine: the OFFICIAL FIFA WC2026 knockout chart
  (matches 73–104), `groupsFromMatches` (groups derive from the live
  `/api/matches` feed, never hardcoded), `assignThirdBerths` (maximum
  bipartite matching of picked thirds onto the 8 conditional berth slots),
  `resolveBracket` (one forward pass; prunes every pick whose premise died —
  the "reset the downstream branch" behaviour), `bracketColumns` (splits the
  resolved tree into the left/right halves — by the semi-final each feeds —
  that converge on the centred final). Slot-key set mirrors
  `server/src/lib/bracketPicks.ts` — keep in sync.
- `lib/flags.ts` — team name → flag emoji, graceful null fallback.
- Components: `TeamRow` (flag + name + rank dot + jewel status pill; `selected`
  gold fill, `muted` strike-through for an eliminated side), `GroupCard`
  (tap-to-rank), `BracketMatchup` (tap-to-advance). All three accept a
  `readOnly` flag (withhold taps) so the same pure components render another
  player's tree.
- CSS: the "Tournament Predictor" block in `almanac.css` — tokens only; classes
  `.group-grid .group-card .group-head .team-row .team-flag .team-row-name
  .team-row--out .rank-dot .thirds-chips .predictor-people .bracket-scroll
  .bracket-grid .bk-head .bk-count .bk-cell (.bk-left/.bk-right,
  .bk-child/.bk-parent, .bk-up/.bk-down) .bk-finalcell .bk-final-label
  .bk-final-conn .bracket-match .bracket-match--decided .champion-card
  .champion-trophy .champion-name .savebar`. `.bracket-grid` is 8 columns ×
  `auto repeat(16, --bk-row)`; ties place via inline `grid-column`/`grid-row …
  / span N` (N doubling per round) so feeders' centres straddle their parent
  exactly; connectors are `.bk-cell` pseudo-element borders (gray `--bk-line`).
  `.bk-finalcell` spans the two middle columns above the semis, its
  `.bk-final-conn` a `⊓` of `--bk-line`. `.bracket-scroll` full-bleeds out of
  the 760px column from 760px up (with `body { overflow-x: hidden }`) and
  scrolls horizontally when the tree can't fit. `.tabbar` scrolls (six tabs).

### 11.6 Scoring

Out of scope for v2.1 — the prophecy is bragging rights only. A future
settlement would follow §4's pattern (pure function + one transaction).
