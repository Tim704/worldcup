/**
 * scoring.test.ts — node:test suite for the pure 5/2/0 function (Contract §4).
 *
 * Coverage map:
 *  - tier 1 (exact, 5 points): wins, draws, 0–0, high scores;
 *  - tier 2 (outcome, 2 points): home-win sign, draw sign, away-win sign;
 *  - tier 3 (0 points): inverted result, draw vs decided, decided vs draw;
 *  - tier exclusivity: an exact hit is 5, never anything else;
 *  - illegal-input guards: negative, fractional, NaN, Infinity, unsafe ints.
 *
 * Run via `npm test` → `tsx --test src/lib/scoring.test.ts src/lib/wagers.test.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scorePrediction } from './scoring.js';

describe('scorePrediction — tier 1: exact score → 5', () => {
  it('awards 5 for an exact home-win scoreline', () => {
    assert.equal(scorePrediction(2, 1, 2, 1), 5);
  });

  it('awards 5 for an exact away-win scoreline', () => {
    assert.equal(scorePrediction(0, 3, 0, 3), 5);
  });

  it('awards 5 for an exact non-zero draw', () => {
    assert.equal(scorePrediction(2, 2, 2, 2), 5);
  });

  it('awards 5 for an exact 0–0', () => {
    assert.equal(scorePrediction(0, 0, 0, 0), 5);
  });

  it('awards 5 for an exact high-scoring result', () => {
    assert.equal(scorePrediction(7, 1, 7, 1), 5);
  });

  it('is exclusive: an exact hit is exactly 5, never 2 or 7', () => {
    const points = scorePrediction(3, 1, 3, 1);
    assert.equal(points, 5);
    assert.notEqual(points, 2);
  });
});

describe('scorePrediction — tier 2: correct outcome via sgn → 2', () => {
  it('awards 2 when home win predicted and home won (sgn > 0 both sides)', () => {
    assert.equal(scorePrediction(2, 0, 3, 1), 2);
  });

  it('awards 2 when home win predicted by a different margin', () => {
    assert.equal(scorePrediction(1, 0, 4, 0), 2);
  });

  it('awards 2 when a draw predicted and the match drew (sgn = 0 both sides)', () => {
    assert.equal(scorePrediction(1, 1, 2, 2), 2);
  });

  it('awards 2 when 0–0 predicted and the match drew 3–3', () => {
    assert.equal(scorePrediction(0, 0, 3, 3), 2);
  });

  it('awards 2 when away win predicted and away won (sgn < 0 both sides)', () => {
    assert.equal(scorePrediction(0, 2, 1, 3), 2);
  });

  it('awards 2 when away win predicted by a different margin', () => {
    assert.equal(scorePrediction(1, 2, 0, 5), 2);
  });
});

describe('scorePrediction — tier 3: everything else → 0', () => {
  it('awards 0 for the inverted result (home predicted, away won)', () => {
    assert.equal(scorePrediction(2, 1, 1, 2), 0);
  });

  it('awards 0 for the inverted result (away predicted, home won)', () => {
    assert.equal(scorePrediction(0, 1, 1, 0), 0);
  });

  it('awards 0 when a draw was predicted but home won', () => {
    assert.equal(scorePrediction(1, 1, 2, 1), 0);
  });

  it('awards 0 when a draw was predicted but away won', () => {
    assert.equal(scorePrediction(2, 2, 0, 1), 0);
  });

  it('awards 0 when a home win was predicted but the match drew', () => {
    assert.equal(scorePrediction(3, 0, 0, 0), 0);
  });

  it('awards 0 when an away win was predicted but the match drew', () => {
    assert.equal(scorePrediction(0, 3, 2, 2), 0);
  });
});

describe('scorePrediction — illegal-input guards', () => {
  it('throws RangeError on a negative predicted goal count', () => {
    assert.throws(() => scorePrediction(-1, 0, 1, 0), RangeError);
  });

  it('throws RangeError on a negative actual goal count', () => {
    assert.throws(() => scorePrediction(1, 0, 1, -2), RangeError);
  });

  it('throws RangeError on a fractional goal count', () => {
    assert.throws(() => scorePrediction(1.5, 0, 1, 0), RangeError);
    assert.throws(() => scorePrediction(1, 0, 0.5, 0), RangeError);
  });

  it('throws RangeError on NaN', () => {
    assert.throws(() => scorePrediction(Number.NaN, 0, 1, 0), RangeError);
  });

  it('throws RangeError on Infinity', () => {
    assert.throws(() => scorePrediction(1, 0, Number.POSITIVE_INFINITY, 0), RangeError);
  });

  it('throws RangeError on an unsafe integer', () => {
    assert.throws(() => scorePrediction(Number.MAX_SAFE_INTEGER + 1, 0, 1, 0), RangeError);
  });
});
