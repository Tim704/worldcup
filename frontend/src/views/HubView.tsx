/**
 * HubView.tsx
 * ----------------------------------------------------------------------------
 * The front page (CONTRACT §7.2/§7.4):
 *   1. NextUpWidget — the actionable prompt for the next unlocked match;
 *   2. the Main Events rail — featured matches as hero cards, side by side;
 *   3. a top-3 leaderboard snippet linking to the full table;
 *   4. my open wagers (PENDING / ACCEPTED where I'm a party).
 *
 * Data freshness: one parallel fetch on mount, then a 60 s (60 000 ms)
 * refetch — cleared on unmount and PAUSED while document.hidden; a
 * visibilitychange listener refreshes immediately when the tab returns.
 * Background refetch failures keep the last good paper on screen.
 * ----------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { ErrorCard, LoadingCard } from '../components/EmptyState';
import MainEventCard from '../components/MainEventCard';
import MatchCard from '../components/MatchCard';
import NextUpWidget from '../components/NextUpWidget';
import WagerCard from '../components/WagerCard';
import { displayState } from '../lib/datetime';
import { useAuth } from '../state/AuthContext';
import type { LeaderboardRow, MatchWithMine, WagerView } from '../types/models';

/** Everything the Hub needs, gathered in one parallel round of fetches. */
interface HubData {
  next: MatchWithMine | null;
  live: MatchWithMine[];
  featured: MatchWithMine[];
  top3: LeaderboardRow[];
  openWagers: WagerView[];
}

/** Refetch cadence: 60 s, in metric SI seconds (CONTRACT §7.4). */
const REFETCH_MS = 60_000;

export default function HubView(): JSX.Element {
  const { user } = useAuth();
  const meId = user?.id ?? '';

  const [data, setData] = useState<HubData | null>(null);
  const [failed, setFailed] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [nextRes, matches, board, myWagers] = await Promise.all([
        api.nextMatch(),
        api.listMatches(),
        api.leaderboard(),
        api.listWagers({ user_id: meId }),
      ]);
      // Live matches drop off "next up" (they're locked) — surface them in
      // their own section instead of vanishing. Keep them out of the featured
      // rail so a live Main Event shows once, under "live now".
      const hubNow = new Date();
      setData({
        next: nextRes.match,
        live: matches.filter((m) => displayState(m, hubNow) === 'live'),
        featured: matches.filter((m) => m.is_featured && displayState(m, hubNow) !== 'live'),
        top3: board.slice(0, 3),
        openWagers: myWagers.filter((w) => w.state === 'PENDING' || w.state === 'ACCEPTED'),
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [meId]);

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

  async function withdraw(w: WagerView): Promise<void> {
    try {
      await api.deleteWager(w.id);
    } catch {
      // Guarded server-side (state may have flipped) — the reload tells truth.
    }
    void load();
  }

  if (failed && data === null) return <ErrorCard onRetry={() => void load()} />;
  if (data === null) return <LoadingCard />;

  return (
    <div>
      <span className="kicker">today&rsquo;s edition</span>
      <h1 className="view-title">the front page</h1>

      {/* 0 — live right now: matches that have kicked off but aren't final.
            (They drop off "next up" the moment they lock.) */}
      {data.live.length > 0 && (
        <section className="section">
          <span className="kicker">live now</span>
          <div className="stack">
            {data.live.map((m) => (
              <MatchCard key={m.id} match={m} onSaved={() => void load()} />
            ))}
          </div>
        </section>
      )}

      {/* 1 — the actionable prompt. Keyed by match id so a new "next" match
            remounts the widget with fresh stepper state. */}
      <NextUpWidget
        key={data.next?.id ?? 'none'}
        match={data.next}
        onSaved={() => void load()}
      />

      {/* 2 — the Main Events rail. */}
      {data.featured.length > 0 && (
        <section className="section">
          <span className="kicker">main events</span>
          <div className="rail">
            {data.featured.map((m) => (
              <MainEventCard key={m.id} match={m} onSaved={() => void load()} />
            ))}
          </div>
        </section>
      )}

      {/* 3 — the top of the table. */}
      <section className="section">
        <span className="kicker">the table</span>
        <div className="card">
          {data.top3.length === 0 && <p className="hint">no points yet. the theory is untested.</p>}
          {data.top3.map((r) => (
            <div key={r.user_id} className={`lb-row${r.user_id === meId ? ' me' : ''}`}>
              <div className="lb-rank-cell">
                <span className={`lb-badge lb-badge--${r.rank <= 3 ? r.rank : 3}`}>{r.rank}</span>
              </div>
              <div>
                <div className="lb-name">{r.display_name}</div>
                <div className="hint">@{r.username}</div>
              </div>
              <div className="lb-points">{r.total_points}</div>
            </div>
          ))}
          <Link className="table-link" to="/table">
            see the full table →
          </Link>
        </div>
      </section>

      {/* 4 — my open wagers. */}
      <section className="section">
        <span className="kicker">my open wagers</span>
        {data.openWagers.length === 0 ? (
          <div className="card empty-card">
            <p className="hint">
              nothing on the line. quiet, for now.{' '}
              <Link className="table-link" to="/wagers">
                visit the market →
              </Link>
            </p>
          </div>
        ) : (
          <div className="stack">
            {data.openWagers.map((w) => (
              <WagerCard key={w.id} wager={w} meId={meId} onWithdraw={(x) => void withdraw(x)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
