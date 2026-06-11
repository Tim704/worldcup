/**
 * bracket.ts — the Tournament Predictor engine (Contract §11).
 * ----------------------------------------------------------------------------
 * Pure data + pure functions, no fetch and no React:
 *
 *   - the OFFICIAL WC2026 knockout chart (FIFA matches 73–104), encoded as
 *     slot specs whose sides reference group positions, best-third berths or
 *     earlier winners;
 *   - `groupsFromMatches`   — derive the 12 groups (A–L) + their teams from
 *     the live `/api/matches` feed (never hardcoded team lists);
 *   - `assignThirdBerths`   — map the user's picked third-placed letters onto
 *     the 8 conditional berth slots (maximum bipartite matching);
 *   - `resolveBracket`      — one forward pass that fills every slot from the
 *     user's picks and prunes any pick its own premise no longer supports
 *     (the "reset the branch" behaviour).
 *
 * Slot keys are FIFA match numbers ('M73'…'M104'); the server-side validator
 * (server/src/lib/bracketPicks.ts) recognises exactly the same set — keep in
 * sync. M103, the third-place match, is deliberately not part of the
 * predictor (the brief funnels straight to the champion).
 * ----------------------------------------------------------------------------
 */

import type {
  BracketGroupPicks,
  BracketSlotPicks,
  BracketThirdPicks,
  Match,
} from '../types/models';

/* ===========================================================================
 * The chart — groups & rounds
 * ======================================================================== */

/** The 12 WC2026 group letters. */
export const GROUP_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
] as const;

export type GroupLetter = (typeof GROUP_LETTERS)[number];

/** Type guard for a group letter coming in as a plain string. */
export function isGroupLetter(value: string): value is GroupLetter {
  return (GROUP_LETTERS as readonly string[]).includes(value);
}

export type RoundKey = 'R32' | 'R16' | 'QF' | 'SF' | 'F';

/** Knockout rounds in play order, with their on-paper labels (§7 voice). */
export const ROUNDS: ReadonlyArray<{ key: RoundKey; label: string }> = [
  { key: 'R32', label: 'round of 32' },
  { key: 'R16', label: 'round of 16' },
  { key: 'QF', label: 'quarter-finals' },
  { key: 'SF', label: 'semi-finals' },
  { key: 'F', label: 'the final' },
];

/** Where one side of a knockout tie comes from. */
export type SourceRef =
  | { kind: 'group'; letter: GroupLetter; pos: 1 | 2 } // group winner / runner-up
  | { kind: 'third'; allowed: readonly GroupLetter[] } // conditional best-third berth
  | { kind: 'winner'; of: string }; // winner of an earlier slot

/** One knockout tie in the chart. */
export interface SlotSpec {
  key: string; // FIFA match number, e.g. 'M74'
  round: RoundKey;
  home: SourceRef;
  away: SourceRef;
}

// Tiny constructors keep the chart below readable as a table.
const g = (letter: GroupLetter, pos: 1 | 2): SourceRef => ({ kind: 'group', letter, pos });
const t = (...allowed: GroupLetter[]): SourceRef => ({ kind: 'third', allowed });
const w = (of: string): SourceRef => ({ kind: 'winner', of });

/**
 * The official FIFA WC2026 knockout chart (matches 73–104, third-place match
 * excluded). Listed in DISPLAY order, not match-number order: adjacent R32
 * pairs feed one R16 tie, adjacent R16 pairs feed one quarter-final, and so
 * on — so each rendered column funnels visually into the next.
 */
export const BRACKET_CHART: readonly SlotSpec[] = [
  // -- round of 32 — top half (feeds semi-final M101) -----------------------
  { key: 'M74', round: 'R32', home: g('E', 1), away: t('A', 'B', 'C', 'D', 'F') },
  { key: 'M77', round: 'R32', home: g('I', 1), away: t('C', 'D', 'F', 'G', 'H') },
  { key: 'M73', round: 'R32', home: g('A', 2), away: g('B', 2) },
  { key: 'M75', round: 'R32', home: g('F', 1), away: g('C', 2) },
  { key: 'M83', round: 'R32', home: g('K', 2), away: g('L', 2) },
  { key: 'M84', round: 'R32', home: g('H', 1), away: g('J', 2) },
  { key: 'M81', round: 'R32', home: g('D', 1), away: t('B', 'E', 'F', 'I', 'J') },
  { key: 'M82', round: 'R32', home: g('G', 1), away: t('A', 'E', 'H', 'I', 'J') },
  // -- round of 32 — bottom half (feeds semi-final M102) --------------------
  { key: 'M76', round: 'R32', home: g('C', 1), away: g('F', 2) },
  { key: 'M78', round: 'R32', home: g('E', 2), away: g('I', 2) },
  { key: 'M79', round: 'R32', home: g('A', 1), away: t('C', 'E', 'F', 'H', 'I') },
  { key: 'M80', round: 'R32', home: g('L', 1), away: t('E', 'H', 'I', 'J', 'K') },
  { key: 'M86', round: 'R32', home: g('J', 1), away: g('H', 2) },
  { key: 'M88', round: 'R32', home: g('D', 2), away: g('G', 2) },
  { key: 'M85', round: 'R32', home: g('B', 1), away: t('E', 'F', 'G', 'I', 'J') },
  { key: 'M87', round: 'R32', home: g('K', 1), away: t('D', 'E', 'I', 'J', 'L') },
  // -- round of 16 ----------------------------------------------------------
  { key: 'M89', round: 'R16', home: w('M74'), away: w('M77') },
  { key: 'M90', round: 'R16', home: w('M73'), away: w('M75') },
  { key: 'M93', round: 'R16', home: w('M83'), away: w('M84') },
  { key: 'M94', round: 'R16', home: w('M81'), away: w('M82') },
  { key: 'M91', round: 'R16', home: w('M76'), away: w('M78') },
  { key: 'M92', round: 'R16', home: w('M79'), away: w('M80') },
  { key: 'M95', round: 'R16', home: w('M86'), away: w('M88') },
  { key: 'M96', round: 'R16', home: w('M85'), away: w('M87') },
  // -- quarter-finals ---------------------------------------------------------
  { key: 'M97', round: 'QF', home: w('M89'), away: w('M90') },
  { key: 'M98', round: 'QF', home: w('M93'), away: w('M94') },
  { key: 'M99', round: 'QF', home: w('M91'), away: w('M92') },
  { key: 'M100', round: 'QF', home: w('M95'), away: w('M96') },
  // -- semi-finals ------------------------------------------------------------
  { key: 'M101', round: 'SF', home: w('M97'), away: w('M98') },
  { key: 'M102', round: 'SF', home: w('M99'), away: w('M100') },
  // -- the final --------------------------------------------------------------
  { key: 'M104', round: 'F', home: w('M101'), away: w('M102') },
];

/* ===========================================================================
 * Groups from the live matches feed
 * ======================================================================== */

/** One group as derived from the feed: its letter and the teams seen in it. */
export interface GroupTeams {
  letter: GroupLetter;
  teams: string[];
}

/**
 * Derive the group-stage table of contents from `/api/matches`: every match
 * whose `group_label` is 'GROUP A'…'GROUP L' contributes its two team names
 * (insertion order = kickoff order, which reads naturally). Knockout rows
 * (`group_label` null) are ignored — the chart above covers those.
 */
export function groupsFromMatches(
  matches: ReadonlyArray<Pick<Match, 'group_label' | 'home_team' | 'away_team'>>,
): GroupTeams[] {
  const byLetter = new Map<GroupLetter, string[]>();
  for (const m of matches) {
    const found = /^GROUP ([A-L])$/.exec(m.group_label ?? '');
    if (!found) continue;
    const letter = found[1] as GroupLetter;
    const teams = byLetter.get(letter) ?? [];
    for (const team of [m.home_team, m.away_team]) {
      if (!teams.includes(team)) teams.push(team);
    }
    byLetter.set(letter, teams);
  }
  return Array.from(byLetter.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, teams]) => ({ letter, teams }));
}

/* ===========================================================================
 * Best-third berth assignment
 * ======================================================================== */

/**
 * Chain of Thought — mapping picked thirds onto the 8 conditional berths:
 *  1. The official chart does not say "the 3rd of group X plays here"; each
 *     of the 8 berth slots carries an ALLOWED SET (e.g. M74's opponent is the
 *     3rd of A/B/C/D/F) and the concrete allocation depends on WHICH eight
 *     thirds qualify — FIFA publishes a 495-row allocation table for exactly
 *     this.
 *  2. So given the user's ≤ 8 picked letters we need an injective assignment
 *     letter → slot with letter ∈ allowed(slot). That is maximum bipartite
 *     matching on a graph of at most 8 × 8 — Kuhn's augmenting-path algorithm
 *     is exact and instant at this size, and unlike a greedy pass it cannot
 *     paint itself into a corner (greedy could burn M74's slot on a letter
 *     that had other options and strand one that did not).
 *  3. FIFA designed the allowed sets so every REAL qualifying combination has
 *     a perfect matching; if a hand-picked combination happens not to, the
 *     unmatched letters simply stay berth-less (their R32 side reads TBD)
 *     rather than us inventing an illegal pairing.
 */
export function assignThirdBerths(thirdPicks: BracketThirdPicks): Map<string, GroupLetter> {
  const slots = BRACKET_CHART.filter((s) => s.round === 'R32' && s.away.kind === 'third');
  const letters = thirdPicks.filter(isGroupLetter);

  // slotAssignee[si] = index into `letters` currently holding slot si.
  const slotAssignee: Array<number | null> = slots.map(() => null);

  // Kuhn's: try to place letter li, recursively evicting + re-placing earlier
  // letters along an augmenting path. `seen` stops cycles within one attempt.
  const tryPlace = (li: number, seen: boolean[]): boolean => {
    for (let si = 0; si < slots.length; si += 1) {
      const allowed = (slots[si].away as { allowed: readonly GroupLetter[] }).allowed;
      if (seen[si] || !allowed.includes(letters[li])) continue;
      seen[si] = true;
      const current = slotAssignee[si];
      if (current === null || tryPlace(current, seen)) {
        slotAssignee[si] = li;
        return true;
      }
    }
    return false;
  };

  for (let li = 0; li < letters.length; li += 1) {
    tryPlace(li, slots.map(() => false));
  }

  const out = new Map<string, GroupLetter>();
  slotAssignee.forEach((li, si) => {
    if (li !== null) out.set(slots[si].key, letters[li]);
  });
  return out;
}

/* ===========================================================================
 * Bracket resolution — fill every slot, prune every orphaned pick
 * ======================================================================== */

/** One resolved side of a tie: the team (when determined) + a placeholder label. */
export interface ResolvedSide {
  team: string | null;
  label: string;
}

/** One fully-resolved knockout tie, ready to render. */
export interface ResolvedSlot {
  key: string;
  round: RoundKey;
  home: ResolvedSide;
  away: ResolvedSide;
  /** The stored pick — only if its team still occupies one of the two sides. */
  pick: string | null;
}

/** The whole resolved tree, grouped per round for the rail columns. */
export interface ResolvedBracket {
  rounds: Array<{ key: RoundKey; label: string; slots: ResolvedSlot[] }>;
  champion: string | null;
  /** The picks that survived pruning — exactly what should be persisted. */
  validBracketPicks: BracketSlotPicks;
}

/**
 * Chain of Thought — cascade-pruning resolution:
 *  1. A stored pick is only meaningful while its team still occupies one of
 *     the two feeding sides of its slot; anything else is a stale prophecy.
 *  2. Sides resolve strictly in round order (R32 → F): an R32 side comes from
 *     the group orders / berth assignment, every later side is "the surviving
 *     pick of an earlier slot". So by the time slot S is examined, the
 *     validity of every feeder is already settled.
 *  3. Therefore ONE forward pass over the chart suffices: resolve both sides,
 *     keep the stored pick iff it equals a resolved side's team, and record
 *     only the survivors. When the user re-orders a group or re-toggles a
 *     berth, the affected R32 sides change, their picks fail the check, the
 *     next round's sides become null, and so on down the tree — the
 *     "reset the downstream branch" behaviour falls out of the data flow with
 *     no imperative cleanup walk to forget or get wrong.
 */
export function resolveBracket(
  groupPicks: BracketGroupPicks,
  thirdPicks: BracketThirdPicks,
  bracketPicks: BracketSlotPicks,
): ResolvedBracket {
  const berths = assignThirdBerths(thirdPicks);
  const resolved = new Map<string, ResolvedSlot>();
  const validBracketPicks: BracketSlotPicks = {};

  const sideOf = (slot: SlotSpec, ref: SourceRef): ResolvedSide => {
    if (ref.kind === 'group') {
      const team = groupPicks[ref.letter]?.[ref.pos - 1] ?? null;
      const role = ref.pos === 1 ? 'winner' : 'runner-up';
      return { team, label: `group ${ref.letter.toLowerCase()} ${role}` };
    }
    if (ref.kind === 'third') {
      const letter = berths.get(slot.key);
      if (letter) {
        return {
          team: groupPicks[letter]?.[2] ?? null,
          label: `3rd of group ${letter.toLowerCase()}`,
        };
      }
      return {
        team: null,
        label: `best 3rd · ${ref.allowed.map((l) => l.toLowerCase()).join('/')}`,
      };
    }
    // 'winner' — the feeder is guaranteed already resolved (chart is in
    // round order), so its surviving pick IS this side's team.
    const feeder = resolved.get(ref.of);
    return { team: feeder?.pick ?? null, label: `winner of ${ref.of.toLowerCase()}` };
  };

  for (const spec of BRACKET_CHART) {
    const home = sideOf(spec, spec.home);
    const away = sideOf(spec, spec.away);
    const stored = bracketPicks[spec.key];
    const pick =
      stored !== undefined && stored !== null && (stored === home.team || stored === away.team)
        ? stored
        : null;
    if (pick !== null) validBracketPicks[spec.key] = pick;
    resolved.set(spec.key, { key: spec.key, round: spec.round, home, away, pick });
  }

  const rounds = ROUNDS.map((r) => ({
    key: r.key,
    label: r.label,
    slots: BRACKET_CHART.filter((s) => s.round === r.key).map((s) => resolved.get(s.key)!),
  }));

  return {
    rounds,
    champion: resolved.get('M104')?.pick ?? null,
    validBracketPicks,
  };
}

/* ===========================================================================
 * Two-sided tree layout — split the draw into a left and right half that
 * converge on the centred final (Contract §11.5).
 * ======================================================================== */

/** Collect `rootKey` and every slot that transitively feeds into it. */
function descendantsOf(rootKey: string): Set<string> {
  const byKey = new Map(BRACKET_CHART.map((s) => [s.key, s]));
  const out = new Set<string>();
  const walk = (key: string): void => {
    if (out.has(key)) return;
    out.add(key);
    const spec = byKey.get(key);
    if (!spec) return;
    for (const ref of [spec.home, spec.away]) {
      if (ref.kind === 'winner') walk(ref.of);
    }
  };
  walk(rootKey);
  return out;
}

// The two halves of the draw, identified by the semi-final each funnels into:
// M101 is the top/left half, M102 the bottom/right half. Computed once from
// the static chart — every R32…SF slot lands in exactly one, M104 in neither.
const LEFT_HALF = descendantsOf('M101');
const RIGHT_HALF = descendantsOf('M102');

/** Which side of the convergent tree a column sits on. */
export type BracketSide = 'left' | 'right' | 'center';

/** One rendered column of the two-sided tree. */
export interface BracketColumn {
  /** Unique per column (round + side), e.g. 'R16-left'. */
  key: string;
  round: RoundKey;
  side: BracketSide;
  label: string;
  slots: ResolvedSlot[];
}

/**
 * Arrange a resolved bracket into the columns of a two-sided tree:
 *
 *   R32 R16 QF SF · FINAL · SF QF R16 R32
 *   └──── left half ────┘         └──── right half ────┘
 *
 * The left half flows inward (left→right); the right half is the same rounds
 * mirrored (reversed) so both sides converge on the centred final. Each half
 * keeps the chart's slot order, which is authored so a tie's two feeders sit
 * adjacent — exactly what lets the CSS `space-around` funnel line every tie up
 * with the pair that feeds it.
 */
export function bracketColumns(resolved: ResolvedBracket): BracketColumn[] {
  const byRound = new Map(resolved.rounds.map((r) => [r.key, r]));
  const labelOf = (round: RoundKey): string => ROUNDS.find((r) => r.key === round)!.label;
  const halfSlots = (round: RoundKey, side: 'left' | 'right'): ResolvedSlot[] => {
    const set = side === 'left' ? LEFT_HALF : RIGHT_HALF;
    return (byRound.get(round)?.slots ?? []).filter((s) => set.has(s.key));
  };

  // Rounds that fan out on each wing (the final is the shared centre).
  const wing: RoundKey[] = ['R32', 'R16', 'QF', 'SF'];
  const left: BracketColumn[] = wing.map((round) => ({
    key: `${round}-left`,
    round,
    side: 'left',
    label: labelOf(round),
    slots: halfSlots(round, 'left'),
  }));
  const center: BracketColumn = {
    key: 'F-center',
    round: 'F',
    side: 'center',
    label: labelOf('F'),
    slots: byRound.get('F')?.slots ?? [],
  };
  const right: BracketColumn[] = [...wing].reverse().map((round) => ({
    key: `${round}-right`,
    round,
    side: 'right',
    label: labelOf(round),
    slots: halfSlots(round, 'right'),
  }));
  return [...left, center, ...right];
}
