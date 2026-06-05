/**
 * Dashboard.tsx — "The Hub" (CONTRACT §7)
 * ----------------------------------------------------------------------------
 * The real-time dashboard, powered by a single GET /api/hub round trip (§6).
 * Three stacked, mobile-first sections in the shared "Broadcast Editorial"
 * language:
 *
 *   1. Upcoming matches  — a vertical list of fixtures with kickoff countdowns.
 *   2. Group standings   — a compact, scannable table grouped by group_label.
 *   3. Active forfeits    — a horizontally scrollable strip of live Bloodline
 *                           wagers (pending + active).
 *
 * Self-contained styling: one injected <style> block scoped under `.hub`.
 * All durations are metric SI seconds; spacing is in px/rem.
 * ----------------------------------------------------------------------------
 */

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { getHub } from '../api/client';
import type { Forfeit, GroupStanding, HubPayload, Match } from '../types/models';

/**
 * Demo user id used for the dashboard fetch. In a fully wired app this would
 * come from an auth/session context; here it pins the hub query to a known
 * mock user so the offline fallback renders deterministically.
 */
const DEMO_USER_ID = '11111111-1111-1111-1111-111111111111';

/* ===========================================================================
 * Time helpers (metric SI — durations expressed in seconds, then formatted)
 * ======================================================================== */

/**
 * Human countdown from now until an ISO-8601 kickoff timestamp.
 * Returns "KICKOFF" once the instant has passed. Format: `Hh Mm` or `Mm`.
 */
function countdownTo(iso: string, nowMs: number): string {
  const deltaSecs = Math.floor((new Date(iso).getTime() - nowMs) / 1000);
  if (deltaSecs <= 0) {
    return 'KICKOFF';
  }
  const hours = Math.floor(deltaSecs / 3600);
  const minutes = Math.floor((deltaSecs % 3600) / 60);
  return hours > 0 ? `${hours}H ${minutes}M` : `${minutes}M`;
}

/* ===========================================================================
 * Standings grouping (no N+1: a single pass groups the flat rows by group)
 * ======================================================================== */

/** Group flat standings rows by `group_label`, preserving incoming order. */
function groupStandings(
  rows: GroupStanding[],
): Array<{ label: string; rows: GroupStanding[] }> {
  const buckets = new Map<string, GroupStanding[]>();
  for (const row of rows) {
    const list = buckets.get(row.group_label);
    if (list) {
      list.push(row);
    } else {
      buckets.set(row.group_label, [row]);
    }
  }
  return Array.from(buckets, ([label, groupRows]) => ({ label, rows: groupRows }));
}

/* ===========================================================================
 * Component
 * ======================================================================== */

export default function Dashboard(): React.ReactElement {
  const [hub, setHub] = useState<HubPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  // 1 Hz tick so kickoff countdowns stay live without re-fetching.
  const [now, setNow] = useState<number>(() => Date.now());

  // Fetch the aggregated hub payload once on mount (mock fallback if offline).
  useEffect(() => {
    let cancelled = false;
    getHub(DEMO_USER_ID)
      .then((payload) => {
        if (!cancelled) {
          setHub(payload);
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

  // Drive the countdown labels with a per-second clock.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const grouped = useMemo(
    () => (hub ? groupStandings(hub.standings) : []),
    [hub],
  );

  return (
    <div className="hub">
      <style>{CSS}</style>

      {/* ───────── Masthead ───────── */}
      <header className="hub-head">
        <div className="hub-mark" aria-hidden>
          26
        </div>
        <div className="hub-title">
          The Hub
          <small>WORLD CUP ’26 · LIVE DASHBOARD</small>
        </div>
      </header>

      {loading && <div className="hub-loading">LOADING FEED…</div>}

      {hub && (
        <>
          {/* ───────── Section 1 · Upcoming matches ───────── */}
          <section className="hub-section" aria-label="Upcoming matches">
            <h2 className="hub-h2">
              Upcoming <span className="hub-count">{hub.upcoming_matches.length}</span>
            </h2>
            <div className="match-list">
              {hub.upcoming_matches.length === 0 && (
                <div className="hub-empty">No upcoming fixtures on the feed.</div>
              )}
              {hub.upcoming_matches.map((m: Match) => (
                <article className="match-row" key={m.id}>
                  <div className="match-meta">
                    <span className="match-group">{m.group_label ?? '—'}</span>
                    <span className="match-venue">{m.venue ?? 'Venue TBD'}</span>
                  </div>
                  <div className="match-teams">
                    <span className="mt-home">{m.home_team}</span>
                    <span className="mt-v">v</span>
                    <span className="mt-away">{m.away_team}</span>
                  </div>
                  <div className="match-clock">
                    <span className="mc-label">KICKOFF</span>
                    <span className="mc-value">{countdownTo(m.kickoff_at, now)}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* ───────── Section 2 · Group standings ───────── */}
          <section className="hub-section" aria-label="Group standings">
            <h2 className="hub-h2">Standings</h2>
            {grouped.map((group) => (
              <div className="standings-block" key={group.label}>
                <h3 className="standings-group">{group.label}</h3>
                <table className="standings-table">
                  <thead>
                    <tr>
                      <th className="col-team">Team</th>
                      <th>P</th>
                      <th>W</th>
                      <th>D</th>
                      <th>L</th>
                      <th>GD</th>
                      <th className="col-pts">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row, index) => (
                      <tr key={row.team}>
                        <td className="col-team">
                          <span className="rank">{index + 1}</span>
                          {row.team}
                        </td>
                        <td>{row.played}</td>
                        <td>{row.won}</td>
                        <td>{row.drawn}</td>
                        <td>{row.lost}</td>
                        <td>
                          {row.goal_difference > 0 ? `+${row.goal_difference}` : row.goal_difference}
                        </td>
                        <td className="col-pts">{row.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>

          {/* ───────── Section 3 · Active forfeits strip ───────── */}
          <section className="hub-section" aria-label="Active forfeits">
            <h2 className="hub-h2">
              The Bloodline{' '}
              <span className="hub-count">{hub.active_forfeits.length}</span>
            </h2>
            <div className="forfeit-strip">
              {hub.active_forfeits.length === 0 && (
                <div className="hub-empty">No live wagers right now.</div>
              )}
              {hub.active_forfeits.map((f: Forfeit) => (
                <article className={`forfeit-card state-${f.state}`} key={f.id}>
                  <span className={`forfeit-chip chip-${f.state}`}>{f.state}</span>
                  <p className="forfeit-stake">{f.stake}</p>
                  <span className="forfeit-foot">
                    {f.nudge_count > 0 ? `${f.nudge_count} NUDGE(S)` : 'ON THE LINE'}
                  </span>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ===========================================================================
 * Styles — injected once, scoped under .hub.
 * ======================================================================== */

const CSS = `
.hub{
  --paper:#f1ece0; --paper-2:#e6dfce; --ink:#0d0d0b; --ink-2:#17170f;
  --signal:#ff3a0e; --volt:#d6ff15; --muted:#7a7060; --line:rgba(13,13,11,.16);
  font-family:'Archivo',system-ui,-apple-system,sans-serif; color:var(--ink);
  background:var(--paper); padding:18px clamp(14px,4vw,28px) 28px; max-width:760px; margin:0 auto;
}
.hub *{ box-sizing:border-box; }

/* ---- masthead ---- */
.hub-head{ display:flex; align-items:center; gap:12px; border-bottom:3px solid var(--ink);
  padding-bottom:14px; }
.hub-mark{ width:42px; height:42px; flex:none; background:var(--signal); color:var(--paper);
  display:grid; place-items:center; font-family:'Anton'; font-size:22px;
  transform:skewX(-7deg); box-shadow:4px 4px 0 var(--ink); }
.hub-title{ font-family:'Anton'; font-size:clamp(26px,7vw,36px); line-height:.86;
  text-transform:uppercase; letter-spacing:-.5px; }
.hub-title small{ display:block; font-family:'Space Mono'; font-weight:700; font-size:9px;
  letter-spacing:2px; color:var(--muted); margin-top:5px; }

.hub-loading{ font-family:'Space Mono'; font-weight:700; font-size:12px; letter-spacing:2px;
  color:var(--muted); padding:30px 0; text-align:center; }
.hub-empty{ font-family:'Space Mono'; font-size:12px; letter-spacing:.5px; color:var(--muted);
  text-transform:uppercase; padding:14px 0; }

/* ---- section headers ---- */
.hub-section{ margin-top:24px; }
.hub-h2{ font-family:'Anton'; font-size:clamp(20px,5.5vw,26px); text-transform:uppercase;
  letter-spacing:-.3px; margin-bottom:12px; display:flex; align-items:center; gap:9px; }
.hub-count{ font-family:'Space Mono'; font-weight:700; font-size:12px; background:var(--ink);
  color:var(--volt); padding:3px 8px; letter-spacing:1px; }

/* ---- upcoming matches ---- */
.match-list{ display:flex; flex-direction:column; gap:10px; }
.match-row{ display:grid; grid-template-columns:1fr auto; gap:6px 12px; align-items:center;
  border:2px solid var(--ink); background:var(--paper); padding:13px 15px;
  box-shadow:5px 5px 0 var(--ink); }
.match-meta{ grid-column:1 / -1; display:flex; justify-content:space-between; gap:8px;
  font-family:'Space Mono'; font-weight:700; font-size:9px; letter-spacing:1.2px;
  text-transform:uppercase; color:var(--muted); }
.match-group{ color:var(--signal); }
.match-venue{ text-align:right; }
.match-teams{ font-family:'Anton'; font-size:clamp(17px,4.6vw,21px); text-transform:uppercase;
  letter-spacing:-.3px; display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.mt-v{ color:var(--signal); font-size:14px; }
.match-clock{ display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
.mc-label{ font-family:'Space Mono'; font-weight:700; font-size:8px; letter-spacing:1.5px;
  color:var(--muted); }
.mc-value{ font-family:'Anton'; font-size:18px; color:var(--ink); background:var(--volt);
  padding:2px 8px; transform:skewX(-7deg); }

/* ---- standings table ---- */
.standings-block{ margin-bottom:18px; border:2px solid var(--ink); background:var(--paper);
  box-shadow:5px 5px 0 var(--ink); }
.standings-group{ font-family:'Space Mono'; font-weight:700; font-size:11px; letter-spacing:2px;
  text-transform:uppercase; background:var(--ink); color:var(--volt); padding:8px 12px; margin:0; }
.standings-table{ width:100%; border-collapse:collapse; font-family:'Space Mono'; font-size:12px; }
.standings-table th{ font-weight:700; font-size:9px; letter-spacing:1px; text-transform:uppercase;
  color:var(--muted); padding:7px 4px; text-align:center; border-bottom:1px solid var(--line);
  background:var(--paper-2); }
.standings-table td{ padding:8px 4px; text-align:center; border-bottom:1px solid var(--line);
  font-weight:700; }
.standings-table tr:last-child td{ border-bottom:none; }
.col-team{ text-align:left !important; padding-left:12px !important; font-family:'Archivo';
  font-weight:700; }
.standings-table .rank{ display:inline-grid; place-items:center; width:18px; height:18px;
  background:var(--ink); color:var(--paper); font-family:'Anton'; font-size:11px;
  margin-right:8px; vertical-align:middle; }
.col-pts{ color:var(--signal); font-family:'Anton'; font-size:14px; }

/* ---- active forfeits strip (horizontal scroll on phones) ---- */
.forfeit-strip{ display:flex; gap:12px; overflow-x:auto; padding-bottom:8px;
  scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; }
.forfeit-card{ flex:0 0 min(78vw,260px); scroll-snap-align:start; border:2px solid var(--ink);
  background:var(--ink-2); color:var(--paper); padding:14px; box-shadow:6px 6px 0 var(--signal);
  display:flex; flex-direction:column; gap:9px; }
.forfeit-chip{ align-self:flex-start; font-family:'Space Mono'; font-weight:700; font-size:9px;
  letter-spacing:1.5px; text-transform:uppercase; padding:3px 8px; border:1.5px solid currentColor; }
/* State-coloured chips (4 Bloodline states). */
.chip-pending{ color:var(--volt); }
.chip-active{ color:var(--signal); }
.chip-unsettled{ color:#ffb000; }
.chip-resolved{ color:rgba(241,236,224,.55); }
.forfeit-stake{ font-family:'Anton'; font-size:18px; line-height:1.05; text-transform:uppercase;
  letter-spacing:-.2px; margin:0; }
.forfeit-foot{ font-family:'Space Mono'; font-weight:700; font-size:9px; letter-spacing:1.5px;
  color:rgba(241,236,224,.6); text-transform:uppercase; margin-top:auto; }

/* ---- scrollbars ---- */
.forfeit-strip::-webkit-scrollbar{ height:6px; }
.forfeit-strip::-webkit-scrollbar-track{ background:var(--paper-2); }
.forfeit-strip::-webkit-scrollbar-thumb{ background:var(--ink); }
`;
