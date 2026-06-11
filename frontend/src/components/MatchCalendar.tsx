/**
 * MatchCalendar.tsx
 * ----------------------------------------------------------------------------
 * The Matches tab's calendar lens: the (already lens/country-filtered) fixtures
 * laid out as month grids of LOCAL days. Each day that has fixtures shows its
 * match count and is tappable; the selected day's fixtures render below the
 * grid via the `renderMatch` prop, so they reuse MatchCard / MainEventCard
 * verbatim (predictions, lock, the table's calls — all inherited).
 *
 * Pure presentation, no fetch. Day grouping uses the same `dayKey` as the list
 * view, so the two lenses always agree on which day a kickoff lands.
 * ----------------------------------------------------------------------------
 */

import { useMemo, useState } from 'react';
import {
  dayKey,
  dayKeyOf,
  formatDayHeading,
  formatMonthYear,
  weekdayHeadersMonday,
} from '../lib/datetime';
import type { MatchWithMine } from '../types/models';

/** Monday-indexed weekday (Mon=0 … Sun=6) — how far into the week a date sits. */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Parse a local "YYYY-MM-DD" dayKey back into a local-midnight Date. */
function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Built once at module load (locale short names, Monday-first). */
const WEEKDAYS = weekdayHeadersMonday();

interface MatchCalendarProps {
  /** Already lens/country-filtered, kickoff-ASC. */
  matches: MatchWithMine[];
  now: Date;
  /** Render one fixture (the parent threads through MainEventCard / MatchCard). */
  renderMatch: (m: MatchWithMine) => JSX.Element;
}

export default function MatchCalendar({
  matches,
  now,
  renderMatch,
}: MatchCalendarProps): JSX.Element {
  // Group fixtures by local day.
  const byDay = useMemo(() => {
    const map = new Map<string, MatchWithMine[]>();
    for (const m of matches) {
      const k = dayKey(m.kickoff_at);
      const bucket = map.get(k);
      if (bucket) bucket.push(m);
      else map.set(k, [m]);
    }
    return map;
  }, [matches]);

  const dayKeys = useMemo(() => Array.from(byDay.keys()).sort(), [byDay]);

  // Selected day: an explicit pick (while it still has fixtures), else today if
  // it has any, else the first day that does.
  const todayKey = dayKeyOf(now);
  const [picked, setPicked] = useState<string | null>(null);
  const activeKey =
    picked && byDay.has(picked)
      ? picked
      : byDay.has(todayKey)
        ? todayKey
        : (dayKeys[0] ?? null);

  // Months to render: first fixture month → last fixture month, inclusive.
  const months = useMemo(() => {
    if (dayKeys.length === 0) return [];
    const first = parseDayKey(dayKeys[0]);
    const last = parseDayKey(dayKeys[dayKeys.length - 1]);
    const out: Array<{ year: number; month: number }> = [];
    let y = first.getFullYear();
    let m = first.getMonth();
    while (y < last.getFullYear() || (y === last.getFullYear() && m <= last.getMonth())) {
      out.push({ year: y, month: m });
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return out;
  }, [dayKeys]);

  const activeMatches = activeKey ? byDay.get(activeKey) ?? [] : [];

  return (
    <div className="cal">
      {months.map(({ year, month }) => {
        const firstOfMonth = new Date(year, month, 1);
        const pad = mondayIndex(firstOfMonth); // blank cells before day 1
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const cellCount = Math.ceil((pad + daysInMonth) / 7) * 7; // whole weeks
        return (
          <section key={`${year}-${month}`} className="cal-month">
            <h2 className="cal-month-label">{formatMonthYear(firstOfMonth)}</h2>
            <div className="cal-grid">
              {WEEKDAYS.map((w) => (
                <span key={w} className="cal-weekday">
                  {w}
                </span>
              ))}
              {Array.from({ length: cellCount }, (_, i) => {
                const dayNum = i - pad + 1;
                if (dayNum < 1 || dayNum > daysInMonth) {
                  // Padding cell (previous/next month) — blank, not tappable.
                  // eslint-disable-next-line react/no-array-index-key
                  return <span key={i} className="cal-day cal-day--empty" aria-hidden="true" />;
                }
                const k = dayKeyOf(new Date(year, month, dayNum));
                const dayMatches = byDay.get(k);
                const has = dayMatches !== undefined;
                const cls = [
                  'cal-day',
                  has ? 'cal-day--has' : '',
                  k === todayKey ? 'cal-day--today' : '',
                  k === activeKey ? 'cal-day--on' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    // eslint-disable-next-line react/no-array-index-key
                    key={i}
                    type="button"
                    className={cls}
                    disabled={!has}
                    aria-pressed={k === activeKey}
                    aria-label={has ? `${dayNum}, ${dayMatches!.length} matches` : `${dayNum}`}
                    onClick={() => setPicked(k)}
                  >
                    <span className="cal-day-num">{dayNum}</span>
                    {has && <span className="cal-day-count">{dayMatches!.length}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {activeKey && activeMatches.length > 0 && (
        <section className="section cal-daylist">
          <h2 className="day-heading">{formatDayHeading(activeMatches[0].kickoff_at, now)}</h2>
          <div className="stack">{activeMatches.map((m) => renderMatch(m))}</div>
        </section>
      )}
    </div>
  );
}
