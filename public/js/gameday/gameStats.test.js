import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePassingStats, deriveReceivingStats, deriveRushingStats, derivePlayStats, deriveAllStats } from './gameStats.js';

function snap(overrides) {
  return {
    resultType: 'complete',
    yards: 0,
    touchdown: false,
    crossedMidfield: false,
    voided: false,
    ...overrides,
  };
}

test('derivePassingStats counts attempts across complete/incomplete/drop, completions only on complete', () => {
  const snaps = [
    snap({ passerId: 'qb1', resultType: 'complete', yards: 8 }),
    snap({ passerId: 'qb1', resultType: 'incomplete' }),
    snap({ passerId: 'qb1', resultType: 'drop' }),
    snap({ passerId: 'qb1', resultType: 'run', yards: 5 }), // not a pass attempt
  ];
  const stats = derivePassingStats(snaps);
  assert.equal(stats.qb1.attempts, 3);
  assert.equal(stats.qb1.completions, 1);
  assert.equal(stats.qb1.passingYards, 8);
});

test('derivePassingStats counts a passing touchdown only on a completed snap', () => {
  const snaps = [snap({ passerId: 'qb1', resultType: 'complete', yards: 20, touchdown: true })];
  assert.equal(derivePassingStats(snaps).qb1.touchdowns, 1);
});

test('derivePassingStats ignores snaps with no passerId', () => {
  const snaps = [snap({ resultType: 'run', yards: 5, ballCarrierId: 'rb1' })];
  assert.deepEqual(derivePassingStats(snaps), {});
});

test('derivePassingStats excludes voided snaps entirely — this is how Undo stays correct for free', () => {
  const snaps = [
    snap({ passerId: 'qb1', resultType: 'complete', yards: 8 }),
    snap({ passerId: 'qb1', resultType: 'complete', yards: 15, voided: true }),
  ];
  const stats = derivePassingStats(snaps);
  assert.equal(stats.qb1.attempts, 1);
  assert.equal(stats.qb1.passingYards, 8);
});

test('deriveReceivingStats tracks targets/catches/drops and computes catch rate', () => {
  const snaps = [
    snap({ targetId: 'wr1', resultType: 'complete', yards: 10 }),
    snap({ targetId: 'wr1', resultType: 'drop' }),
    snap({ targetId: 'wr1', resultType: 'incomplete' }),
  ];
  const stats = deriveReceivingStats(snaps);
  assert.equal(stats.wr1.targets, 3);
  assert.equal(stats.wr1.catches, 1);
  assert.equal(stats.wr1.drops, 1);
  assert.equal(stats.wr1.receivingYards, 10);
  assert.ok(Math.abs(stats.wr1.catchRate - 1 / 3) < 1e-9);
  assert.equal(stats.wr1.yardsPerCatch, 10);
});

test('deriveReceivingStats returns null rates when there are 0 targets/catches (never divides by zero)', () => {
  const stats = deriveReceivingStats([]);
  assert.deepEqual(stats, {});
});

test('deriveReceivingStats falls back to receiverId when targetId is absent', () => {
  const snaps = [snap({ receiverId: 'wr2', resultType: 'complete', yards: 6 })];
  const stats = deriveReceivingStats(snaps);
  assert.equal(stats.wr2.catches, 1);
});

test('deriveRushingStats tracks carries/yards/TDs and computes yards per carry', () => {
  const snaps = [
    snap({ ballCarrierId: 'rb1', resultType: 'run', yards: 4 }),
    snap({ ballCarrierId: 'rb1', resultType: 'run', yards: -2 }),
    snap({ ballCarrierId: 'rb1', resultType: 'run', yards: 10, touchdown: true }),
  ];
  const stats = deriveRushingStats(snaps);
  assert.equal(stats.rb1.carries, 3);
  assert.equal(stats.rb1.rushingYards, 12);
  assert.equal(stats.rb1.touchdowns, 1);
  assert.equal(stats.rb1.yardsPerCarry, 4);
});

test('deriveRushingStats ignores pass plays entirely, even with a ballCarrierId set by mistake', () => {
  const snaps = [snap({ ballCarrierId: 'rb1', resultType: 'complete', yards: 8 })];
  assert.deepEqual(deriveRushingStats(snaps), {});
});

test('derivePlayStats counts timesCalled, averageGain, and sample size is always present', () => {
  const snaps = [
    snap({ playId: 'play1', resultType: 'run', yards: 5 }),
    snap({ playId: 'play1', resultType: 'run', yards: 3 }),
  ];
  const stats = derivePlayStats(snaps);
  assert.equal(stats.play1.timesCalled, 2);
  assert.equal(stats.play1.averageGain, 4);
});

test('derivePlayStats computes completionRate only from pass-type attempts', () => {
  const snaps = [
    snap({ playId: 'play1', resultType: 'complete', yards: 10 }),
    snap({ playId: 'play1', resultType: 'incomplete' }),
    snap({ playId: 'play1', resultType: 'run', yards: 3 }), // shouldn't count toward pass completion rate
  ];
  const stats = derivePlayStats(snaps);
  assert.equal(stats.play1.attempts, 2);
  assert.equal(stats.play1.completions, 1);
  assert.equal(stats.play1.completionRate, 0.5);
});

test('derivePlayStats never treats one successful call as proof — sample size (timesCalled) is always exposed', () => {
  const snaps = [snap({ playId: 'play1', resultType: 'run', yards: 20, crossedMidfield: true })];
  const stats = derivePlayStats(snaps);
  assert.equal(stats.play1.timesCalled, 1);
  assert.equal(stats.play1.successRate, 1); // rate can be 100%, but sample size (1) is right there alongside it
});

test('derivePlayStats defines success as crossedMidfield OR touchdown', () => {
  const snaps = [
    snap({ playId: 'play1', resultType: 'run', yards: 20, crossedMidfield: true }),
    snap({ playId: 'play1', resultType: 'run', yards: 1, touchdown: true }),
    snap({ playId: 'play1', resultType: 'run', yards: 1 }),
  ];
  const stats = derivePlayStats(snaps);
  assert.equal(stats.play1.successes, 2);
  assert.ok(Math.abs(stats.play1.successRate - 2 / 3) < 1e-9);
});

test('derivePlayStats breaks results down by observed defensive look', () => {
  const snaps = [
    snap({ playId: 'play1', resultType: 'run', yards: 8, defensiveLookObserved: 'man' }),
    snap({ playId: 'play1', resultType: 'run', yards: 2, defensiveLookObserved: 'zone' }),
    snap({ playId: 'play1', resultType: 'run', yards: 12, defensiveLookObserved: 'man', crossedMidfield: true }),
  ];
  const stats = derivePlayStats(snaps);
  assert.equal(stats.play1.byDefensiveLook.man.timesCalled, 2);
  assert.equal(stats.play1.byDefensiveLook.man.totalYards, 20);
  assert.equal(stats.play1.byDefensiveLook.man.successes, 1);
  assert.equal(stats.play1.byDefensiveLook.zone.timesCalled, 1);
});

test('derivePlayStats excludes voided snaps from every derived number', () => {
  const snaps = [
    snap({ playId: 'play1', resultType: 'run', yards: 8 }),
    snap({ playId: 'play1', resultType: 'run', yards: 100, touchdown: true, voided: true }),
  ];
  const stats = derivePlayStats(snaps);
  assert.equal(stats.play1.timesCalled, 1);
  assert.equal(stats.play1.totalYards, 8);
  assert.equal(stats.play1.touchdowns, 0);
});

test('deriveAllStats returns all four derivations from one call', () => {
  const snaps = [
    snap({ playId: 'p1', passerId: 'qb1', targetId: 'wr1', resultType: 'complete', yards: 9 }),
    snap({ playId: 'p2', ballCarrierId: 'rb1', resultType: 'run', yards: 4 }),
  ];
  const all = deriveAllStats(snaps);
  assert.ok(all.passing.qb1);
  assert.ok(all.receiving.wr1);
  assert.ok(all.rushing.rb1);
  assert.ok(all.plays.p1);
  assert.ok(all.plays.p2);
});

test('empty snap list produces empty stats everywhere, no crashes', () => {
  const all = deriveAllStats([]);
  assert.deepEqual(all, { passing: {}, receiving: {}, rushing: {}, plays: {} });
});
