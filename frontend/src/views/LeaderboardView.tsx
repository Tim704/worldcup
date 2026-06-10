/**
 * LeaderboardView.tsx
 * ----------------------------------------------------------------------------
 * The full season rankings (CONTRACT §7.4 "Leaderboard"):
 *   - rank numerals in Fraunces 900;
 *   - the top three wear jewel-tone badges (gold / teal / coral);
 *   - mini-chips count exact (+5) and outcome (+2) hits;
 *   - the signed-in user's row is ink-filled ("pressed on").
 * One GET /api/leaderboard; loading / error-with-retry states per §7.4.
 * ----------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import EmptyState, { ErrorCard, LoadingCard } from '../components/EmptyState';
import { useAuth } from '../state/AuthContext';
import type { LeaderboardRow } from '../types/models';

export default function LeaderboardView(): JSX.Element {
  const { user } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [failed, setFailed] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRows(await api.leaderboard());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <span className="kicker">the season ledger</span>
      <h1 className="view-title">the table</h1>

      {failed && rows === null && <ErrorCard onRetry={() => void load()} />}
      {!failed && rows === null && <LoadingCard />}

      {rows !== null && rows.length === 0 && (
        <EmptyState message="no points yet. the theory is untested." />
      )}

      {rows !== null && rows.length > 0 && (
        <div className="card">
          {rows.map((r) => (
            <div key={r.user_id} className={`lb-row${user && r.user_id === user.id ? ' me' : ''}`}>
              <div className="lb-rank-cell">
                {r.rank <= 3 ? (
                  <span className={`lb-badge lb-badge--${r.rank}`}>{r.rank}</span>
                ) : (
                  <span className="lb-rank">{r.rank}</span>
                )}
              </div>
              <div>
                <div className="lb-name">{r.display_name}</div>
                <div className="hint">
                  @{r.username} · {r.predictions_settled} settled
                </div>
                <div className="lb-chips">
                  <span className="mini-chip">{r.exact_hits}× exact</span>
                  <span className="mini-chip">{r.outcome_hits}× outcome</span>
                </div>
              </div>
              <div className="lb-points">{r.total_points}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
