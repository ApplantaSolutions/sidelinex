import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDefensePositions, MAN_REACTION_LAG_S } from './defenseAnimation.js';

test('returns empty object when no defense mode is set', () => {
  assert.deepEqual(computeDefensePositions(null, {}, {}, 0, 2), {});
  assert.deepEqual(computeDefensePositions({ mode: null, defenders: {} }, {}, {}, 0, 2), {});
});

test('MAN: reaction lag constant is a small, real fraction of a second (sanity)', () => {
  assert.ok(MAN_REACTION_LAG_S > 0);
  assert.ok(MAN_REACTION_LAG_S < 1);
});

test('MAN: defender tracks the receiver\'s LAGGED position, not their current one', () => {
  const defense = { mode: 'man', defenders: { D1: { position: { x: 0.5, y: 0.5 }, assignment: 'WR1' } } };
  const current = { WR1: { x: 0.9, y: 0.2 } }; // receiver already broke deep
  const lagged = { WR1: { x: 0.5, y: 0.5 } }; // where they were a beat ago (still at their start)
  const result = computeDefensePositions(defense, current, lagged, 0.5, 2);
  // Should track the LAGGED (0.5, 0.5) position, not the current (0.9, 0.2) one
  assert.ok(Math.abs(result.D1.x - 0.5) < 0.06); // within leverage offset range of lagged x
  assert.ok(Math.abs(result.D1.y - 0.5) < 0.06);
  assert.ok(Math.abs(result.D1.x - 0.9) > 0.1); // clearly NOT near the current position
});

test('MAN: defender is offset to the side (leverage), never exactly stacked on the receiver', () => {
  const defense = { mode: 'man', defenders: { D1: { position: { x: 0.5, y: 0.5 }, assignment: 'WR1' } } };
  const pos = { WR1: { x: 0.8, y: 0.3 } };
  const result = computeDefensePositions(defense, pos, pos, 0.5, 2);
  // Defender's final (x,y) must not exactly equal the receiver's position
  assert.notEqual(result.D1.x, pos.WR1.x);
  const dist = Math.hypot(result.D1.x - pos.WR1.x, result.D1.y - pos.WR1.y);
  assert.ok(dist > 0.01); // meaningfully offset, not a rounding artifact
});

test('MAN: leverage side is consistent (doesn\'t flip) based on the defender\'s own starting side', () => {
  const receiverStart = { x: 0.5, y: 0.75 };
  const defenderStartLeft = { x: 0.3, y: 0.5 }; // started to the left of the receiver
  const defense = {
    mode: 'man',
    defenders: { D1: { position: defenderStartLeft, assignment: 'WR1' } },
  };
  const currentPos = { WR1: receiverStart };
  const result = computeDefensePositions(defense, currentPos, currentPos, 0, 2);
  // Defender started left of the receiver -> should stay offset to the left (lower x)
  assert.ok(result.D1.x < receiverStart.x);
});

test('MAN: falls back to base position if the assigned receiver has no current position', () => {
  const defense = { mode: 'man', defenders: { D1: { position: { x: 0.5, y: 0.5 }, assignment: 'WR9' } } };
  const result = computeDefensePositions(defense, {}, {}, 0.5, 2);
  assert.deepEqual(result.D1, { x: 0.5, y: 0.5 });
});

test('MAN: reacts even before the snap (negative elapsedSinceSnapS) — motion influence', () => {
  const defense = { mode: 'man', defenders: { D1: { position: { x: 0.5, y: 0.5 }, assignment: 'WR2' } } };
  const pos = { WR2: { x: 0.2, y: 0.6 } }; // e.g. mid-jet-sweep-motion position
  const result = computeDefensePositions(defense, pos, pos, -1.0, 2);
  assert.ok(Math.abs(result.D1.x - 0.2) < 0.06);
});

test('MAN: falls back to unlagged position if no lagged snapshot is provided', () => {
  const defense = { mode: 'man', defenders: { D1: { position: { x: 0.5, y: 0.5 }, assignment: 'WR1' } } };
  const pos = { WR1: { x: 0.8, y: 0.3 } };
  // Passing null for laggedOffensePositions should not throw and should
  // degrade to tracking the current position (still offset by leverage).
  const result = computeDefensePositions(defense, pos, null, 0.5, 2);
  assert.ok(Math.abs(result.D1.y - (0.3 + 0.045)) < 1e-9);
});

test('ZONE: drifts toward the nearest offensive player within reaction radius', () => {
  const defense = { mode: 'zone', defenders: { D1: { position: { x: 0.5, y: 0.5 } } } };
  const offense = { WR1: { x: 0.55, y: 0.5 } };
  const result = computeDefensePositions(defense, offense, offense, 0, 2);
  assert.ok(result.D1.x > 0.5);
  assert.ok(result.D1.x < 0.55);
});

test('ZONE: stays home when nothing is within reaction radius', () => {
  const defense = { mode: 'zone', defenders: { D1: { position: { x: 0.1, y: 0.1 } } } };
  const offense = { WR1: { x: 0.9, y: 0.9 } };
  const result = computeDefensePositions(defense, offense, offense, 0, 2);
  assert.deepEqual(result.D1, { x: 0.1, y: 0.1 });
});

test('ZONE: never blindly follows one receiver everywhere — drift is capped regardless of distance', () => {
  const defense = { mode: 'zone', defenders: { D1: { position: { x: 0.1, y: 0.1 } } } };
  const offense = { WR1: { x: 0.15, y: 0.1 } };
  const result = computeDefensePositions(defense, offense, offense, 0, 2);
  const drift = Math.hypot(result.D1.x - 0.1, result.D1.y - 0.1);
  assert.ok(drift <= 0.08 + 1e-9);
});

test('PRESSURE: stays at base position before the snap', () => {
  const defense = { mode: 'pressure', defenders: { D1: { position: { x: 0.5, y: 0.9 } } } };
  const offense = { QB: { x: 0.5, y: 0.75 } };
  const result = computeDefensePositions(defense, offense, offense, -0.5, 2);
  assert.deepEqual(result.D1, { x: 0.5, y: 0.9 });
});

test('PRESSURE: converges toward the QB over the arrival window', () => {
  const defense = { mode: 'pressure', defenders: { D1: { position: { x: 0.5, y: 0.9 } } } };
  const offense = { QB: { x: 0.5, y: 0.75 } };
  const halfway = computeDefensePositions(defense, offense, offense, 0.875, 2);
  assert.ok(Math.abs(halfway.D1.y - 0.825) < 0.01);
});

test('PRESSURE: reaches the QB and holds there once past the arrival window', () => {
  const defense = { mode: 'pressure', defenders: { D1: { position: { x: 0.5, y: 0.9 } } } };
  const offense = { QB: { x: 0.5, y: 0.75 } };
  const result = computeDefensePositions(defense, offense, offense, 10, 2);
  assert.equal(result.D1.y, 0.75);
});

test('CUSTOM: never moves regardless of offense positions or elapsed time', () => {
  const defense = { mode: 'custom', defenders: { D1: { position: { x: 0.3, y: 0.6 } } } };
  const offense = { WR1: { x: 0.9, y: 0.1 }, QB: { x: 0.5, y: 0.75 } };
  const result = computeDefensePositions(defense, offense, offense, 5, 2);
  assert.deepEqual(result.D1, { x: 0.3, y: 0.6 });
});

test('computes positions for multiple defenders independently', () => {
  const defense = {
    mode: 'man',
    defenders: {
      D1: { position: { x: 0.1, y: 0.1 }, assignment: 'WR1' },
      D2: { position: { x: 0.2, y: 0.2 }, assignment: 'WR2' },
    },
  };
  const offense = { WR1: { x: 0.8, y: 0.3 }, WR2: { x: 0.1, y: 0.4 } };
  const result = computeDefensePositions(defense, offense, offense, 0.5, 2);
  assert.equal(Object.keys(result).length, 2);
  assert.ok(Math.abs(result.D1.x - 0.8) < 0.06);
  assert.ok(Math.abs(result.D2.x - 0.1) < 0.06);
});
