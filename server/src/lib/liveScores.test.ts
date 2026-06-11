/**
 * liveScores.test.ts — node:test suite for the live-feed classifier helpers.
 *
 * The DB-touching poller itself needs Postgres and is not unit-tested here;
 * these cover the PURE decisions: how a football-data status maps to live /
 * final / ignore, and the full-time score extraction guard.
 *
 * Run via `npm test`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFeedStatus, scoreOf } from './liveScores.js';

describe('classifyFeedStatus', () => {
  it('maps in-play statuses to live', () => {
    assert.equal(classifyFeedStatus('IN_PLAY'), 'live');
    assert.equal(classifyFeedStatus('PAUSED'), 'live');
  });

  it('maps finished statuses to final', () => {
    assert.equal(classifyFeedStatus('FINISHED'), 'final');
    assert.equal(classifyFeedStatus('AWARDED'), 'final');
  });

  it('leaves every other status pending (never settles or marks live)', () => {
    for (const s of ['SCHEDULED', 'TIMED', 'POSTPONED', 'SUSPENDED', 'CANCELLED', '', 'whatever']) {
      assert.equal(classifyFeedStatus(s), 'pending', s);
    }
  });
});

describe('scoreOf', () => {
  it('reads a present full-time score, including 0–0', () => {
    assert.deepEqual(
      scoreOf({ id: 1, status: 'FINISHED', score: { fullTime: { home: 2, away: 1 } } }),
      { home: 2, away: 1 },
    );
    assert.deepEqual(
      scoreOf({ id: 1, status: 'IN_PLAY', score: { fullTime: { home: 0, away: 0 } } }),
      { home: 0, away: 0 },
    );
  });

  it('returns null when the score is absent or not yet numeric', () => {
    assert.equal(scoreOf({ id: 1, status: 'TIMED' }), null);
    assert.equal(scoreOf({ id: 1, status: 'IN_PLAY', score: {} }), null);
    assert.equal(
      scoreOf({ id: 1, status: 'IN_PLAY', score: { fullTime: { home: null, away: null } } }),
      null,
    );
  });
});
