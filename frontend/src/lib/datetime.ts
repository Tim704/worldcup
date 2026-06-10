/**
 * datetime.ts — the Warm Almanac timezone engine (CONTRACT §7.3).
 * ----------------------------------------------------------------------------
 * The server speaks UTC ISO-8601 strings; the browser renders everything in
 * the USER'S local timezone via `Intl.DateTimeFormat` — no hand-rolled offsets,
 * no daylight-saving arithmetic. All durations below are metric SI units
 * (seconds, ms, min, h, days).
 *
 * Exports:
 *   - formatKickoff(iso)         "Today, 3:00 PM" · "Tomorrow, 8:00 PM" ·
 *                                "Saturday, 6:00 PM" (same week) ·
 *                                "Sat 13 Jun, 6:00 PM" (further out / past)
 *   - formatCountdown(iso, now?) "kicks off in 2 h 05 min" · "in 3 days" ·
 *                                "locked" once past the lock instant
 *   - dayKey(iso)                local-calendar grouping key (YYYY-MM-DD)
 *   - formatDayHeading(iso)      "Today" / "Tomorrow" / "Saturday 13 June"
 *   - displayState(match, now)   'upcoming' | 'live' | 'final'
 *   - isLocked(match, now)       now ≥ lock_at
 * ----------------------------------------------------------------------------
 */

import type { MatchStatus } from '../types/models';

/**
 * How long a kicked-off match is presumed "live" when the admin has not
 * flipped its status yet: 7 800 SI seconds = 130 min (90 min of play
 * + halftime + stoppage headroom).
 */
export const LIVE_WINDOW_SECS = 7800;

/** The fixed lock shift mirroring the DB GENERATED column: kickoff − 60 s. */
const LOCK_OFFSET_SECS = 60;

/* ---------------------------------------------------------------------------
 * Shared Intl formatters — constructed once at module scope (they are
 * relatively expensive to build) and reused for every call. `undefined`
 * locale = the browser's own locale, so Intl decides 12 h vs 24 h clocks.
 * ------------------------------------------------------------------------ */
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekdayLongFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const weekdayShortFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dayNumFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
const monthShortFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
const monthLongFmt = new Intl.DateTimeFormat(undefined, { month: 'long' });

/**
 * Local-calendar midnight (ms since epoch) for a given instant. Built from the
 * LOCAL year/month/day components so the day boundary is the user's own
 * midnight, not UTC's.
 */
function localMidnightMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Whole-calendar-day difference between `target` and `now` in the LOCAL
 * timezone: 0 = today, 1 = tomorrow, negative = past days. Math.round absorbs
 * the ±3 600 s wobble a DST transition can inject between two midnights.
 */
function calendarDayDiff(target: Date, now: Date): number {
  const DAY_MS = 86_400_000; // 86 400 SI seconds in ms
  return Math.round((localMidnightMs(target) - localMidnightMs(now)) / DAY_MS);
}

/**
 * Format a kickoff instant for display in the user's local timezone.
 *
 *   - same local day            → "Today, 3:00 PM"
 *   - next local day            → "Tomorrow, 8:00 PM"
 *   - within the same week
 *     (2–6 days ahead)          → "Saturday, 6:00 PM"
 *   - anything else (further
 *     ahead, or in the past)    → "Sat 13 Jun, 6:00 PM"
 *
 * The hour format is locale-aware — Intl decides 12 h vs 24 h.
 */
export function formatKickoff(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const time = timeFmt.format(t);
  const dd = calendarDayDiff(t, now);
  if (dd === 0) return `Today, ${time}`;
  if (dd === 1) return `Tomorrow, ${time}`;
  if (dd > 1 && dd < 7) return `${weekdayLongFmt.format(t)}, ${time}`;
  // Compose "Sat 13 Jun" from parts so the shape is stable across locales.
  return `${weekdayShortFmt.format(t)} ${dayNumFmt.format(t)} ${monthShortFmt.format(t)}, ${time}`;
}

/**
 * Human countdown to kickoff (metric units: min / h / days):
 *
 *   - past the lock instant (kickoff − 60 s) → "locked"
 *   - ≥ 2 days out                           → "in 3 days"
 *   - ≥ 1 h out                              → "kicks off in 2 h 05 min"
 *   - under an hour                          → "kicks off in 42 min"
 *
 * Because the lock sits 60 s before kickoff, an unlocked match is always at
 * least 1 min away — the countdown never reads "0 min".
 */
export function formatCountdown(iso: string, now: Date = new Date()): string {
  const kickoffMs = new Date(iso).getTime();
  const lockMs = kickoffMs - LOCK_OFFSET_SECS * 1000;
  if (now.getTime() >= lockMs) return 'locked';

  const diffSecs = Math.floor((kickoffMs - now.getTime()) / 1000);
  if (diffSecs >= 2 * 86_400) {
    // Round to the nearest whole day — "in 3 days" reads better than "in 71 h".
    return `in ${Math.round(diffSecs / 86_400)} days`;
  }
  const h = Math.floor(diffSecs / 3600);
  const min = Math.floor((diffSecs % 3600) / 60);
  if (h === 0) return `kicks off in ${min} min`;
  // Zero-pad minutes so the clock reads "2 h 05 min", not "2 h 5 min".
  return `kicks off in ${h} h ${String(min).padStart(2, '0')} min`;
}

/**
 * Stable grouping key for the day-grouped match feed: the LOCAL calendar date
 * as "YYYY-MM-DD". Two kickoffs share a key iff they land on the same local
 * day for this user.
 */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Day heading for the grouped feed: "Today" / "Tomorrow" / "Saturday 13 June"
 * (weekday long + day-of-month + month long, all in the user's locale).
 */
export function formatDayHeading(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const dd = calendarDayDiff(t, now);
  if (dd === 0) return 'Today';
  if (dd === 1) return 'Tomorrow';
  return `${weekdayLongFmt.format(t)} ${dayNumFmt.format(t)} ${monthLongFmt.format(t)}`;
}

/**
 * The UI's display state for a match (CONTRACT §7.3):
 *   - 'final' if the DB says final;
 *   - 'live'  if the DB says live, OR kickoff has passed and we are within
 *     LIVE_WINDOW_SECS (7 800 s = 130 min) of it — covers the gap before the
 *     admin flips the status;
 *   - 'upcoming' otherwise.
 */
export function displayState(
  match: { status: MatchStatus; kickoff_at: string },
  now: Date = new Date(),
): 'upcoming' | 'live' | 'final' {
  if (match.status === 'final') return 'final';
  if (match.status === 'live') return 'live';
  const kickoffMs = new Date(match.kickoff_at).getTime();
  const elapsedMs = now.getTime() - kickoffMs;
  if (elapsedMs >= 0 && elapsedMs <= LIVE_WINDOW_SECS * 1000) return 'live';
  return 'upcoming';
}

/**
 * Has the prediction/wager window closed? True once now ≥ lock_at.
 * Structurally typed so both Match and WagerView (which carries the joined
 * lock_at) can be passed directly.
 */
export function isLocked(match: { lock_at: string }, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(match.lock_at).getTime();
}
