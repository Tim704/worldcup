/**
 * bracketPicks.ts — validators for the Tournament Predictor documents
 * (Contract §11). Pure input → normalised output; every failure throws
 * `AppError('VALIDATION', …)` via lib/validate.ts `invalid()`.
 *
 * Chain of Thought: what must hold for a prophecy document to be storable?
 *  1. `group_picks` keys are group letters — WC2026 has exactly 12 groups,
 *     A through L. Any other key is a malformed (or hostile) document.
 *  2. Each group value is the user's predicted finishing ORDER: an array of
 *     distinct team display names, at most 4 (4-team groups). PARTIAL orders
 *     are legal — a half-finished prophecy must still save — so we bound the
 *     length but never require completeness.
 *  3. `third_picks` lists the letters whose 3rd-placed team takes a
 *     best-third berth: at most 8 (8 berths), distinct, valid letters. We
 *     store LETTERS, not names, so a later re-ordering of a group silently
 *     re-points the pick at the new 3rd-placed team — no stale-name bugs.
 *  4. `bracket_picks` keys are FIFA knockout match numbers (M73–M102 plus
 *     M104; M103, the third-place match, is not part of the predictor), and
 *     each value is the picked winner's team name. Key-set membership plus
 *     JSON-object key uniqueness bounds the document size for free.
 *  5. Team names: trimmed, 1–60 chars. The server does NOT cross-check names
 *     against the `matches` table: the names flow from the client's own
 *     matches feed and the document is self-referential (group_picks carries
 *     them) — a user can only ever corrupt their own prophecy, and coupling
 *     the validator to ingest timing would buy zero integrity for real
 *     fragility (e.g. a feed rename stranding every saved bracket).
 */
import { invalid } from './validate.js';

/** The 12 WC2026 group letters (Contract §11). */
export const GROUP_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
] as const;

/**
 * Every knockout slot the predictor knows, keyed by FIFA match number.
 * Mirrors the frontend chart in frontend/src/lib/bracket.ts — keep in sync.
 */
export const BRACKET_SLOT_KEYS = [
  // round of 32 — FIFA matches 73–88
  'M73', 'M74', 'M75', 'M76', 'M77', 'M78', 'M79', 'M80',
  'M81', 'M82', 'M83', 'M84', 'M85', 'M86', 'M87', 'M88',
  // round of 16 — 89–96
  'M89', 'M90', 'M91', 'M92', 'M93', 'M94', 'M95', 'M96',
  // quarter-finals — 97–100
  'M97', 'M98', 'M99', 'M100',
  // semi-finals — 101–102
  'M101', 'M102',
  // the final — 104 (M103, the third-place match, is deliberately absent)
  'M104',
] as const;

const LETTER_SET = new Set<string>(GROUP_LETTERS);
const SLOT_KEY_SET = new Set<string>(BRACKET_SLOT_KEYS);

/** Max team-name length — mirrors how matches.home_team is used in practice. */
const TEAM_NAME_MAX = 60;

/** Max teams per group order (WC2026 groups hold 4 teams). */
const GROUP_SIZE_MAX = 4;

/** Max best-third berths (WC2026 advances the 8 best third-placed teams). */
const THIRD_BERTHS_MAX = 8;

/** A trimmed 1–60 char team name, or VALIDATION. */
function vTeamName(value: unknown, where: string): string {
  if (typeof value !== 'string') invalid(`${where} must be a string team name`);
  const trimmed = (value as string).trim();
  if (trimmed.length < 1 || trimmed.length > TEAM_NAME_MAX) {
    invalid(`${where} must be 1–${TEAM_NAME_MAX} characters after trimming`);
  }
  return trimmed;
}

/** A plain JSON object (not null / array / scalar), or VALIDATION. */
function vPlainObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${field} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Validate + normalise `group_picks`: letter-keyed predicted finishing
 * orders. Returns a fresh object with trimmed names.
 */
export function vGroupPicks(value: unknown): Record<string, string[]> {
  const raw = vPlainObject(value, 'group_picks');
  const out: Record<string, string[]> = {};
  for (const [letter, order] of Object.entries(raw)) {
    if (!LETTER_SET.has(letter)) {
      invalid(`group_picks key '${letter}' is not a group letter (A–L)`);
    }
    if (!Array.isArray(order)) {
      invalid(`group_picks.${letter} must be an array of team names`);
    }
    if (order.length > GROUP_SIZE_MAX) {
      invalid(`group_picks.${letter} holds more than ${GROUP_SIZE_MAX} teams`);
    }
    const names = order.map((t, i) => vTeamName(t, `group_picks.${letter}[${i}]`));
    if (new Set(names).size !== names.length) {
      invalid(`group_picks.${letter} repeats a team`);
    }
    out[letter] = names;
  }
  return out;
}

/**
 * Validate + normalise `third_picks`: ≤ 8 distinct group letters whose
 * 3rd-placed team is predicted to advance.
 */
export function vThirdPicks(value: unknown): string[] {
  if (!Array.isArray(value)) invalid('third_picks must be an array of group letters');
  const arr = value as unknown[];
  if (arr.length > THIRD_BERTHS_MAX) {
    invalid(`third_picks holds more than ${THIRD_BERTHS_MAX} letters`);
  }
  const letters = arr.map((l) => {
    if (typeof l !== 'string' || !LETTER_SET.has(l)) {
      invalid(`third_picks entry '${String(l)}' is not a group letter (A–L)`);
    }
    return l as string;
  });
  if (new Set(letters).size !== letters.length) invalid('third_picks repeats a letter');
  return letters;
}

/**
 * Validate + normalise `bracket_picks`: slot-keyed picked winners. Keys must
 * be known FIFA match numbers; values are team names.
 */
export function vBracketPicks(value: unknown): Record<string, string> {
  const raw = vPlainObject(value, 'bracket_picks');
  const out: Record<string, string> = {};
  for (const [slot, team] of Object.entries(raw)) {
    if (!SLOT_KEY_SET.has(slot)) {
      invalid(`bracket_picks key '${slot}' is not a knockout slot (M73–M104)`);
    }
    out[slot] = vTeamName(team, `bracket_picks.${slot}`);
  }
  return out;
}
