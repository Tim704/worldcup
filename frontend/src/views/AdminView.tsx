/**
 * AdminView.tsx
 * ----------------------------------------------------------------------------
 * The back office (CONTRACT §7.2/§7.4 "Admin") — admin-only (route-guarded in
 * App.tsx AND re-checked here):
 *   - score entry per match: two goal inputs + the "make it official" button →
 *     POST /api/admin/matches/:id/score, which runs the whole settlement
 *     pipeline (5/2/0 points, totals, wager resolution) in one transaction.
 *     Re-submitting a corrected score is idempotent server-side, so finals
 *     stay editable here;
 *   - "main event" feature toggle → POST .../feature {is_featured};
 *   - live toggle → POST .../status {'live'|'scheduled'} ('final' is only
 *     reachable via /score, so the toggle disappears on settled matches).
 * ----------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import EmptyState, { ErrorCard, LoadingCard } from '../components/EmptyState';
import StateChip from '../components/StateChip';
import { displayState, formatKickoff } from '../lib/datetime';
import { useAuth } from '../state/AuthContext';
import type { MatchWithMine } from '../types/models';

/** Draft score inputs per match id (kept as strings — they are form fields). */
type ScoreDrafts = Record<string, { home: string; away: string }>;

export default function AdminView(): JSX.Element | null {
  const { user } = useAuth();

  const [matches, setMatches] = useState<MatchWithMine[] | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [drafts, setDrafts] = useState<ScoreDrafts>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  const load = useCallback(async (): Promise<void> => {
    try {
      const fetched = await api.listMatches();
      setMatches(fetched);
      // Seed drafts from the server WITHOUT clobbering in-progress typing.
      setDrafts((prev) => {
        const next: ScoreDrafts = { ...prev };
        for (const m of fetched) {
          if (!next[m.id]) {
            next[m.id] = {
              home: m.home_score !== null ? String(m.home_score) : '',
              away: m.away_score !== null ? String(m.away_score) : '',
            };
          }
        }
        return next;
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Defence in depth: the /admin route is already guarded in App.tsx.
  if (!user?.is_admin) return null;

  if (failed && matches === null) return <ErrorCard onRetry={() => void load()} />;
  if (matches === null) return <LoadingCard />;

  function setDraft(id: string, side: 'home' | 'away', value: string): void {
    setDrafts((prev) => {
      const current = prev[id] ?? { home: '', away: '' };
      return { ...prev, [id]: { ...current, [side]: value } };
    });
  }

  /** Run an admin mutation with per-row busy/message/error bookkeeping. */
  async function runRow(id: string, action: () => Promise<string | null>): Promise<void> {
    setBusyId(id);
    setRowErr((prev) => ({ ...prev, [id]: '' }));
    setRowMsg((prev) => ({ ...prev, [id]: '' }));
    try {
      const msg = await action();
      if (msg) setRowMsg((prev) => ({ ...prev, [id]: msg }));
    } catch (err) {
      setRowErr((prev) => ({
        ...prev,
        [id]: err instanceof ApiError ? err.message : 'the wire is down. try again.',
      }));
    } finally {
      setBusyId(null);
      void load();
    }
  }

  function submitScore(m: MatchWithMine): void {
    const draft = drafts[m.id] ?? { home: '', away: '' };
    const home = Number(draft.home);
    const away = Number(draft.away);
    const wholeGoals =
      draft.home.trim() !== '' &&
      draft.away.trim() !== '' &&
      Number.isInteger(home) &&
      Number.isInteger(away) &&
      home >= 0 &&
      away >= 0;
    if (!wholeGoals) {
      setRowErr((prev) => ({ ...prev, [m.id]: 'scores must be whole, non-negative goals.' }));
      return;
    }
    void runRow(m.id, async () => {
      const result = await api.adminScore(m.id, home, away);
      return `official. ${result.predictions_scored} calls scored, ${result.wagers_resolved} wagers resolved.`;
    });
  }

  function toggleFeature(m: MatchWithMine): void {
    void runRow(m.id, async () => {
      await api.adminFeature(m.id, !m.is_featured);
      return null;
    });
  }

  function toggleLive(m: MatchWithMine): void {
    void runRow(m.id, async () => {
      await api.adminStatus(m.id, m.status === 'live' ? 'scheduled' : 'live');
      return null;
    });
  }

  const now = new Date();

  return (
    <div>
      <span className="kicker">officials only</span>
      <h1 className="view-title">the back office</h1>

      {matches.length === 0 && <EmptyState message="no fixtures yet. the ingest checks in soon." />}

      <div className="stack">
        {matches.map((m) => {
          const draft = drafts[m.id] ?? { home: '', away: '' };
          const busy = busyId === m.id;
          return (
            <div key={m.id} className="card admin-row">
              <div className="match-meta">
                <StateChip kind={displayState(m, now)} />
                <span className="hint">{formatKickoff(m.kickoff_at, now)}</span>
                {m.group_label && <span className="hint match-venue">{m.group_label}</span>}
              </div>

              <div className="admin-teams">
                <span className="team-name">{m.home_team}</span>
                <span className="match-vs">vs</span>
                <span className="team-name">{m.away_team}</span>
              </div>

              {/* Score entry — idempotent server pipeline, finals re-editable. */}
              <div className="admin-controls">
                <input
                  className="input input--score"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={`${m.home_team} goals`}
                  value={draft.home}
                  onChange={(e) => setDraft(m.id, 'home', e.target.value)}
                />
                <span className="match-vs">–</span>
                <input
                  className="input input--score"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={`${m.away_team} goals`}
                  value={draft.away}
                  onChange={(e) => setDraft(m.id, 'away', e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => submitScore(m)}
                >
                  {busy ? 'filing…' : 'make it official'}
                </button>
              </div>

              {/* Feature & live toggles. */}
              <div className="admin-controls">
                <button
                  type="button"
                  className={`chip chip--small${m.is_featured ? ' on' : ''}`}
                  aria-pressed={m.is_featured}
                  disabled={busy}
                  onClick={() => toggleFeature(m)}
                >
                  main event
                </button>
                {m.status !== 'final' && (
                  <button
                    type="button"
                    className={`chip chip--small${m.status === 'live' ? ' on' : ''}`}
                    aria-pressed={m.status === 'live'}
                    disabled={busy}
                    onClick={() => toggleLive(m)}
                  >
                    live
                  </button>
                )}
              </div>

              {rowMsg[m.id] && <p className="hint">{rowMsg[m.id]}</p>}
              {rowErr[m.id] && <p className="form-error">{rowErr[m.id]}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
