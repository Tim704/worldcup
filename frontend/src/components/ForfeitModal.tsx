/**
 * ForfeitModal.tsx — "The Bloodline" Forfeit Creation modal (CONTRACT §7)
 * ----------------------------------------------------------------------------
 * A mobile-first, full-width bottom sheet for issuing a new forfeit challenge:
 *   - choose an OPPONENT (a friend),
 *   - write the STAKE (the punishment on the line),
 *   - optionally pick the MATCH it rides on,
 *   - submit → POST /api/forfeits via createForfeit() (§6).
 *
 * Accessibility (a hard requirement here):
 *   - role="dialog" + aria-modal="true" + aria-labelledby.
 *   - The first field is focused on open.
 *   - Esc closes the sheet; a click on the scrim closes it.
 *   - A focus trap keeps Tab/Shift+Tab inside the dialog while it is open.
 *
 * Client-side validation runs before submit: an opponent and a non-blank stake
 * are required. Styling is self-contained in one injected <style> block scoped
 * under `.fm`. Spacing is metric (px/rem); no physical quantities here.
 * ----------------------------------------------------------------------------
 */

import type React from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createForfeit } from '../api/client';
import type { Forfeit, Match, User } from '../types/models';

/* ===========================================================================
 * Props
 * ======================================================================== */

interface ForfeitModalProps {
  /** Whether the sheet is mounted/open. */
  open: boolean;
  /** The current (challenging) user's id — sent as challenger_id. */
  challengerId: string;
  /** Selectable opponents (friends), excluding the challenger. */
  opponents: User[];
  /** Selectable matches the wager can ride on (optional pick). */
  matches: Match[];
  /** Close handler (Esc / scrim / cancel / after a successful submit). */
  onClose: () => void;
  /** Fired with the freshly created (pending) forfeit so the list can refresh. */
  onCreated: (forfeit: Forfeit) => void;
}

/* ===========================================================================
 * Component
 * ======================================================================== */

export default function ForfeitModal(props: ForfeitModalProps): React.ReactElement | null {
  const { open, challengerId, opponents, matches, onClose, onCreated } = props;

  // Form state.
  const [opponentId, setOpponentId] = useState<string>('');
  const [stake, setStake] = useState<string>('');
  const [matchId, setMatchId] = useState<string>(''); // '' → no match attached
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Refs for accessibility (focus management + focus trap).
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  // Stable ids tying the title/labels to the dialog for screen readers.
  const titleId = useId();

  // Reset the form whenever the sheet transitions to open.
  useEffect(() => {
    if (open) {
      setOpponentId('');
      setStake('');
      setMatchId('');
      setError(null);
      setSubmitting(false);
      // Focus the first field on the next frame (after it is rendered/visible).
      const raf = requestAnimationFrame(() => firstFieldRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [open]);

  // Esc-to-close + a simple Tab focus trap while the dialog is open.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }
      // Keep focus inside the dialog: wrap from last → first and vice versa.
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // The challenger must never appear as a selectable opponent (DB CHECK §3).
  const selectableOpponents = useMemo(
    () => opponents.filter((u) => u.id !== challengerId),
    [opponents, challengerId],
  );

  // Don't render anything when closed (keeps the DOM clean + focus predictable).
  if (!open) {
    return null;
  }

  /** Validate, then POST the challenge; surface validation/transport errors. */
  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    // ---- client-side validation ----
    if (!opponentId) {
      setError('Pick an opponent to challenge.');
      return;
    }
    const trimmedStake = stake.trim();
    if (trimmedStake.length === 0) {
      setError('Describe the stake (the punishment on the line).');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const forfeit = await createForfeit({
        challenger_id: challengerId,
        opponent_id: opponentId,
        match_id: matchId || undefined, // omit when no match is attached
        stake: trimmedStake,
      });
      onCreated(forfeit);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not create the challenge.',
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="fm">
      <style>{CSS}</style>

      {/* Scrim — click anywhere outside the sheet to dismiss. */}
      <div className="fm-scrim" onClick={onClose} aria-hidden />

      {/* The dialog itself: a full-width bottom sheet on phones. */}
      <div
        className="fm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
      >
        <div className="fm-grip" aria-hidden />

        <header className="fm-head">
          <h2 id={titleId} className="fm-title">
            New Challenge
          </h2>
          <button
            type="button"
            className="fm-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </header>

        <form className="fm-form" onSubmit={handleSubmit} noValidate>
          {/* ---- opponent ---- */}
          <label className="fm-field">
            <span className="fm-label">Opponent</span>
            <select
              ref={firstFieldRef}
              className="fm-input"
              value={opponentId}
              onChange={(e) => setOpponentId(e.target.value)}
              required
            >
              <option value="">— pick a friend —</option>
              {selectableOpponents.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name} (@{u.username})
                </option>
              ))}
            </select>
          </label>

          {/* ---- stake (the punishment) ---- */}
          <label className="fm-field">
            <span className="fm-label">The Stake</span>
            <textarea
              className="fm-input fm-textarea"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder="e.g. Wear the rival jersey for a full workday"
              rows={3}
              maxLength={280}
              required
            />
            <span className="fm-hint">{stake.trim().length}/280 — make it hurt.</span>
          </label>

          {/* ---- optional match ---- */}
          <label className="fm-field">
            <span className="fm-label">
              Match <em>(optional)</em>
            </span>
            <select
              className="fm-input"
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
            >
              <option value="">— no match attached —</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.home_team} v {m.away_team}
                  {m.group_label ? ` · ${m.group_label}` : ''}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <p className="fm-error" role="alert">
              {error}
            </p>
          )}

          <div className="fm-actions">
            <button
              type="button"
              className="fm-btn fm-btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="fm-btn fm-btn-go" disabled={submitting}>
              <span>{submitting ? 'SENDING…' : 'ISSUE CHALLENGE →'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ===========================================================================
 * Styles — injected once, scoped under .fm.
 * ======================================================================== */

const CSS = `
.fm{
  --paper:#f1ece0; --paper-2:#e6dfce; --ink:#0d0d0b; --ink-2:#17170f;
  --signal:#ff3a0e; --volt:#d6ff15; --muted:#7a7060; --line:rgba(13,13,11,.16);
  font-family:'Archivo',system-ui,-apple-system,sans-serif; color:var(--ink);
  position:fixed; inset:0; z-index:100; display:flex; align-items:flex-end; justify-content:center;
}
.fm *{ box-sizing:border-box; }

/* ---- scrim ---- */
.fm-scrim{ position:absolute; inset:0; background:rgba(13,13,11,.6); animation:fm-fade .18s both; }

/* ---- sheet (full-width bottom sheet on phones; centred card on wide screens) ---- */
.fm-sheet{ position:relative; width:100%; max-width:520px; max-height:92vh; overflow-y:auto;
  background:var(--paper); border:3px solid var(--ink); border-bottom:none;
  box-shadow:0 -10px 0 var(--signal); padding:8px clamp(16px,5vw,24px) calc(20px + env(safe-area-inset-bottom,0px));
  animation:fm-rise .26s cubic-bezier(.2,.8,.2,1) both; }
@media(min-width:560px){
  .fm{ align-items:center; }
  .fm-sheet{ border-bottom:3px solid var(--ink); box-shadow:11px 11px 0 var(--signal); }
}
.fm-grip{ width:46px; height:5px; background:var(--line); border-radius:3px; margin:8px auto 6px; }

/* ---- header ---- */
.fm-head{ display:flex; align-items:center; justify-content:space-between;
  border-bottom:3px solid var(--ink); padding-bottom:12px; margin-bottom:16px; }
.fm-title{ font-family:'Anton'; font-size:clamp(24px,7vw,32px); text-transform:uppercase;
  letter-spacing:-.4px; margin:0; }
.fm-close{ width:36px; height:36px; flex:none; background:var(--ink); color:var(--paper);
  border:none; font-size:15px; cursor:pointer; display:grid; place-items:center; }
.fm-close:hover{ background:var(--signal); }

/* ---- form ---- */
.fm-form{ display:flex; flex-direction:column; gap:16px; }
.fm-field{ display:flex; flex-direction:column; gap:6px; }
.fm-label{ font-family:'Space Mono'; font-weight:700; font-size:11px; letter-spacing:1.5px;
  text-transform:uppercase; color:var(--ink); }
.fm-label em{ font-style:normal; color:var(--muted); font-size:10px; }
.fm-input{ font-family:'Archivo'; font-size:15px; color:var(--ink); background:var(--paper);
  border:2px solid var(--ink); padding:11px 12px; width:100%; appearance:none;
  -webkit-appearance:none; }
.fm-input:focus{ outline:none; border-color:var(--signal); box-shadow:3px 3px 0 var(--signal); }
.fm-textarea{ resize:vertical; min-height:72px; line-height:1.4; }
.fm-hint{ font-family:'Space Mono'; font-size:10px; letter-spacing:.5px; color:var(--muted); }

/* ---- error ---- */
.fm-error{ font-family:'Space Mono'; font-weight:700; font-size:12px; letter-spacing:.5px;
  color:var(--paper); background:var(--signal); padding:9px 12px; margin:0; }

/* ---- actions ---- */
.fm-actions{ display:flex; gap:10px; margin-top:4px; }
.fm-btn{ font-family:'Anton'; text-transform:uppercase; font-size:16px; letter-spacing:.4px;
  border:2px solid var(--ink); padding:13px 16px; cursor:pointer; flex:1;
  transition:transform .12s,box-shadow .12s,background .12s; }
.fm-btn:disabled{ opacity:.5; cursor:not-allowed; }
.fm-btn-ghost{ background:var(--paper); color:var(--ink); flex:0 0 38%; }
.fm-btn-ghost:hover:not(:disabled){ background:var(--paper-2); }
.fm-btn-go{ background:var(--signal); color:var(--paper); box-shadow:4px 4px 0 var(--ink); }
.fm-btn-go span{ display:inline-block; }
.fm-btn-go:hover:not(:disabled){ transform:translate(-2px,-2px); box-shadow:6px 6px 0 var(--ink); }
.fm-btn-go:active:not(:disabled){ transform:translate(2px,2px); box-shadow:1px 1px 0 var(--ink); }

/* ---- keyframes ---- */
@keyframes fm-fade{ from{ opacity:0; } to{ opacity:1; } }
@keyframes fm-rise{ from{ transform:translateY(28px); opacity:0; } to{ transform:none; opacity:1; } }

@media (prefers-reduced-motion: reduce){
  .fm *, .fm *::before, .fm *::after{ animation:none !important; transition:none !important; }
}
`;
