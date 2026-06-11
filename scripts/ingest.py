"""World Cup 2026 fixture-ingestion service (Python entrypoint).

Pulls fixtures from the upstream HTTP feed (``FIXTURE_FEED_URL``) and
idempotently upserts them into the PostgreSQL ``matches`` table defined in
``backend/migrations/0001_init.sql``. If the feed is missing or unavailable the
table is left **UNTOUCHED** and an error is logged — the service NEVER seeds
fake data. The bundled :data:`fixtures.SAMPLE_FIXTURES` load only on an explicit
``--sample`` run, for local development.

Runtime / safety contract
-------------------------
* Target **CPython 3.9** — no ``match``/``case``, no ``X | Y`` unions; we use
  ``typing.Optional`` / ``typing.List`` etc.
* **All** network and database side effects are guarded behind
  ``if __name__ == "__main__":`` at the very bottom of this file. Importing this
  module — and ``python -m py_compile scripts/ingest.py`` — therefore performs
  no I/O and needs no live database, exactly as the build contract requires.
* SQL is **always parameterised** (``%s`` placeholders bound by psycopg2). No
  Python value is ever string-formatted into a query.
* The database connection is opened from ``DATABASE_URL`` and is guaranteed to
  be closed in a ``finally`` block.

Metric-only mandate
-------------------
Every duration in this service is expressed in **SI seconds**. The loop cadence
``INGEST_INTERVAL_SECS`` defaults to ``300`` (5 minutes = 300 s); log lines
report elapsed wall-clock latency in milliseconds (ms).
"""

# --- Standard library --------------------------------------------------------
import argparse
import logging
import os
import time
from typing import Any, List, Optional, Sequence, Tuple

# --- Local pure-data module (no side effects on import) ----------------------
import fixtures
from fixtures import Fixture

# Third-party imports (requests, psycopg2, dotenv) are intentionally deferred
# into the functions that need them. Keeping them out of module scope means
# `python -m py_compile` and a bare `import ingest` succeed even when those
# packages are not installed (e.g. in the contract's DB-less build phase).


# ---------------------------------------------------------------------------
# Logging — structured, metric units (latency in ms, durations in seconds)
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [ingest] %(message)s",
)
log = logging.getLogger("ingest")


# ---------------------------------------------------------------------------
# Configuration (environment variables — names are fixed by the contract)
# ---------------------------------------------------------------------------
# Default loop cadence in SI seconds (300 s = 5 minutes). Centralised so the
# value is documented in exactly one place.
DEFAULT_INGEST_INTERVAL_SECS = 300

# HTTP timeout for the upstream feed request, in SI seconds. Kept short so the
# loop never blocks for long on a slow/unreachable feed before falling back.
FEED_HTTP_TIMEOUT_SECS = 10


def load_config() -> "dict[str, Any]":
    """Load configuration from a ``.env`` file + the process environment.

    Reads the three contract-defined variables:

    * ``DATABASE_URL``        — required; psycopg2 connection string.
    * ``FIXTURE_FEED_URL``    — optional; upstream HTTP feed of fixtures.
    * ``INGEST_INTERVAL_SECS``— optional; loop cadence in **SI seconds**
                                (default ``300``).

    Returns
    -------
    dict
        Keys: ``database_url`` (Optional[str]), ``feed_url`` (Optional[str]),
        ``interval_secs`` (int).
    """
    # Imported lazily so module import stays side-effect-free / dependency-free.
    from dotenv import load_dotenv

    # load_dotenv() is a no-op when there is no .env file; real environment
    # variables always take precedence over .env entries.
    load_dotenv()

    database_url = os.environ.get("DATABASE_URL")
    feed_url = os.environ.get("FIXTURE_FEED_URL")  # optional

    # Parse the metric-seconds interval, tolerating a malformed value.
    raw_interval = os.environ.get("INGEST_INTERVAL_SECS")
    interval_secs = DEFAULT_INGEST_INTERVAL_SECS
    if raw_interval is not None and raw_interval.strip() != "":
        try:
            interval_secs = int(raw_interval)
            if interval_secs <= 0:
                raise ValueError("must be a positive number of seconds")
        except ValueError as exc:
            log.warning(
                "INGEST_INTERVAL_SECS=%r is invalid (%s); "
                "falling back to %d s",
                raw_interval,
                exc,
                DEFAULT_INGEST_INTERVAL_SECS,
            )
            interval_secs = DEFAULT_INGEST_INTERVAL_SECS

    return {
        "database_url": database_url,
        "feed_url": feed_url,
        "interval_secs": interval_secs,
    }


# ---------------------------------------------------------------------------
# Fetch — upstream feed with offline fallback
# ---------------------------------------------------------------------------
def fetch_fixtures(feed_url: Optional[str]) -> List[Fixture]:
    """Return the current fixture list from the upstream feed.

    Behaviour:

    1. If ``feed_url`` is falsy (not configured), log an error and return an
       EMPTY list — we never silently seed fake data.
    2. Otherwise ``GET`` the feed. The response is expected to be JSON: either a
       top-level array of rows, or an object with a ``"fixtures"`` array. Each
       row is normalised via :func:`fixtures.normalize`.
    3. On *any* error (network failure, bad status, malformed JSON, empty list)
       we log an error and return an EMPTY list. The caller upserts nothing, so
       the ``matches`` table keeps whatever real fixtures it already holds and
       the next pass simply retries — a feed blip can never replace real data
       with samples.

    Parameters
    ----------
    feed_url:
        Optional upstream URL from ``FIXTURE_FEED_URL``.

    Returns
    -------
    List[Fixture]
        The feed's fixtures, or ``[]`` when the feed is unset/unavailable.
    """
    if not feed_url:
        log.error(
            "FIXTURE_FEED_URL is not configured; leaving the matches table "
            "untouched (no sample fallback). Set FIXTURE_FEED_URL, or run with "
            "--sample to deliberately load the bundled samples for local dev.",
        )
        return []

    # Imported lazily so the module stays importable without `requests`.
    import requests

    try:
        log.info("fetching fixtures from upstream feed: %s", feed_url)
        # Measure round-trip latency in milliseconds (metric).
        started = time.monotonic()
        response = requests.get(feed_url, timeout=FEED_HTTP_TIMEOUT_SECS)
        elapsed_ms = (time.monotonic() - started) * 1000.0
        response.raise_for_status()
        payload = response.json()

        # Accept either a bare array or an object wrapping a "fixtures" array.
        if isinstance(payload, dict):
            rows = payload.get("fixtures", [])
        else:
            rows = payload

        if not isinstance(rows, list) or len(rows) == 0:
            raise ValueError("feed returned no fixture rows")

        parsed: List[Fixture] = []
        for row in rows:
            if not isinstance(row, dict):
                log.warning("skipping non-object feed row: %r", row)
                continue
            try:
                parsed.append(fixtures.normalize(row))
            except ValueError as exc:
                # One bad row should not abort the whole batch.
                log.warning("skipping malformed feed row: %s", exc)

        if len(parsed) == 0:
            raise ValueError("no valid fixtures after normalisation")

        log.info(
            "fetched %d fixtures from feed in %.1f ms",
            len(parsed),
            elapsed_ms,
        )
        return parsed

    except Exception as exc:  # noqa: BLE001 — deliberately broad: never seed fakes.
        log.error(
            "feed fetch failed (%s); leaving the matches table untouched "
            "(no sample fallback) — will retry on the next pass.",
            exc,
        )
        return []


# ---------------------------------------------------------------------------
# Upsert — idempotent write into the `matches` table
# ---------------------------------------------------------------------------
# Parameterised upsert statement. Columns and the conflict target mirror
# backend/migrations/0001_init.sql EXACTLY:
#
#   * We set only ext_ref, home_team, away_team, group_label, venue, kickoff_at.
#   * We DELIBERATELY do NOT set `lock_at` — it is GENERATED ALWAYS in the
#     schema (kickoff_at − 1 minute) and assigning to it is a hard SQL error.
#   * `id`, `status`, `home_score`, `away_score`, `created_at` are left to their
#     DB defaults on insert and untouched on update (we never clobber live
#     scores or status that the backend may have written).
#   * ON CONFLICT (ext_ref) makes re-ingesting the same match idempotent: it
#     updates the descriptive columns in place instead of inserting a duplicate.
#     `EXCLUDED.<col>` refers to the row we attempted to insert.
_UPSERT_SQL = """
    INSERT INTO matches (
        ext_ref, home_team, away_team, group_label, venue, kickoff_at
    )
    VALUES (%s, %s, %s, %s, %s, %s)
    ON CONFLICT (ext_ref) DO UPDATE SET
        home_team   = EXCLUDED.home_team,
        away_team   = EXCLUDED.away_team,
        group_label = EXCLUDED.group_label,
        venue       = EXCLUDED.venue,
        kickoff_at  = EXCLUDED.kickoff_at
"""


def upsert_fixtures(conn: Any, fixtures_to_write: Sequence[Fixture]) -> int:
    """Idempotently upsert ``fixtures_to_write`` into the ``matches`` table.

    Uses a single parameterised statement per row via ``executemany`` and
    commits the whole batch as one transaction. On any error the transaction is
    rolled back so the table is never left partially written.

    Parameters
    ----------
    conn:
        An open psycopg2 connection (typed ``Any`` to avoid importing psycopg2
        at module scope — see the module docstring).
    fixtures_to_write:
        The fixtures to persist.

    Returns
    -------
    int
        The number of rows submitted (inserted or updated).
    """
    if len(fixtures_to_write) == 0:
        log.info("no fixtures to upsert")
        return 0

    # Build the parameter tuples in the EXACT column order of _UPSERT_SQL.
    params: List[Tuple[Any, ...]] = []
    for fx in fixtures_to_write:
        params.append(
            (
                fx.ext_ref,
                fx.home_team,
                fx.away_team,
                fx.group_label,
                fx.venue,
                fx.kickoff_at,
            )
        )

    started = time.monotonic()
    cursor = conn.cursor()
    try:
        # executemany issues one parameterised INSERT ... ON CONFLICT per row.
        cursor.executemany(_UPSERT_SQL, params)
        conn.commit()
    except Exception:
        # Roll back so a mid-batch failure leaves the table consistent.
        conn.rollback()
        log.exception("upsert failed; transaction rolled back")
        raise
    finally:
        cursor.close()

    elapsed_ms = (time.monotonic() - started) * 1000.0
    log.info(
        "upserted %d fixtures into matches in %.1f ms",
        len(params),
        elapsed_ms,
    )
    return len(params)


# ---------------------------------------------------------------------------
# One ingestion pass: fetch → connect → upsert → close
# ---------------------------------------------------------------------------
def run_once(database_url: str, feed_url: Optional[str], use_samples: bool = False) -> int:
    """Perform a single fetch-and-upsert cycle and return the row count.

    Opens a fresh psycopg2 connection from ``database_url`` and guarantees it is
    closed in a ``finally`` block, even on error. When ``use_samples`` is True
    (the explicit ``--sample`` dev path) the bundled sample fixtures are written
    instead of fetching the feed; the normal path NEVER seeds samples.
    """
    # Imported lazily — see module docstring re: keeping import side-effect-free.
    import psycopg2

    if use_samples:
        current: List[Fixture] = list(fixtures.SAMPLE_FIXTURES)
        log.info("seeding %d bundled sample fixtures (--sample)", len(current))
    else:
        current = fetch_fixtures(feed_url)

    conn = psycopg2.connect(database_url)
    try:
        return upsert_fixtures(conn, current)
    finally:
        # Always release the connection back to the OS / pool.
        conn.close()


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
def main(argv: Optional[List[str]] = None) -> int:
    """Service entrypoint: single-shot (``--once``) or continuous loop.

    With ``--once`` the service performs exactly one ingestion pass and exits.
    Otherwise it loops forever, sleeping ``INGEST_INTERVAL_SECS`` **SI seconds**
    between passes (default 300 s). A transient error inside the loop is logged
    and the loop continues after the normal sleep, so the service self-heals.

    Returns
    -------
    int
        Process exit code (0 on success).
    """
    parser = argparse.ArgumentParser(
        description=(
            "World Cup 2026 fixture ingestion: upserts fixtures into the "
            "matches table. Durations are SI seconds."
        )
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="run a single ingestion pass and exit (default: loop forever)",
    )
    parser.add_argument(
        "--sample",
        action="store_true",
        help=(
            "deliberately seed the bundled sample fixtures once and exit "
            "(LOCAL DEVELOPMENT ONLY — the normal feed path never seeds samples)"
        ),
    )
    args = parser.parse_args(argv)

    config = load_config()
    database_url = config["database_url"]
    feed_url = config["feed_url"]
    interval_secs = config["interval_secs"]  # SI seconds

    # DATABASE_URL is mandatory for any DB write.
    if not database_url:
        log.error("DATABASE_URL is not set; cannot connect to PostgreSQL")
        return 1

    if args.sample:
        # Explicit local-dev seeding of the bundled samples — one pass, exit.
        run_once(database_url, feed_url, use_samples=True)
        return 0

    if args.once:
        # Single-shot mode: run one pass; let exceptions surface as a non-zero
        # exit so an operator / orchestrator notices the failure.
        run_once(database_url, feed_url)
        return 0

    # Continuous loop. INGEST_INTERVAL_SECS is the cadence in metric SI seconds.
    log.info(
        "starting ingestion loop; interval = %d s (SI seconds)",
        interval_secs,
    )
    while True:
        try:
            run_once(database_url, feed_url)
        except Exception:  # noqa: BLE001 — keep the loop alive across errors.
            # Log and continue: a transient DB/feed blip must not kill the
            # long-running service. The next pass runs after the normal sleep.
            log.exception("ingestion pass failed; will retry after interval")

        # Sleep the configured cadence (SI seconds) before the next pass.
        log.info("sleeping %d s until next ingestion pass", interval_secs)
        time.sleep(interval_secs)


# ===========================================================================
# IMPORTANT: every network / database SIDE EFFECT lives below this guard.
# Importing this module (or `python -m py_compile`) runs none of it, so the
# contract's DB-less build phase always succeeds.
# ===========================================================================
if __name__ == "__main__":
    raise SystemExit(main())
