/**
 * wagers.test.ts — node:test suite for pure wager resolution (Contract §5).
 *
 * Coverage map:
 *  - plain picks (no margin): home / draw / away, won and lost;
 *  - margin picks: boundary |d| === margin (inclusive — won), |d| < margin
 *    (lost), |d| > margin (won), right margin but wrong side (lost);
 *  - draw-pick edge cases: draw pick wins on any drawn score, loses on any
 *    decided score; margin on a draw pick is illegal;
 *  - illegal-input guards: bad scores, bad picks, bad margins.
 *
 * Run via `npm test` → `tsx --test src/lib/scoring.test.ts src/lib/wagers.test.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWager } from './wagers.js';
import type { WagerPick } from '../types.js';

describe('resolveWager — plain picks (no margin)', () => {
  it('home pick wins when home wins', () => {
    const r = resolveWager('home', null, 2, 0);
    assert.equal(r.creator_wins, true);
    assert.equal(r.state, 'RESOLVED_WON');
  });

  it('home pick loses on a draw', () => {
    const r = resolveWager('home', null, 1, 1);
    assert.equal(r.creator_wins, false);
    assert.equal(r.state, 'RESOLVED_LOST');
  });

  it('home pick loses when away wins', () => {
    const r = resolveWager('home', null, 0, 1);
    assert.equal(r.creator_wins, false);
    assert.equal(r.state, 'RESOLVED_LOST');
  });

  it('away pick wins when away wins', () => {
    const r = resolveWager('away', null, 1, 3);
    assert.equal(r.creator_wins, true);
    assert.equal(r.state, 'RESOLVED_WON');
  });

  it('away pick loses when home wins', () => {
    const r = resolveWager('away', null, 2, 1);
    assert.equal(r.creator_wins, false);
    assert.equal(r.state, 'RESOLVED_LOST');
  });

  it('undefined margin behaves exactly like null (plain pick)', () => {
    assert.equal(resolveWager('home', undefined, 1, 0).creator_wins, true);
  });
});

describe('resolveWager — draw-pick edge cases', () => {
  it('draw pick wins on 0–0', () => {
    const r = resolveWager('draw', null, 0, 0);
    assert.equal(r.creator_wins, true);
    assert.equal(r.state, 'RESOLVED_WON');
  });

  it('draw pick wins on a high-scoring draw (3–3)', () => {
    assert.equal(resolveWager('draw', null, 3, 3).creator_wins, true);
  });

  it('draw pick loses on a one-goal home win', () => {
    const r = resolveWager('draw', null, 1, 0);
    assert.equal(r.creator_wins, false);
    assert.equal(r.state, 'RESOLVED_LOST');
  });

  it('draw pick loses on an away win', () => {
    assert.equal(resolveWager('draw', null, 0, 2).creator_wins, false);
  });

  it('a margin on a draw pick is illegal (RangeError)', () => {
    assert.throws(() => resolveWager('draw', 1, 1, 1), RangeError);
    assert.throws(() => resolveWager('draw', 5, 0, 0), RangeError);
  });
});

describe('resolveWager — margin picks', () => {
  it('boundary is inclusive: |d| === margin counts as met (home, by ≥ 2, 2–0)', () => {
    const r = resolveWager('home', 2, 2, 0);
    assert.equal(r.creator_wins, true);
    assert.equal(r.state, 'RESOLVED_WON');
  });

  it('boundary is inclusive on the away side (away, by ≥ 3, 0–3)', () => {
    assert.equal(resolveWager('away', 3, 0, 3).creator_wins, true);
  });

  it('minimum margin 1 is met by any one-goal win', () => {
    assert.equal(resolveWager('home', 1, 1, 0).creator_wins, true);
  });

  it('loses when the side is right but the margin falls short (home, by ≥ 2, 1–0)', () => {
    const r = resolveWager('home', 2, 1, 0);
    assert.equal(r.creator_wins, false);
    assert.equal(r.state, 'RESOLVED_LOST');
  });

  it('wins when the margin is exceeded (away, by ≥ 2, 1–4)', () => {
    assert.equal(resolveWager('away', 2, 1, 4).creator_wins, true);
  });

  it('loses when the margin is huge but the side is WRONG (home by ≥ 2, 0–3)', () => {
    // |d| = 3 ≥ 2, but away won — pick !== actual dominates the conjunction.
    const r = resolveWager('home', 2, 0, 3);
    assert.equal(r.creator_wins, false);
    assert.equal(r.state, 'RESOLVED_LOST');
  });

  it('loses on a draw regardless of margin (home by ≥ 1, 2–2)', () => {
    assert.equal(resolveWager('home', 1, 2, 2).creator_wins, false);
  });

  it('maximum margin 10 is met by a 10-goal win', () => {
    assert.equal(resolveWager('home', 10, 10, 0).creator_wins, true);
  });

  it('maximum margin 10 falls short on a 9-goal win', () => {
    assert.equal(resolveWager('home', 10, 9, 0).creator_wins, false);
  });
});

describe('resolveWager — illegal-input guards', () => {
  it('throws RangeError on a negative score', () => {
    assert.throws(() => resolveWager('home', null, -1, 0), RangeError);
    assert.throws(() => resolveWager('home', null, 0, -1), RangeError);
  });

  it('throws RangeError on fractional scores', () => {
    assert.throws(() => resolveWager('home', null, 1.5, 0), RangeError);
  });

  it('throws RangeError on NaN / Infinity scores', () => {
    assert.throws(() => resolveWager('home', null, Number.NaN, 0), RangeError);
    assert.throws(() => resolveWager('home', null, 0, Number.POSITIVE_INFINITY), RangeError);
  });

  it('throws RangeError on margin 0 (vacuous "by ≥ 0")', () => {
    assert.throws(() => resolveWager('home', 0, 2, 0), RangeError);
  });

  it('throws RangeError on margin 11 (beyond the 1–10 product rule)', () => {
    assert.throws(() => resolveWager('home', 11, 5, 0), RangeError);
  });

  it('throws RangeError on a fractional margin', () => {
    assert.throws(() => resolveWager('home', 1.5, 2, 0), RangeError);
  });

  it('throws RangeError on an invalid pick value', () => {
    // Deliberate bad cast — the guard must catch what the type system cannot.
    assert.throws(() => resolveWager('banana' as WagerPick, null, 1, 0), RangeError);
  });
});
