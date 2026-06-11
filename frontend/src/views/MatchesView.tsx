/**
 * MatchesView.tsx
 * ----------------------------------------------------------------------------
 * The fixtures tab (CONTRACT §7.2/§7.4):
 *   - lens chips: all · main events · upcoming · finished;
 *   - a country filter (any team in the schedule) + a list/calendar view toggle;
 *   - LIST view: matches grouped by LOCAL calendar day under Fraunces 600
 *     headings; featured matches get the Main Event hero treatment inline;
 *   - CALENDAR view: month grids of local days, tap a day to list its fixtures
 *     (see MatchCalendar). Both views share the same filtered set.
 *
 * Data freshness: 60 s (60 000 ms) refetch, cleared on unmount and paused while
 * document.hidden (CONTRACT §7.4).
 * ----------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import EmptyState, { ErrorCard, LoadingCard } from '../components/EmptyState';
import MainEventCard from '../components/MainEventCard';
import MatchCard from '../components/MatchCard';
import MatchCalendar from '../components/MatchCalendar';
import { dayKey, displayState, formatDayHeading } from '../lib/datetime';
import type { MatchWithMine } from '../types/models';

/** The four feed lenses. */
type FilterKey = 'all' | 'main' | 'upcoming' | 'finished';

/** How the filtered set is laid out. */
type ViewMode = 'list' | 'calendar';

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'all' },
  { key: 'main', label: 'main events' },
  { key: 'upcoming', label: 'upcoming' },
  { key: 'finished', label: 'finished' },
];

/** Refetch cadence: 60 s, in metric SI seconds (CONTRACT §7.4). */
const REFETCH_MS = 60_000;

export default function MatchesView(): JSX.Element {
  const [matches, setMatches] = useState<MatchWithMine[] | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [country, setCountry] = useState<string>(''); // '' = all countries
  const [view, setView] = useState<ViewMode>('list');

  const load = useCallback(async (): Promise<void> => {
    try {
      setMatches(await api.listMatches()); // kickoff_at ASC from the server
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // Initial fetch + 60 s polling, paused while the document is hidden.
  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, REFETCH_MS);
    const onVisible = (): void => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  if (failed && matches === null) return <ErrorCard onRetry={() => void load()} />;
  if (matches === null) return <LoadingCard />;

  const now = new Date();

  // Every team in the schedule, alphabetised, for the country dropdown.
  const countries = Array.from(
    new Set(matches.flatMap((m) => [m.home_team, m.away_team])),
  ).sort((a, b) => a.localeCompare(b));

  // Apply the active lens AND the country filter (both must pass).
  const filtered = matches.filter((m) => {
    const lensOk =
      filter === 'all'
        ? true
        : filter === 'main'
          ? m.is_featured
          : filter === 'upcoming'
            ? displayState(m, now) === 'upcoming'
            : displayState(m, now) === 'final';
    const countryOk = country === '' || m.home_team === country || m.away_team === country;
    return lensOk && countryOk;
  });

  // One renderer shared by both views so the card behaviour can never drift.
  const renderMatch = (m: MatchWithMine): JSX.Element =>
    m.is_featured ? (
      <MainEventCard key={m.id} match={m} onSaved={() => void load()} />
    ) : (
      <MatchCard key={m.id} match={m} onSaved={() => void load()} />
    );

  // Day groups for the list view (filtered arrives kickoff-ASC; Map preserves
  // insertion order, so groups iterate chronologically for free).
  const groups = new Map<string, MatchWithMine[]>();
  for (const m of filtered) {
    const key = dayKey(m.kickoff_at);
    const bucket = groups.get(key);
    if (bucket) bucket.push(m);
    else groups.set(key, [m]);
  }

  return (
    <div>
      <span className="kicker">fixtures &amp; results</span>
      <h1 className="view-title">the fixtures</h1>

      <div className="filters" role="group" aria-label="filter the feed">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip chip--small${filter === f.key ? ' on' : ''}`}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="matches-controls">
        <select
          className="input select--inline"
          aria-label="filter by country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          <option value="">all countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="seg" role="group" aria-label="view">
          <button
            type="button"
            className={`chip chip--small${view === 'list' ? ' on' : ''}`}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            list
          </button>
          <button
            type="button"
            className={`chip chip--small${view === 'calendar' ? ' on' : ''}`}
            aria-pressed={view === 'calendar'}
            onClick={() => setView('calendar')}
          >
            calendar
          </button>
        </div>
      </div>

      {matches.length === 0 && (
        <div className="section">
          <EmptyState message="no fixtures yet. the ingest checks in soon." />
        </div>
      )}

      {matches.length > 0 && filtered.length === 0 && (
        <div className="section">
          <EmptyState message="nothing under these filters. try another." />
        </div>
      )}

      {/* CALENDAR view */}
      {filtered.length > 0 && view === 'calendar' && (
        <MatchCalendar matches={filtered} now={now} renderMatch={renderMatch} />
      )}

      {/* LIST view */}
      {filtered.length > 0 &&
        view === 'list' &&
        Array.from(groups.entries()).map(([key, list]) => (
          <section key={key}>
            <h2 className="day-heading">{formatDayHeading(list[0].kickoff_at, now)}</h2>
            <div className="stack">{list.map((m) => renderMatch(m))}</div>
          </section>
        ))}
    </div>
  );
}
