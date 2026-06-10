/**
 * MatchesView.tsx
 * ----------------------------------------------------------------------------
 * The day-grouped fixture feed (CONTRACT §7.2/§7.4):
 *   - filter chips: all · main events · upcoming · finished;
 *   - matches grouped by LOCAL calendar day (dayKey) under Fraunces 600
 *     headings (formatDayHeading: Today / Tomorrow / Saturday 13 June);
 *   - featured matches get the Main Event hero treatment inline in the feed;
 *   - each card carries the full prediction lifecycle (see MatchCard).
 *
 * Data freshness: 60 s (60 000 ms) refetch, cleared on unmount and paused
 * while document.hidden (CONTRACT §7.4).
 * ----------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import EmptyState, { ErrorCard, LoadingCard } from '../components/EmptyState';
import MainEventCard from '../components/MainEventCard';
import MatchCard from '../components/MatchCard';
import { dayKey, displayState, formatDayHeading } from '../lib/datetime';
import type { MatchWithMine } from '../types/models';

/** The four feed lenses. */
type FilterKey = 'all' | 'main' | 'upcoming' | 'finished';

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

  // Apply the active lens.
  const now = new Date();
  const filtered = matches.filter((m) => {
    switch (filter) {
      case 'all':
        return true;
      case 'main':
        return m.is_featured;
      case 'upcoming':
        return displayState(m, now) === 'upcoming';
      case 'finished':
        return displayState(m, now) === 'final';
    }
  });

  // Group by local day. The list arrives kickoff ASC, and Map preserves
  // insertion order, so groups iterate chronologically for free.
  const groups = new Map<string, MatchWithMine[]>();
  for (const m of filtered) {
    const key = dayKey(m.kickoff_at);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(m);
    } else {
      groups.set(key, [m]);
    }
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

      {matches.length === 0 && (
        <div className="section">
          <EmptyState message="no fixtures yet. the ingest checks in soon." />
        </div>
      )}

      {matches.length > 0 && filtered.length === 0 && (
        <div className="section">
          <EmptyState message="nothing under this lens. try another." />
        </div>
      )}

      {Array.from(groups.entries()).map(([key, list]) => (
        <section key={key}>
          <h2 className="day-heading">{formatDayHeading(list[0].kickoff_at, now)}</h2>
          <div className="stack">
            {list.map((m) =>
              m.is_featured ? (
                <MainEventCard key={m.id} match={m} onSaved={() => void load()} />
              ) : (
                <MatchCard key={m.id} match={m} onSaved={() => void load()} />
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
