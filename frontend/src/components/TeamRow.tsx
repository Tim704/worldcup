/**
 * TeamRow.tsx
 * ----------------------------------------------------------------------------
 * One team as a tappable paper row (Contract §11): flag + name, plus an
 * optional finishing-position dot and an optional jewel status pill. Reused
 * by both halves of the Tournament Predictor —
 *   - GroupCard: tap-to-rank (rank dot + through/wildcard/out pills);
 *   - BracketMatchup: tap-to-advance (gold "picked" fill, TBD placeholders).
 *
 * Renders a <button> when tappable, a plain <div> when purely presentational.
 * A null `team` is an undecided slot: muted, dashed, showing `placeholder`
 * (e.g. "winner of m89" / "best 3rd · a/b/c/d/f").
 * ----------------------------------------------------------------------------
 */

import { flagFor } from '../lib/flags';

/** Jewel tones shared with .statechip (almanac.css). */
export type TeamRowTone = 'gold' | 'teal' | 'coral' | 'forest' | 'ink' | 'quiet';

/** The status pill at the row's trailing edge. */
export interface TeamRowChip {
  tone: TeamRowTone;
  label: string;
}

interface TeamRowProps {
  /** Team display name, or null for an undecided slot. */
  team: string | null;
  /** Placeholder copy for undecided slots ("winner of m89", …). */
  placeholder?: string;
  /** Predicted finishing position (group cards); dot turns gold for 1–2. */
  rank?: number | null;
  /** Optional jewel status pill (through / wildcard / out / …). */
  chip?: TeamRowChip | null;
  /** Gold "picked" fill — the bracket's advanced team. */
  selected?: boolean;
  /** Eliminated side of a decided tie — struck through and faded. */
  muted?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Accessible description of what tapping does. */
  ariaLabel?: string;
}

export default function TeamRow({
  team,
  placeholder,
  rank = null,
  chip = null,
  selected = false,
  muted = false,
  disabled = false,
  onClick,
  ariaLabel,
}: TeamRowProps): JSX.Element {
  const flag = team ? flagFor(team) : null;
  const className = [
    'team-row',
    selected ? 'on' : '',
    team === null ? 'team-row--tbd' : '',
    muted ? 'team-row--out' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {rank !== null && (
        <span className={`rank-dot${rank <= 2 ? ' rank-dot--in' : ''}`}>{rank}</span>
      )}
      {flag && (
        <span className="team-flag" aria-hidden="true">
          {flag}
        </span>
      )}
      <span className="team-row-name">{team ?? placeholder ?? 'to be decided'}</span>
      {chip && <span className={`statechip statechip--${chip.tone}`}>{chip.label}</span>}
    </>
  );

  if (!onClick) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={selected}
    >
      {content}
    </button>
  );
}
