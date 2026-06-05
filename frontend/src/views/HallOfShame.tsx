/**
 * HallOfShame.tsx — "Shame" proof ledger + tribunal (CONTRACT §7)
 * ----------------------------------------------------------------------------
 * A scrollable ledger of proof cards for executed punishments. Each card adapts
 * to its proof_kind:
 *   - image → an inline thumbnail of the evidence,
 *   - video → a "watch" link preview block,
 *   - link  → an external link preview block.
 *
 * Every card shows the caption, a net vote tally (up − down), a VERIFIED badge
 * once the tribunal has passed, and thumbs up/down buttons that call
 * voteShame() (POST /api/hall/:entryId/vote, §6). Casting a vote may flip
 * `verified` once the net threshold (TRIBUNAL_NET_VOTES = 3, §4) is reached.
 *
 * Data: listHall() on mount (mock fallback when offline). Styling is
 * self-contained in one injected <style> block scoped under `.shame`.
 * Spacing is metric (px/rem).
 * ----------------------------------------------------------------------------
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { listHall, voteShame } from '../api/client';
import type { HallEntry } from '../types/models';

/** The voting identity for this demo (a mock user known to the API client). */
const DEMO_VOTER_ID = '11111111-1111-1111-1111-111111111111';

/* ===========================================================================
 * Component
 * ======================================================================== */

export default function HallOfShame(): React.ReactElement {
  const [entries, setEntries] = useState<HallEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  // Track the entry currently mid-vote so its buttons disable.
  const [votingId, setVotingId] = useState<string | null>(null);

  // Load the ledger on mount (mock fallback when no backend is reachable).
  useEffect(() => {
    let cancelled = false;
    listHall()
      .then((loaded) => {
        if (!cancelled) {
          setEntries(loaded);
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

  /** Cast a tribunal vote and swap in the server's updated tally for the entry. */
  const handleVote = async (entryId: string, vote: 1 | -1): Promise<void> => {
    setVotingId(entryId);
    try {
      const updated = await voteShame(entryId, DEMO_VOTER_ID, vote);
      setEntries((prev) => prev.map((e) => (e.id === entryId ? updated : e)));
    } finally {
      setVotingId(null);
    }
  };

  return (
    <div className="shame">
      <style>{CSS}</style>

      {/* ───────── Masthead ───────── */}
      <header className="sh-head">
        <div className="sh-mark" aria-hidden>
          ☠
        </div>
        <div className="sh-title">
          Hall of Shame
          <small>PROOF LEDGER · THE TRIBUNAL VOTES</small>
        </div>
      </header>

      {loading && <div className="sh-loading">LOADING LEDGER…</div>}

      {!loading && entries.length === 0 && (
        <div className="sh-empty">No punishments on record. For now.</div>
      )}

      <div className="sh-grid">
        {entries.map((entry) => (
          <article className="sh-card" key={entry.id}>
            {/* ---- proof preview (adapts to proof_kind) ---- */}
            <div className={`sh-proof kind-${entry.proof_kind}`}>
              {entry.proof_kind === 'image' ? (
                <img
                  className="sh-thumb"
                  src={entry.proof_url}
                  alt={entry.caption ?? 'Proof of punishment'}
                  loading="lazy"
                />
              ) : (
                <a
                  className="sh-link"
                  href={entry.proof_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="sh-link-glyph" aria-hidden>
                    {entry.proof_kind === 'video' ? '▶' : '↗'}
                  </span>
                  <span className="sh-link-label">
                    {entry.proof_kind === 'video' ? 'WATCH THE EVIDENCE' : 'OPEN THE LINK'}
                  </span>
                </a>
              )}
              {entry.verified && (
                <span className="sh-verified" aria-label="Verified by the tribunal">
                  ✓ VERIFIED
                </span>
              )}
            </div>

            {/* ---- caption ---- */}
            <p className="sh-caption">{entry.caption ?? 'No caption provided.'}</p>

            {/* ---- tally + tribunal buttons ---- */}
            <div className="sh-foot">
              <div className="sh-tally" aria-label={`Net tally ${entry.net}`}>
                <span className="sh-net">{entry.net > 0 ? `+${entry.net}` : entry.net}</span>
                <span className="sh-net-label">NET</span>
              </div>
              <div className="sh-votes">
                <button
                  type="button"
                  className="sh-vote sh-up"
                  onClick={() => handleVote(entry.id, 1)}
                  disabled={votingId === entry.id}
                  aria-label="Thumbs up"
                >
                  ▲ <b>{entry.up}</b>
                </button>
                <button
                  type="button"
                  className="sh-vote sh-down"
                  onClick={() => handleVote(entry.id, -1)}
                  disabled={votingId === entry.id}
                  aria-label="Thumbs down"
                >
                  ▼ <b>{entry.down}</b>
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ===========================================================================
 * Styles — injected once, scoped under .shame.
 * ======================================================================== */

const CSS = `
.shame{
  --paper:#f1ece0; --paper-2:#e6dfce; --ink:#0d0d0b; --ink-2:#17170f;
  --signal:#ff3a0e; --volt:#d6ff15; --muted:#7a7060; --line:rgba(13,13,11,.16);
  font-family:'Archivo',system-ui,-apple-system,sans-serif; color:var(--ink);
  background:var(--paper); padding:18px clamp(14px,4vw,28px) 28px; max-width:880px; margin:0 auto;
}
.shame *{ box-sizing:border-box; }

/* ---- masthead ---- */
.sh-head{ display:flex; align-items:center; gap:12px; border-bottom:3px solid var(--ink);
  padding-bottom:14px; }
.sh-mark{ width:42px; height:42px; flex:none; background:var(--ink); color:var(--volt);
  display:grid; place-items:center; font-size:22px; transform:skewX(-7deg);
  box-shadow:4px 4px 0 var(--signal); }
.sh-title{ font-family:'Anton'; font-size:clamp(26px,7vw,36px); line-height:.86;
  text-transform:uppercase; letter-spacing:-.5px; }
.sh-title small{ display:block; font-family:'Space Mono'; font-weight:700; font-size:9px;
  letter-spacing:2px; color:var(--muted); margin-top:5px; }

.sh-loading, .sh-empty{ font-family:'Space Mono'; font-weight:700; font-size:12px; letter-spacing:2px;
  color:var(--muted); padding:30px 0; text-align:center; }

/* ---- ledger grid (single column on phones, two on wider screens) ---- */
.sh-grid{ display:grid; grid-template-columns:1fr; gap:16px; margin-top:18px; }
@media(min-width:620px){ .sh-grid{ grid-template-columns:1fr 1fr; } }

/* ---- card ---- */
.sh-card{ border:3px solid var(--ink); background:var(--paper); box-shadow:7px 7px 0 var(--ink);
  display:flex; flex-direction:column; overflow:hidden; }

/* ---- proof preview ---- */
.sh-proof{ position:relative; border-bottom:2px solid var(--ink); }
.sh-thumb{ display:block; width:100%; height:200px; object-fit:cover; background:var(--paper-2); }
.sh-link{ display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;
  height:200px; text-decoration:none; color:var(--paper); background:var(--ink-2); }
.kind-video .sh-link{ background:var(--ink-2); }
.kind-link .sh-link{ background:#1f1f17; }
.sh-link:hover{ background:var(--ink); }
.sh-link-glyph{ width:54px; height:54px; display:grid; place-items:center; font-size:22px;
  background:var(--signal); color:var(--paper); border-radius:50%; }
.sh-link-label{ font-family:'Space Mono'; font-weight:700; font-size:11px; letter-spacing:1.5px; }

/* verified badge stamped over the proof */
.sh-verified{ position:absolute; top:10px; right:10px; font-family:'Anton'; font-size:13px;
  letter-spacing:.5px; text-transform:uppercase; color:var(--ink); background:var(--volt);
  border:2px solid var(--ink); padding:3px 9px; transform:rotate(-6deg);
  box-shadow:3px 3px 0 var(--ink); }

/* ---- caption ---- */
.sh-caption{ font-family:'Archivo'; font-weight:600; font-size:15px; line-height:1.4;
  padding:14px 15px 10px; margin:0; }

/* ---- footer: net tally + tribunal buttons ---- */
.sh-foot{ display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:12px 15px; border-top:1px solid var(--line); background:var(--paper-2); margin-top:auto; }
.sh-tally{ display:flex; align-items:baseline; gap:6px; }
.sh-net{ font-family:'Anton'; font-size:28px; line-height:1; color:var(--signal); }
.sh-net-label{ font-family:'Space Mono'; font-weight:700; font-size:9px; letter-spacing:1.5px;
  color:var(--muted); }
.sh-votes{ display:flex; gap:8px; }
.sh-vote{ font-family:'Space Mono'; font-weight:700; font-size:13px; letter-spacing:.5px;
  border:2px solid var(--ink); background:var(--paper); color:var(--ink); padding:8px 11px;
  cursor:pointer; display:flex; align-items:center; gap:5px; transition:background .12s,color .12s; }
.sh-vote b{ font-family:'Anton'; font-size:15px; }
.sh-vote:disabled{ opacity:.5; cursor:not-allowed; }
.sh-up:hover:not(:disabled){ background:var(--volt); color:var(--ink); border-color:var(--ink); }
.sh-down:hover:not(:disabled){ background:var(--signal); color:var(--paper); border-color:var(--signal); }

@media (prefers-reduced-motion: reduce){
  .shame *, .shame *::before, .shame *::after{ animation:none !important; transition:none !important; }
}
`;
