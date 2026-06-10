/**
 * StateChip.tsx
 * ----------------------------------------------------------------------------
 * Jewel-coded state pill (CONTRACT §7.1 / §7.4):
 *
 *   Match display states:
 *     upcoming      → gold  #E9A23B (ink text)
 *     live          → coral #E8654F (#FFF7EA text) with a subtle pulse
 *     final         → ink-filled
 *
 *   Wager states (literal DB states, creator's perspective):
 *     PENDING       → gold
 *     ACCEPTED      → teal   #2A9D8F
 *     RESOLVED_WON  → forest #2E9E5B
 *     RESOLVED_LOST → coral
 *
 *   expired         → quiet track fill: a PENDING wager whose match locked
 *                     without an acceptor ("expired, unclaimed").
 * ----------------------------------------------------------------------------
 */

/** Every state the chip knows how to wear. */
export type ChipKind =
  | 'upcoming'
  | 'live'
  | 'final'
  | 'PENDING'
  | 'ACCEPTED'
  | 'RESOLVED_WON'
  | 'RESOLVED_LOST'
  | 'expired';

/** Static kind → (tone class, default label, pulse?) lookup. */
const CHIP_STYLE: Record<ChipKind, { tone: string; label: string; pulse?: boolean }> = {
  upcoming: { tone: 'gold', label: 'upcoming' },
  live: { tone: 'coral', label: 'live', pulse: true },
  final: { tone: 'ink', label: 'final' },
  PENDING: { tone: 'gold', label: 'pending' },
  ACCEPTED: { tone: 'teal', label: 'accepted' },
  RESOLVED_WON: { tone: 'forest', label: 'won' },
  RESOLVED_LOST: { tone: 'coral', label: 'lost' },
  expired: { tone: 'quiet', label: 'expired, unclaimed' },
};

interface StateChipProps {
  kind: ChipKind;
  /** Optional copy override; the jewel tone still follows `kind`. */
  label?: string;
}

export default function StateChip({ kind, label }: StateChipProps): JSX.Element {
  const style = CHIP_STYLE[kind];
  const classes = [
    'statechip',
    `statechip--${style.tone}`,
    style.pulse ? 'statechip--pulse' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return <span className={classes}>{label ?? style.label}</span>;
}
