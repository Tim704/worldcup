/**
 * ScoreStepper.tsx
 * ----------------------------------------------------------------------------
 * The − / value / + control (CONTRACT §7.4): an inset paper cell with two
 * pressable ink-bordered buttons flanking a Fraunces-900 "stamped" numeral.
 *
 * Defaults match the prediction rules (goals 0–20); the wager composer reuses
 * it for the winning margin (1–10) by overriding min/max. The value is clamped
 * defensively on every step so it can never escape [min, max].
 * ----------------------------------------------------------------------------
 */

interface ScoreStepperProps {
  /** Accessible name for what is being stepped, e.g. "Brazil goals". */
  label: string;
  value: number;
  onChange: (next: number) => void;
  /** Inclusive lower bound (default 0 — you cannot un-score a goal). */
  min?: number;
  /** Inclusive upper bound (default 20, per the predictions CHECK). */
  max?: number;
  disabled?: boolean;
}

export default function ScoreStepper({
  label,
  value,
  onChange,
  min = 0,
  max = 20,
  disabled = false,
}: ScoreStepperProps): JSX.Element {
  /** Clamp into [min, max] so a stray double-tap can never overshoot. */
  const clamp = (n: number): number => Math.min(max, Math.max(min, n));

  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="stepper-btn"
        aria-label={`decrease ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        −
      </button>
      <span className="stepper-value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="stepper-btn"
        aria-label={`increase ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        +
      </button>
    </div>
  );
}
