# Fixture Ingestion (Python)

Pulls **World Cup 2026** fixtures from an optional upstream HTTP feed and
idempotently upserts them into the PostgreSQL `matches` table defined in
[`backend/migrations/0001_init.sql`](../backend/migrations/0001_init.sql).

This is the `ingest` service in the docker-compose topology (it has no exposed
port — it only writes to the `db` service).

## Files (this service owns these only)

| File               | Purpose                                                        |
|--------------------|----------------------------------------------------------------|
| `fixtures.py`      | Pure data layer: `Fixture` dataclass + `normalize()`. No I/O, no sample data. |
| `ingest.py`        | Entrypoint: load env, fetch (feed → sample fallback), upsert, loop. |
| `requirements.txt` | Pinned deps (`requests`, `psycopg2-binary`, `python-dotenv`) with arm64 wheels. |

> `scripts/Dockerfile` is owned by the **DEVOPS** agent, not this service.

## Runtime

* **CPython 3.9** (matches the Raspberry Pi deployment). The code avoids
  `match`/`case` and `X | Y` union types, using `typing.Optional` / `List` etc.
* **Metric-only:** every duration is in **SI seconds**; latency is logged in
  milliseconds (ms).

## Required / optional environment variables

These names are fixed by the build contract (`docs/CONTRACT.md` §9). They are
read from a `.env` file (via `python-dotenv`) and/or the process environment;
real environment variables take precedence over `.env`.

| Variable               | Required | Default | Meaning                                                       |
|------------------------|----------|---------|---------------------------------------------------------------|
| `DATABASE_URL`         | **yes**  | —       | psycopg2 connection string, e.g. `postgres://wc:wc@db:5432/worldcup`. |
| `FIXTURE_FEED_URL`     | no       | —       | Upstream HTTP feed of fixtures. If unset/unreachable, the bundled sample set is used. |
| `INGEST_INTERVAL_SECS` | no       | `300`   | Loop cadence in **SI seconds** (300 s = 5 minutes).           |

## Install

```bash
pip install -r scripts/requirements.txt
```

## Run

Run from the `scripts/` directory (so `ingest.py` can `import fixtures`).

**Single-shot** — one fetch + upsert pass, then exit (ideal for cron / manual seeding):

```bash
cd scripts
DATABASE_URL=postgres://wc:wc@localhost:5432/worldcup python ingest.py --once
```

**Continuous loop** — re-ingest every `INGEST_INTERVAL_SECS` seconds:

```bash
cd scripts
DATABASE_URL=postgres://wc:wc@localhost:5432/worldcup \
INGEST_INTERVAL_SECS=300 \
FIXTURE_FEED_URL=https://example.com/wc2026/fixtures.json \
python ingest.py
```

`FIXTURE_FEED_URL` is **required** — this service is feed-only. There is no
bundled sample/offline set: the `matches` table must never contain fabricated
data, so a missing or failing feed leaves it untouched.

## Fetch behaviour (feed-only, no fallback)

`fetch_fixtures(feed_url)`:

1. No `FIXTURE_FEED_URL` → log an error and return `[]` (writes nothing).
2. Otherwise `GET` the feed (10 s timeout). The response may be a bare JSON array
   or an object with a `"fixtures"` array. Each row is mapped through
   `fixtures.normalize()`, which accepts common field aliases (`home`/`homeTeam`,
   `kickoff`/`date`, …) and validates that the required fields are present.
3. **Any** failure (network error, non-2xx status, malformed JSON, empty list,
   all-invalid rows) logs an error and returns `[]`. The caller upserts nothing,
   so the table keeps whatever real fixtures it already holds and the next pass
   simply retries — a feed blip can never replace real data with fakes.

## Upsert / idempotency design

`upsert_fixtures(conn, fixtures)` writes via a single **parameterised** statement
per row (`%s` placeholders bound by psycopg2 — no string interpolation), batched
through `executemany` and committed as one transaction (rolled back on error):

```sql
INSERT INTO matches (
    ext_ref, home_team, away_team, group_label, venue, kickoff_at
)
VALUES (%s, %s, %s, %s, %s, %s)
ON CONFLICT (ext_ref) DO UPDATE SET
    home_team   = EXCLUDED.home_team,
    away_team   = EXCLUDED.away_team,
    group_label = EXCLUDED.group_label,
    venue       = EXCLUDED.venue,
    kickoff_at  = EXCLUDED.kickoff_at;
```

Key points, all derived from `0001_init.sql`:

* **`ext_ref` is the conflict key** (it is `UNIQUE` in the schema). Re-ingesting
  the same match **updates it in place** instead of inserting a duplicate — this
  is what makes ingestion idempotent and safe to run on every loop tick.
* **`lock_at` is never set.** It is a `GENERATED ALWAYS AS (kickoff_at − INTERVAL
  '1 minute') STORED` column; assigning to it is a hard SQL error. The
  prediction lock rule lives entirely in the database.
* **`id`, `status`, `home_score`, `away_score`, `created_at` are not written.**
  They take their DB defaults on insert and are left untouched on update, so the
  ingestion service never clobbers live match `status` or scores that the
  backend may have set.

## Safety: import has no side effects

Every network/database call lives below the `if __name__ == "__main__":` guard in
`ingest.py`, and the third-party imports (`requests`, `psycopg2`, `dotenv`) are
deferred into the functions that use them. As a result:

```bash
python -m py_compile scripts/fixtures.py scripts/ingest.py   # succeeds with no DB / deps
```

This satisfies the contract's DB-less build/verify phase.
