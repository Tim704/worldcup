/**
 * bracketPicks.test.ts — node:test suite for the prophecy validators
 * (Contract §11).
 *
 * Coverage map:
 *  - group_picks: happy path (full + partial + empty), trimming, bad keys,
 *    non-array values, over-length orders, duplicate teams, bad/blank names;
 *  - third_picks: happy path, cap of 8, duplicate letters, non-letters;
 *  - bracket_picks: happy path across all rounds, M103 rejection, unknown
 *    keys, bad winner values;
 *  - top-level shape guards: null / array / scalar documents.
 *
 * Run via `npm test` → tsx --test (this file is listed in package.json).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../error.js';
import {
  BRACKET_SLOT_KEYS,
  GROUP_LETTERS,
  vBracketPicks,
  vGroupPicks,
  vThirdPicks,
} from './bracketPicks.js';

/** Assert fn throws the contract VALIDATION error. */
function throwsValidation(fn: () => unknown): void {
  assert.throws(fn, (err: unknown) => err instanceof AppError && err.code === 'VALIDATION');
}

describe('constants — the chart skeleton itself', () => {
  it('knows exactly 12 group letters, A through L', () => {
    assert.equal(GROUP_LETTERS.length, 12);
    assert.equal(GROUP_LETTERS[0], 'A');
    assert.equal(GROUP_LETTERS[11], 'L');
  });

  it('knows 31 knockout slots: 16 + 8 + 4 + 2 + 1 (no third-place M103)', () => {
    assert.equal(BRACKET_SLOT_KEYS.length, 31);
    assert.ok(!BRACKET_SLOT_KEYS.includes('M103' as never));
    assert.ok(BRACKET_SLOT_KEYS.includes('M104' as never));
  });
});

describe('vGroupPicks — predicted finishing orders', () => {
  it('accepts a full 4-team order and returns it intact', () => {
    const out = vGroupPicks({ A: ['Mexico', 'South Africa', 'South Korea', 'Czechia'] });
    assert.deepEqual(out, { A: ['Mexico', 'South Africa', 'South Korea', 'Czechia'] });
  });

  it('accepts a PARTIAL order (a half-finished prophecy must save)', () => {
    assert.deepEqual(vGroupPicks({ B: ['Canada'] }), { B: ['Canada'] });
  });

  it('accepts an empty document', () => {
    assert.deepEqual(vGroupPicks({}), {});
  });

  it('trims team names', () => {
    assert.deepEqual(vGroupPicks({ C: ['  Brazil  '] }), { C: ['Brazil'] });
  });

  it('rejects a key that is not a group letter', () => {
    throwsValidation(() => vGroupPicks({ M: ['Brazil'] }));
    throwsValidation(() => vGroupPicks({ a: ['Brazil'] })); // lowercase ≠ letter
  });

  it('rejects a non-array group value', () => {
    throwsValidation(() => vGroupPicks({ A: 'Mexico' }));
  });

  it('rejects more than 4 teams in one group', () => {
    throwsValidation(() => vGroupPicks({ A: ['1', '2', '3', '4', '5'] }));
  });

  it('rejects a repeated team within a group', () => {
    throwsValidation(() => vGroupPicks({ A: ['Mexico', 'Mexico'] }));
  });

  it('rejects blank and over-long team names', () => {
    throwsValidation(() => vGroupPicks({ A: ['   '] }));
    throwsValidation(() => vGroupPicks({ A: ['x'.repeat(61)] }));
  });

  it('rejects non-object documents (null / array / scalar)', () => {
    throwsValidation(() => vGroupPicks(null));
    throwsValidation(() => vGroupPicks(['A']));
    throwsValidation(() => vGroupPicks('A'));
    throwsValidation(() => vGroupPicks(undefined));
  });
});

describe('vThirdPicks — best-third berths', () => {
  it('accepts up to 8 distinct letters', () => {
    const eight = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    assert.deepEqual(vThirdPicks(eight), eight);
  });

  it('accepts an empty list', () => {
    assert.deepEqual(vThirdPicks([]), []);
  });

  it('rejects a 9th berth (only 8 exist)', () => {
    throwsValidation(() => vThirdPicks(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']));
  });

  it('rejects duplicate letters', () => {
    throwsValidation(() => vThirdPicks(['A', 'A']));
  });

  it('rejects non-letters', () => {
    throwsValidation(() => vThirdPicks(['Z']));
    throwsValidation(() => vThirdPicks([3]));
  });

  it('rejects non-array documents', () => {
    throwsValidation(() => vThirdPicks({ A: true }));
    throwsValidation(() => vThirdPicks(undefined));
  });
});

describe('vBracketPicks — knockout winners', () => {
  it('accepts picks across every round, trimming names', () => {
    const out = vBracketPicks({ M73: ' Mexico ', M89: 'Mexico', M97: 'Mexico', M101: 'Mexico', M104: 'Mexico' });
    assert.deepEqual(out, { M73: 'Mexico', M89: 'Mexico', M97: 'Mexico', M101: 'Mexico', M104: 'Mexico' });
  });

  it('accepts an empty document', () => {
    assert.deepEqual(vBracketPicks({}), {});
  });

  it('rejects the third-place match M103 (not part of the predictor)', () => {
    throwsValidation(() => vBracketPicks({ M103: 'Mexico' }));
  });

  it('rejects unknown slot keys', () => {
    throwsValidation(() => vBracketPicks({ M1: 'Mexico' }));
    throwsValidation(() => vBracketPicks({ 'R32-1': 'Mexico' }));
  });

  it('rejects non-string and blank winners', () => {
    throwsValidation(() => vBracketPicks({ M73: 7 }));
    throwsValidation(() => vBracketPicks({ M73: '  ' }));
  });

  it('rejects non-object documents', () => {
    throwsValidation(() => vBracketPicks([]));
    throwsValidation(() => vBracketPicks(undefined));
  });
});
