/**
 * TableCalls.tsx
 * ----------------------------------------------------------------------------
 * The shared "the table's calls" expander (CONTRACT §7.4, commit-to-reveal):
 * everyone's predictions for one match, fetched lazily on first open.
 *
 * The server enforces the reveal rule (GET /api/matches/:id/predictions opens
 * once the match LOCKS, or once the caller has saved their own call for it);
 * this component mirrors it through the `revealed` prop:
 *   - revealed=false → a quiet nudge to predict first (pre-lock, no pick yet);
 *   - revealed=true  → the toggler + list. When `live` (a pre-lock peek) it
 *     refetches on every open and shows a "still moving" note, since calls
 *     stay editable until kickoff; once locked/final the set is cached (it
 *     never changes again).
 *
 * Used by MatchCard (the fixtures feed) and NextUpWidget (the Hub) so the two
 * surfaces can never drift.
 * ----------------------------------------------------------------------------
 */

import { useState } from 'react';
import { api } from '../api/client';
import type { PredictionWithUser } from '../types/models';
import PointsBadge from './PointsBadge';

interface TableCallsProps {
  matchId: string;
  /** May the caller see the calls? (match locked, or I've already predicted.) */
  revealed: boolean;
  /** Show the 5/2/0 points badges (the match is final). */
  final: boolean;
  /** Pre-lock peek — calls can still change; refetch on open + show the note. */
  live?: boolean;
}

export default function TableCalls({
  matchId,
  revealed,
  final,
  live = false,
}: TableCallsProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [calls, setCalls] = useState<PredictionWithUser[] | null>(null);
  const [err, setErr] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  async function loadCalls(): Promise<void> {
    setLoading(true);
    setErr(false);
    try {
      setCalls(await api.matchPredictions(matchId));
    } catch {
      setErr(true);
    } finally {
      setLoading(false);
    }
  }

  function toggle(): void {
    const next = !open;
    setOpen(next);
    // Fetch on open. A live (pre-lock) peek always refetches — the field is
    // still moving; a locked/final set loads once and is then cached.
    if (next && (calls === null || live) && !loading) void loadCalls();
  }

  // Not yet revealable: nudge the caller to commit their own call first.
  if (!revealed) {
    return <p className="hint calls-shut">make your call to see the table&rsquo;s.</p>;
  }

  return (
    <div>
      <button
        type="button"
        className={`chip chip--small${open ? ' on' : ''}`}
        aria-expanded={open}
        onClick={toggle}
      >
        the table&rsquo;s calls
      </button>
      {open && (
        <div className="calls-table">
          {live && !loading && !err && (
            <p className="hint calls-row">still moving — calls can change until kickoff.</p>
          )}
          {loading && <p className="hint calls-row">checking the post…</p>}
          {err && (
            <p className="hint calls-row">
              the wire is down.{' '}
              <button type="button" className="chip chip--small" onClick={() => void loadCalls()}>
                try again
              </button>
            </p>
          )}
          {calls !== null && calls.length === 0 && (
            <p className="hint calls-row">nobody called this one.</p>
          )}
          {calls?.map((c) => (
            <div key={c.id} className="calls-row">
              <span>
                {c.display_name} <span className="hint">@{c.username}</span>
              </span>
              <span className="row">
                <span className="calls-score">
                  {c.pred_home} – {c.pred_away}
                </span>
                {final && <PointsBadge points={c.points_awarded} />}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
