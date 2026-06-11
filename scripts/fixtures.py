"""World Cup 2026 fixture domain model + sample data + feed normalisation.

This module is the *pure data* layer of the Python ingestion service. It has NO
network or database side effects, so ``python -m py_compile scripts/fixtures.py``
(and importing it) always succeeds without any external service.

Design notes
------------
* Target runtime is **CPython 3.9** (deployment Pi). Therefore this file uses
  ``typing.Optional`` / ``typing.List`` rather than the ``X | Y`` union syntax,
  and contains NO ``match``/``case`` statements.
* A :class:`Fixture` mirrors exactly the columns the ingestion writer (see
  ``ingest.upsert_fixtures``) sets on the ``matches`` table defined in
  ``backend/migrations/0001_init.sql``:

      ext_ref, home_team, away_team, group_label, venue, kickoff_at

  The DB-side ``lock_at`` column is **GENERATED ALWAYS** (kickoff_at − 1 minute)
  and therefore is deliberately NOT represented here — services must never set
  it. ``id``, ``status``, ``home_score``, ``away_score`` and ``created_at`` all
  carry DB defaults and are likewise not part of the ingestion payload.
* All timestamps are **ISO-8601 in UTC** (``...Z``). The schema stores
  ``kickoff_at`` as ``TIMESTAMPTZ`` (UTC); per the project's metric-only mandate
  every duration/interval elsewhere is expressed in SI seconds.
"""

# Standard-library imports only — this module stays dependency-free so it can be
# imported (and py_compiled) without the third-party packages installed.
from dataclasses import dataclass
from typing import List, Optional


# ---------------------------------------------------------------------------
# Domain model
# ---------------------------------------------------------------------------
@dataclass
class Fixture:
    """A single World Cup 2026 group-stage match, ready for upsert.

    Field names map one-to-one onto ``matches`` columns the ingestion service
    writes. ``ext_ref`` is the upstream feed's stable identifier and is the
    ``ON CONFLICT`` key that makes ingestion idempotent (UNIQUE in the schema).

    Attributes
    ----------
    ext_ref:
        Stable upstream id (e.g. ``"WC2026-M01"``). UNIQUE in ``matches`` and
        used as the conflict target so re-ingesting the same match updates it
        in place instead of inserting a duplicate.
    home_team / away_team:
        Team display names. The schema enforces ``home_team <> away_team``.
    group_label:
        Group-stage label, e.g. ``"GROUP A"`` (the contract example is
        ``"GROUP F"``). Optional — knockout fixtures have no group.
    venue:
        Stadium / city, e.g. ``"SoFi Stadium, Los Angeles"``. Optional.
    kickoff_at:
        Kickoff time as an ISO-8601 UTC string ending in ``Z``
        (e.g. ``"2026-06-11T20:00:00Z"``). Stored as ``TIMESTAMPTZ``; the DB
        derives ``lock_at = kickoff_at − 1 minute`` automatically.
    """

    # Required identifiers / fields (NOT NULL or conflict key in the schema).
    ext_ref: str
    home_team: str
    away_team: str
    kickoff_at: str

    # Nullable columns in the schema → Optional here. Default to None so callers
    # may omit them; the DB stores SQL NULL.
    group_label: Optional[str] = None
    venue: Optional[str] = None


# ---------------------------------------------------------------------------
# No bundled sample fixtures — this service is FEED-ONLY.
# ---------------------------------------------------------------------------
# Fixtures come EXCLUSIVELY from the upstream feed (FIXTURE_FEED_URL). There is
# deliberately no offline/sample set: the `matches` table must never contain
# fabricated data, so when the feed is unavailable the ingest writes nothing
# rather than inventing matches.


# ---------------------------------------------------------------------------
# Upstream feed normalisation
# ---------------------------------------------------------------------------
def normalize(raw: dict) -> Fixture:
    """Convert one raw upstream feed row into a typed :class:`Fixture`.

    Upstream feeds rarely match our column names exactly, so this function maps
    a small set of common aliases onto the canonical fields. It is intentionally
    forgiving on *naming* but strict on *presence* of the required fields, so a
    malformed row fails loudly here rather than producing a half-populated DB
    write downstream.

    Accepted aliases (first match wins):
      * ext_ref     <- "ext_ref" | "id" | "match_id"
      * home_team   <- "home_team" | "home" | "homeTeam"
      * away_team   <- "away_team" | "away" | "awayTeam"
      * kickoff_at  <- "kickoff_at" | "kickoff" | "kickoffTime" | "date"
      * group_label <- "group_label" | "group"            (optional)
      * venue       <- "venue" | "stadium"                (optional)

    Parameters
    ----------
    raw:
        A single decoded JSON object (Python ``dict``) from the feed.

    Returns
    -------
    Fixture
        A fully typed fixture ready for :func:`ingest.upsert_fixtures`.

    Raises
    ------
    ValueError
        If any required field (ext_ref, home_team, away_team, kickoff_at) is
        absent or empty.
    """

    def _first(keys: List[str]) -> Optional[str]:
        """Return the first non-empty string value among ``keys`` in ``raw``.

        We treat empty strings / whitespace-only values as "missing" so that a
        feed sending ``""`` does not slip past the required-field guard below.
        """
        for key in keys:
            value = raw.get(key)
            # Accept only non-empty, non-whitespace string-ish values.
            if value is not None and str(value).strip() != "":
                return str(value).strip()
        return None

    # --- Required fields: resolve via aliases, then validate presence. ------
    ext_ref = _first(["ext_ref", "id", "match_id"])
    home_team = _first(["home_team", "home", "homeTeam"])
    away_team = _first(["away_team", "away", "awayTeam"])
    kickoff_at = _first(["kickoff_at", "kickoff", "kickoffTime", "date"])

    # Collect every missing required field so the error message is actionable.
    missing: List[str] = []
    if ext_ref is None:
        missing.append("ext_ref")
    if home_team is None:
        missing.append("home_team")
    if away_team is None:
        missing.append("away_team")
    if kickoff_at is None:
        missing.append("kickoff_at")
    if missing:
        raise ValueError(
            "feed row is missing required field(s): " + ", ".join(missing)
        )

    # The schema enforces home_team <> away_team via a CHECK constraint; reject
    # the offending row here for a clearer error than a DB constraint violation.
    if home_team == away_team:
        raise ValueError(
            "feed row has identical home_team and away_team: " + home_team
        )

    # --- Optional fields: None when absent → stored as SQL NULL. ------------
    group_label = _first(["group_label", "group"])
    venue = _first(["venue", "stadium"])

    # mypy/readers: the four required values are guaranteed non-None by the
    # guard above, so constructing the dataclass is type-safe.
    return Fixture(
        ext_ref=ext_ref,
        home_team=home_team,
        away_team=away_team,
        kickoff_at=kickoff_at,
        group_label=group_label,
        venue=venue,
    )
