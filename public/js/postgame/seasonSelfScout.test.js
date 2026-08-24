import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSeasonRollup, derivePlayTrend, derivePlayerTargetTrend } from './seasonSelfScout.js';

function snap(overrides) {
  return { id: `s-${Math.random().toString(36).slice(2, 8)}`, playId: 'p1', resultType: 'run', yards: 0, touchdown: false, voided: false, ...overrides };
}

test('deriveSeasonRollup combines every game\'s real snaps and reuses the exact same functions a single game uses', () => {
  const games = [
    { gameId: 'g1', snaps: [snap({ resultType: 'run', yards: 4 })] },
    { gameId: 'g2', snaps: [snap({ resultType: 'run', yards: 6 })] },
  ];
  const rollup = deriveSeasonRollup(games);
  assert.equal(rollup.gamesIncluded, 2);
  assert.equal(rollup.totalSnaps, 2);
  assert.equal(rollup.playPerformance.p1.timesCalled, 2);
  assert.equal(rollup.playPerformance.p1.totalYards, 10);
});

test('deriveSeasonRollup with zero ended games returns a real, non-crashing empty rollup', () => {
  const rollup = deriveSeasonRollup([]);
  assert.equal(rollup.gamesIncluded, 0);
  assert.equal(rollup.totalSnaps, 0);
  assert.deepEqual(rollup.playPerformance, {});
});

test('derivePlayTrend returns one point per game where the play was actually called, in order', () => {
  const games = [
    { gameId: 'g1', label: 'Week 1', snaps: [snap({ playId: 'green-grass', yards: 6 }), snap({ playId: 'green-grass', yards: 8 })] },
    { gameId: 'g2', label: 'Week 2', snaps: [snap({ playId: 'green-grass', yards: 10 })] },
  ];
  const trend = derivePlayTrend(games, 'green-grass');
  assert.equal(trend.points.length, 2);
  assert.equal(trend.points[0].averageGain, 7);
  assert.equal(trend.points[1].averageGain, 10);
  assert.equal(trend.sufficientData, true);
});

test('derivePlayTrend skips a game where the play was never called, rather than showing a fabricated zero', () => {
  const games = [
    { gameId: 'g1', snaps: [snap({ playId: 'green-grass', yards: 5 })] },
    { gameId: 'g2', snaps: [snap({ playId: 'other-play', yards: 5 })] }, // green-grass never called this game
  ];
  const trend = derivePlayTrend(games, 'green-grass');
  assert.equal(trend.points.length, 1);
});

test('derivePlayTrend marks sufficientData false with fewer than 2 real data points, so the UI knows not to claim a trend', () => {
  const games = [{ gameId: 'g1', snaps: [snap({ playId: 'green-grass', yards: 5 })] }];
  const trend = derivePlayTrend(games, 'green-grass');
  assert.equal(trend.sufficientData, false);
});

test('derivePlayerTargetTrend tracks a player\'s real targets/catches per game, skipping games with none', () => {
  const games = [
    { gameId: 'g1', snaps: [snap({ resultType: 'complete', targetId: 'jacob', yards: 5 })] },
    { gameId: 'g2', snaps: [snap({ resultType: 'incomplete', targetId: 'other' })] }, // jacob not targeted this game
    { gameId: 'g3', snaps: [snap({ resultType: 'complete', targetId: 'jacob', yards: 5 }), snap({ resultType: 'incomplete', targetId: 'jacob' })] },
  ];
  const trend = derivePlayerTargetTrend(games, 'jacob');
  assert.equal(trend.points.length, 2);
  assert.equal(trend.points[0].targets, 1);
  assert.equal(trend.points[1].targets, 2);
});
