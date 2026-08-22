import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateAlongPath, buildPlaySchedule, computeFrame, PRESNAP_DURATION_S, SNAP_BEAT_DURATION_S, POSTSNAP_BASE_DURATION_S } from './animation.js';

test('interpolateAlongPath returns the start point at t=0', () => {
  const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  assert.deepEqual(interpolateAlongPath(points, 0), { x: 0, y: 0 });
});

test('interpolateAlongPath returns the end point at t=1', () => {
  const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  assert.deepEqual(interpolateAlongPath(points, 1), { x: 1, y: 1 });
});

test('interpolateAlongPath is proportional to distance across unequal segments', () => {
  // First segment is 3x longer than the second — t=0.5 should still be
  // roughly halfway by DISTANCE, not halfway by point index.
  const points = [{ x: 0, y: 0 }, { x: 0.75, y: 0 }, { x: 1, y: 0 }];
  const mid = interpolateAlongPath(points, 0.5);
  assert.ok(Math.abs(mid.x - 0.5) < 0.001, `expected x near 0.5, got ${mid.x}`);
});

test('interpolateAlongPath handles a single-point path without crashing', () => {
  assert.deepEqual(interpolateAlongPath([{ x: 5, y: 5 }], 0.5), { x: 5, y: 5 });
});

test('buildPlaySchedule with no presnap routes skips the presnap phase entirely', () => {
  const design = {
    routes: {
      WR1: { points: [{ x: 0, y: 0 }, { x: 0, y: -1 }], timing: { phase: 'postsnap', startDelaySeconds: 0 } },
    },
  };
  const schedule = buildPlaySchedule(design);
  assert.equal(schedule.hasPresnap, false);
  assert.equal(schedule.presnapEnd, 0);
  assert.equal(schedule.snapStart, 0);
});

test('buildPlaySchedule extends total duration for the largest post-snap delay', () => {
  const design = {
    routes: {
      WR1: { points: [{ x: 0, y: 0 }, { x: 0, y: -1 }], timing: { phase: 'postsnap', startDelaySeconds: 0 } },
      WR3: { points: [{ x: 0, y: 0 }, { x: 0, y: -1 }], timing: { phase: 'postsnap', startDelaySeconds: 1.5 } },
    },
  };
  const schedule = buildPlaySchedule(design);
  const expectedTotal = schedule.postsnapPhaseStart + 1.5 + POSTSNAP_BASE_DURATION_S;
  assert.equal(schedule.totalDuration, expectedTotal);
});

test('buildPlaySchedule treats a route with no timing field as postsnap + 0 delay (backward compatibility)', () => {
  const design = {
    routes: {
      WR1: { points: [{ x: 0, y: 0 }, { x: 0, y: -1 }] }, // no `timing` at all — a pre-existing saved play
    },
  };
  const schedule = buildPlaySchedule(design);
  assert.equal(schedule.postsnapSlots.length, 1);
  assert.equal(schedule.postsnapSlots[0].delay, 0);
  assert.equal(schedule.presnapSlots.length, 0);
});

test('buildPlaySchedule ignores a route with no points (e.g. only a job was set, no path drawn)', () => {
  const design = {
    routes: {
      Center: { points: null, timing: { phase: 'postsnap', startDelaySeconds: 0 } },
    },
  };
  const schedule = buildPlaySchedule(design);
  assert.equal(schedule.presnapSlots.length, 0);
  assert.equal(schedule.postsnapSlots.length, 0);
});

test('computeFrame reports the presnap phase before the snap, when presnap routes exist', () => {
  const design = {
    routes: {
      WR2: { points: [{ x: 0.8, y: 0.72 }, { x: 0.2, y: 0.72 }], timing: { phase: 'presnap', startDelaySeconds: 0 } },
    },
  };
  const schedule = buildPlaySchedule(design);
  const frame = computeFrame(design, schedule, 0.1);
  assert.equal(frame.phaseLabel, 'presnap');
  assert.ok(frame.positions.WR2, 'WR2 should have an interpolated position during presnap');
});

test('computeFrame reports the snap phase during the beat, and postsnap after it', () => {
  const design = {
    routes: {
      WR1: { points: [{ x: 0, y: 0.72 }, { x: 0, y: 0.2 }], timing: { phase: 'postsnap', startDelaySeconds: 0 } },
    },
  };
  const schedule = buildPlaySchedule(design); // no presnap routes -> snap starts at t=0
  const duringSnap = computeFrame(design, schedule, schedule.snapStart + SNAP_BEAT_DURATION_S / 2);
  assert.equal(duringSnap.phaseLabel, 'snap');
  const afterSnap = computeFrame(design, schedule, schedule.postsnapPhaseStart + 0.1);
  assert.equal(afterSnap.phaseLabel, 'postsnap');
});

test('computeFrame respects a postsnap route\'s individual start delay — it should not move before its own start time', () => {
  const design = {
    routes: {
      WR3: { points: [{ x: 0.5, y: 0.72 }, { x: 0.7, y: 0.5 }], timing: { phase: 'postsnap', startDelaySeconds: 1 } },
    },
  };
  const schedule = buildPlaySchedule(design);
  const beforeItsDelay = computeFrame(design, schedule, schedule.postsnapPhaseStart + 0.1);
  assert.deepEqual(beforeItsDelay.positions.WR3, { x: 0.5, y: 0.72 }, 'should still be at the start point, its delay has not elapsed yet');
});

test('computeFrame marks the schedule done once total duration has elapsed', () => {
  const design = {
    routes: {
      WR1: { points: [{ x: 0, y: 0.72 }, { x: 0, y: 0.2 }], timing: { phase: 'postsnap', startDelaySeconds: 0 } },
    },
  };
  const schedule = buildPlaySchedule(design);
  const frame = computeFrame(design, schedule, schedule.totalDuration + 1);
  assert.equal(frame.phaseLabel, 'done');
});
