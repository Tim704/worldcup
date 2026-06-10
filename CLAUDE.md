# Project Context: The Almanac Cup — World Cup 2026

## Tech Stack
- Frontend: React 18 + TypeScript (strict) + Vite 5 SPA in `frontend/` — "Warm Almanac" design system (`src/styles/almanac.css`), no UI frameworks.
- Backend: Node 20+/Express + TypeScript (strict, NodeNext) in `server/` — raw parameterised SQL via one shared `pg.Pool` (max 5) → PostgreSQL 16; plain-SQL migrations auto-applied on boot by `src/migrate.ts`.
- Ingest: Python fixture-ingestion loop in `scripts/` (unchanged from v1).
- Legacy: `backend/` (Rust/Axum, v1) is kept for reference only — it is no longer built or deployed; do not extend it.
- Infrastructure: Docker Compose on Raspberry Pi 4/5 (arm64) — `platform: linux/arm64`, healthchecks, metric memory limits. Local-first development (`server`: `npm run dev`; `frontend`: Vite dev server proxying `/api` → :8080).

## Architectural Mandates
- Prioritize performance and execution efficiency: single shared connection pool, parameterised SQL only, no N+1 queries, batch updates in single statements.
- Provide clean, heavily documented code snippets.
- Use the metric system exclusively for all measurements, UI elements, and logging (e.g., durations in seconds, latency in ms, margins in pixels/cm, weights in kg, temperatures in Celsius).
- For complex algorithmic problems, utilize a Chain of Thought derivation in comments before outputting the final function (e.g., the wager-resolution guards in `server/src/lib/wagers.ts`); the scoring function documents its piecewise formula as LaTeX in a comment.
- `docs/CONTRACT.md` (v2) is the single source of truth — match table/column names, enum values, route paths, JSON field names, env var names and CSS tokens literally.
