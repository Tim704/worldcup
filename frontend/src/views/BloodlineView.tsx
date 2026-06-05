/**
 * BloodlineView.tsx — "The Bloodline" forfeit board (CONTRACT §7)
 * ----------------------------------------------------------------------------
 * Lists every forfeit grouped by its lifecycle state, with a distinct visual
 * chip per state (pending · active · unsettled · resolved — the four members of
 * the `forfeit_state` enum, §3). A "New Challenge" button opens the
 * ForfeitModal to issue a fresh wager.
 *
 * Per-card actions reflect the state machine (§4) where the current user is a
 * party: a `pending` challenge directed at you can be Accepted / Declined.
 *
 * Data: listForfeits() + listMatches() on mount (mock fallback when offline).
 * Styling is self-contained in one injected <style> block scoped under
 * `.bloodline`. Spacing is metric (px/rem); timestamps are ISO-8601.
 * ----------------------------------------------------------------------------
 */

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  acceptForfeit,
  declineForfeit,
  listForfeits,
  listMatches,
} from '../api/client';
import ForfeitModal from '../components/ForfeitModal';
import type { Forfeit, ForfeitState, Match, User } from '../types/models';

/* ===========================================================================
 * Demo identity + roster
 * ======================================================================== */

/** The signed-in user for this demo (matches a mock user in the API client). */
const DEMO_USER_ID = '11111111-1111-1111-1111-111111111111';

/**
 * A small static roster of "friends" the demo user can challenge. In a fully
 * wired app this would come from GET /api/users (a friends list); the contract
 * exposes no such endpoint, so we keep a local roster purely for the modal's
 * opponent picker. Ids align with the API client's mock users.
 */
const DEMO_ROSTER: User[] = [
  { id: '11111111-1111-1111-1111-111111111111', username: 'raya', display_name: 'Raya', elo_rating: 1532, total_points: 184, created_at: '' },
  { id: '22222222-2222-2222-2222-222222222222', username: 'diego', display_name: 'Diego', elo_rating: 1498, total_points: 171, created_at: '' },
  { id: '33333333-3333-3333-3333-333333333333', username: 'amara', display_name: 'Amara', elo_rating: 1551, total_points: 199, created_at: '' },
  { id: '44444444-4444-4444-4444-444444444444', username: 'kenji', display_name: 'Kenji', elo_rating: 1476, total_points: 162, created_at: '' },
];

/** Human display name for a user id (falls back to a short id slice). */
function nameFor(userId: string | null): string {
  if (!userId) {
    return '—';
  }
  const match = DEMO_ROSTER.find((u) => u.id === userId);
  return match ? match.display_name : userId.slice(0, 8);
}

/* ===========================================================================
 * State presentation metadata
 * ======================================================================== */

/** The four Bloodline states in lifecycle order, with display labels. */
const STATE_ORDER: ForfeitState[] = ['pending', 'active', 'unsettled', 'resolved'];

const STATE_BLURB: Record<ForfeitState, string> = {
  pending: 'Awaiting an answer',
  active: 'Live through the match',
  unsettled: 'Loser owes proof',
  resolved: 'Archived',
};

/* ===========================================================================
 * Component
 * ======================================================================== */

export default function BloodlineView(): React.ReactElement {
  const [forfeits, setForfeits] = useState<Forfeit[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  // Tracks the id currently mid-transition so its buttons disable.
  const [busyId, setBusyId] = useState<string | null>(null);

  // Initial load: all forfeits for the demo user + the match list for the modal.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listForfeits(DEMO_USER_ID), listMatches()])
      .then(([loadedForfeits, loadedMatches]) => {
        if (!cancelled) {
          setForfeits(loadedForfeits);
          setMatches(loadedMatches);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Bucket the flat forfeit list into the four states (single pass, no N+1).
  const byState = useMemo(() => {
    const buckets: Record<ForfeitState, Forfeit[]> = {
      pending: [],
      active: [],
      unsettled: [],
      resolved: [],
    };
    for (const f of forfeits) {
      buckets[f.state].push(f);
    }
    return buckets;
  }, [forfeits]);

  /** Replace a forfeit in local state after a transition returns its new shape. */
  const applyUpdate = (updated: Forfeit): void => {
    setForfeits((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  };

  /** Accept a pending challenge directed at the demo user (→ active). */
  const handleAccept = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      applyUpdate(await acceptForfeit(id));
    } finally {
      setBusyId(null);
    }
  };

  /** Decline a pending challenge (→ resolved). */
  const handleDecline = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      applyUpdate(await declineForfeit(id));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bloodline">
      <style>{CSS}</style>

      {/* ───────── Masthead + New Challenge ───────── */}
      <header className="bl-head">
        <div className="bl-title">
          The Bloodline
          <small>FORFEIT WAGERS · FRIEND v FRIEND</small>
        </div>
        <button
          type="button"
          className="bl-new"
          onClick={() => setModalOpen(true)}
        >
          <span>+ NEW CHALLENGE</span>
        </button>
      </header>

      {loading && <div className="bl-loading">LOADING WAGERS…</div>}

      {!loading &&
        STATE_ORDER.map((state) => {
          const rows = byState[state];
          return (
            <section className="bl-section" key={state} aria-label={`${state} forfeits`}>
              <h2 className="bl-h2">
                <span className={`bl-chip chip-${state}`}>{state}</span>
                <span className="bl-blurb">{STATE_BLURB[state]}</span>
                <span className="bl-count">{rows.length}</span>
              </h2>

              {rows.length === 0 ? (
                <div className="bl-empty">Nothing here yet.</div>
              ) : (
                <div className="bl-list">
                  {rows.map((f) => {
                    // The demo user can answer a pending challenge aimed at them.
                    const canAnswer =
                      f.state === 'pending' && f.opponent_id === DEMO_USER_ID;
                    return (
                      <article className={`bl-card border-${f.state}`} key={f.id}>
                        <div className="bl-parties">
                          <span className="bl-who">{nameFor(f.challenger_id)}</span>
                          <span className="bl-vs">vs</span>
                          <span className="bl-who">{nameFor(f.opponent_id)}</span>
                        </div>
                        <p className="bl-stake">{f.stake}</p>
                        <div className="bl-foot">
                          {f.loser_id && (
                            <span className="bl-loser">
                              LOSER · {nameFor(f.loser_id)}
                            </span>
                          )}
                          {f.nudge_count > 0 && (
                            <span className="bl-nudge">{f.nudge_count} NUDGE(S)</span>
                          )}
                        </div>
                        {canAnswer && (
                          <div className="bl-actions">
                            <button
                              type="button"
                              className="bl-act bl-accept"
                              onClick={() => handleAccept(f.id)}
                              disabled={busyId === f.id}
                            >
                              ACCEPT
                            </button>
                            <button
                              type="button"
                              className="bl-act bl-decline"
                              onClick={() => handleDecline(f.id)}
                              disabled={busyId === f.id}
                            >
                              DECLINE
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

      {/* ───────── Forfeit Creation modal ───────── */}
      <ForfeitModal
        open={modalOpen}
        challengerId={DEMO_USER_ID}
        opponents={DEMO_ROSTER}
        matches={matches}
        onClose={() => setModalOpen(false)}
        onCreated={(forfeit) => setForfeits((prev) => [forfeit, ...prev])}
      />
    </div>
  );
}

/* ===========================================================================
 * Styles — injected once, scoped under .bloodline.
 * ======================================================================== */

const CSS = `
.bloodline{
  --paper:#f1ece0; --paper-2:#e6dfce; --ink:#0d0d0b; --ink-2:#17170f;
  --signal:#ff3a0e; --volt:#d6ff15; --muted:#7a7060; --line:rgba(13,13,11,.16);
  --amber:#ffb000;
  font-family:'Archivo',system-ui,-apple-system,sans-serif; color:var(--ink);
  background:var(--paper); padding:18px clamp(14px,4vw,28px) 28px; max-width:760px; margin:0 auto;
}
.bloodline *{ box-sizing:border-box; }

/* ---- masthead ---- */
.bl-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:12px;
  border-bottom:3px solid var(--ink); padding-bottom:14px; flex-wrap:wrap; }
.bl-title{ font-family:'Anton'; font-size:clamp(26px,7vw,36px); line-height:.86;
  text-transform:uppercase; letter-spacing:-.5px; }
.bl-title small{ display:block; font-family:'Space Mono'; font-weight:700; font-size:9px;
  letter-spacing:2px; color:var(--muted); margin-top:5px; }
.bl-new{ font-family:'Anton'; text-transform:uppercase; font-size:15px; letter-spacing:.4px;
  background:var(--signal); color:var(--paper); border:2px solid var(--ink); padding:11px 16px;
  cursor:pointer; transform:skewX(-7deg); box-shadow:4px 4px 0 var(--ink);
  transition:transform .12s,box-shadow .12s; }
.bl-new span{ display:inline-block; transform:skewX(7deg); }
.bl-new:hover{ transform:skewX(-7deg) translate(-2px,-2px); box-shadow:6px 6px 0 var(--ink); }
.bl-new:active{ transform:skewX(-7deg) translate(2px,2px); box-shadow:1px 1px 0 var(--ink); }

.bl-loading{ font-family:'Space Mono'; font-weight:700; font-size:12px; letter-spacing:2px;
  color:var(--muted); padding:30px 0; text-align:center; }

/* ---- state sections ---- */
.bl-section{ margin-top:22px; }
.bl-h2{ display:flex; align-items:center; gap:10px; margin-bottom:12px; }
.bl-chip{ font-family:'Space Mono'; font-weight:700; font-size:11px; letter-spacing:1.5px;
  text-transform:uppercase; padding:4px 10px; border:2px solid currentColor; }
.bl-blurb{ font-family:'Space Mono'; font-size:10px; letter-spacing:1px; text-transform:uppercase;
  color:var(--muted); }
.bl-count{ margin-left:auto; font-family:'Anton'; font-size:18px; background:var(--ink);
  color:var(--volt); padding:1px 9px; }

/* Distinct state colours (4 Bloodline states). */
.chip-pending{ color:#9a7b00; background:var(--volt); border-color:#9a7b00; }
.chip-active{ color:var(--paper); background:var(--signal); border-color:var(--signal); }
.chip-unsettled{ color:var(--ink); background:var(--amber); border-color:var(--ink); }
.chip-resolved{ color:var(--paper); background:var(--muted); border-color:var(--muted); }

/* ---- forfeit cards ---- */
.bl-empty{ font-family:'Space Mono'; font-size:11px; letter-spacing:.5px; color:var(--muted);
  text-transform:uppercase; padding:6px 0 4px; }
.bl-list{ display:flex; flex-direction:column; gap:11px; }
.bl-card{ border:2px solid var(--ink); background:var(--paper); padding:13px 15px;
  box-shadow:5px 5px 0 var(--ink); display:flex; flex-direction:column; gap:9px;
  border-left-width:7px; }
/* Left accent rail tinted by state. */
.border-pending{ border-left-color:#9a7b00; }
.border-active{ border-left-color:var(--signal); }
.border-unsettled{ border-left-color:var(--amber); }
.border-resolved{ border-left-color:var(--muted); }

.bl-parties{ display:flex; align-items:baseline; gap:8px; font-family:'Anton'; font-size:20px;
  text-transform:uppercase; letter-spacing:-.3px; }
.bl-vs{ color:var(--signal); font-size:13px; }
.bl-stake{ font-family:'Archivo'; font-weight:600; font-size:15px; line-height:1.35; margin:0; }
.bl-foot{ display:flex; gap:8px; flex-wrap:wrap; }
.bl-loser, .bl-nudge{ font-family:'Space Mono'; font-weight:700; font-size:9px; letter-spacing:1px;
  text-transform:uppercase; padding:3px 7px; }
.bl-loser{ background:var(--ink); color:var(--volt); }
.bl-nudge{ background:var(--amber); color:var(--ink); }

/* ---- accept / decline actions ---- */
.bl-actions{ display:flex; gap:9px; margin-top:2px; }
.bl-act{ font-family:'Anton'; text-transform:uppercase; font-size:14px; letter-spacing:.4px;
  border:2px solid var(--ink); padding:9px 14px; cursor:pointer; flex:1;
  transition:background .12s,color .12s; }
.bl-act:disabled{ opacity:.5; cursor:not-allowed; }
.bl-accept{ background:var(--volt); color:var(--ink); }
.bl-accept:hover:not(:disabled){ background:var(--ink); color:var(--volt); }
.bl-decline{ background:var(--paper); color:var(--ink); }
.bl-decline:hover:not(:disabled){ background:var(--signal); color:var(--paper); border-color:var(--signal); }

@media (prefers-reduced-motion: reduce){
  .bloodline *, .bloodline *::before, .bloodline *::after{
    animation:none !important; transition:none !important;
  }
}
`;
