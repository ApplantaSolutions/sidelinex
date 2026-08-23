import test from 'node:test';
import assert from 'node:assert/strict';
import {
  interpolateAlongPath,
  pathLengthYards,
  buildPlaySchedule,
  computeFrame,
  postsnapDurationFor,
  PRESNAP_DURATION_S,
  SNAP_BEAT_DURATION_S,
  POSTSNAP_YARDS_PER_SECOND,
  POSTSNAP_MIN_DURATION_S,
  POSTSNAP_MAX_DURATION_S,
} from './animation.js';

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

test('pathLengthYards measures the actual traveled distance, not straight-line start-to-end', () => {
  // An L-shaped path: 0.1 (=4 yards) down, then 0.1 (=4 yards) across —
  // straight-line start-to-end would be shorter (diagonal), but the
  // receiver actually runs both legs.
  const points = [{ x: 0.5, y: 0.72 }, { x: 0.5, y: 0.62 }, { x: 0.6, y: 0.62 }];
  const yards = pathLengthYards(points);
  assert.ok(Math.abs(yards - 8) < 0.5, `expected ~8 yards, got ${yards}`);
});

test('pathLengthYards is 0 for a missing or single-point path', () => {
  assert.equal(pathLengthYards(null), 0);
  assert.equal(pathLengthYards([{ x: 0, y: 0 }]), 0);
});

// ---------- the exact behavior JR asked for: depth changes must visibly
// change animation speed, not just where the route ends up ----------

test('postsnapDurationFor: a 9-yard route takes longer to animate than an 8-yard route', () => {
  const eightYardPoints = [{ x: 0.5, y: 0.72 }, { x: 0.5, y: 0.72 - 8 / 40 }];
  const nineYardPoints = [{ x: 0.5, y: 0.72 }, { x: 0.5, y: 0.72 - 9 / 40 }];
  const eightDuration = postsnapDurationFor(eightYardPoints);
  const nineDuration = postsnapDurationFor(nineYardPoints);
  assert.ok(nineDuration > eightDuration, `expected 9yd (${nineDuration}) > 8yd (${eightDuration})`);
});

test('postsnapDurationFor scales at the documented yards-per-second pace, within the watchable clamp range', () => {
  const points = [{ x: 0.5, y: 0.72 }, { x: 0.5, y: 0.72 - 16 / 40 }]; // 16 yards
  const duration = postsnapDurationFor(points);
  assert.ok(Math.abs(duration - 16 / POSTSNAP_YARDS_PER_SECOND) < 0.01);
});

test('postsnapDurationFor never goes below the minimum watchable duration, even for a tiny route', () => {
  const points = [{ x: 0.5, y: 0.72 }, { x: 0.5, y: 0.715 }]; // a fraction of a yard
  assert.equal(postsnapDurationFor(points), POSTSNAP_MIN_DURATION_S);
});

test('postsnapDurationFor never exceeds the maximum duration, even for an unusually long route', () => {
  const points = [{ x: 0.5, y: 1.0 }, { x: 0.5, y: 0.0 }]; // the entire field depth
  assert.equal(postsnapDurationFor(points), POSTSNAP_MAX_DURATION_S);
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

test('buildPlaySchedule extends total duration for whichever route finishes last (delay + its own distance-based duration)', () => {
  const design = {
    routes: {
      WR1: { points: [{ x: 0, y: 0 }, { x: 0, y: -0.2 }], timing: { phase: 'postsnap', startDelaySeconds: 0 } }, // 8 yards
      WR3: { points: [{ x: 0, y: 0 }, { x: 0, y: -0.2 }], timing: { phase: 'postsnap', startDelaySeconds: 1.5 } }, // 8 yards, +1.5s delay
    },
  };
  const schedule = buildPlaySchedule(design);
  const wr3 = schedule.postsnapSlots.find((s) => s.slot === 'WR3');
  const expectedTotal = schedule.postsnapPhaseStart + 1.5 + wr3.duration;
  assert.equal(schedule.totalDuration, expectedTotal);
});

test('buildPlaySchedule gives each postsnap route its own distance-based duration, not a shared one', () => {
  const design = {
    routes: {
      SHORT: { points: [{ x: 0.5, y: 0.72 }, { x: 0.5, y: 0.72 - 3 / 40 }], timing: { phase: 'postsnap', startDelaySeconds: 0 } }, // 3yd hitch-ish
      LONG: { points: [{ x: 0.5, y: 0.72 }, { x: 0.5, y: 0.72 - 20 / 40 }], timing: { phase: 'postsnap', startDelaySeconds: 0 } }, // 20yd go
    },
  };
  const schedule = buildPlaySchedule(design);
  const short = schedule.postsnapSlots.find((s) => s.slot === 'SHORT');
  const long = schedule.postsnapSlots.find((s) => s.slot === 'LONG');
  assert.ok(long.duration > short.duration, 'a 20-yard route must take longer than a 3-yard route');
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

test('computeFrame: a 9-yard route is still visibly mid-run at a moment a shorter 3-yard route has already finished', () => {
  const design = {
    routes: {
      SHORT: { points: [{ x: 0.3, y: 0.72 }, { x: 0.3, y: 0.72 - 3 / 40 }], timing: { phase: 'postsnap', startDelaySeconds: 0 } },
      NINE: { points: [{ x: 0.7, y: 0.72 }, { x: 0.7, y: 0.72 - 9 / 40 }], timing: { phase: 'postsnap', startDelaySeconds: 0 } },
    },
  };
  const schedule = buildPlaySchedule(design);
  const shortRoute = schedule.postsnapSlots.find((s) => s.slot === 'SHORT');
  const nineRoute = schedule.postsnapSlots.find((s) => s.slot === 'NINE');
  const elapsedS = schedule.postsnapPhaseStart + shortRoute.duration + 0.05; // just after SHORT finishes
  const frame = computeFrame(design, schedule, elapsedS);
  assert.deepEqual(frame.positions.SHORT, { x: 0.3, y: 0.72 - 3 / 40 }, 'the 3-yard route should already be at its end point');
  const nineY = frame.positions.NINE.y;
  assert.ok(nineY > 0.72 - 9 / 40, 'the 9-yard route should NOT have reached its end point yet at this same moment');
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
