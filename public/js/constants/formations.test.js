import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATIONS, getFormation } from './formations.js';

test('every formation has a unique key and label', () => {
  const keys = FORMATIONS.map((f) => f.key);
  const labels = FORMATIONS.map((f) => f.label);
  assert.equal(new Set(keys).size, keys.length, 'duplicate formation key');
  assert.equal(new Set(labels).size, labels.length, 'duplicate formation label');
});

test('every formation places exactly 5 players (this team\'s 5v5 ruleset)', () => {
  for (const f of FORMATIONS) {
    assert.equal(Object.keys(f.positions).length, 5, `${f.key} should place 5 players`);
  }
});

test('every formation includes a QB (every formation needs a passer)', () => {
  for (const f of FORMATIONS) {
    assert.ok(f.positions.QB, `${f.key} is missing a QB`);
  }
});

test('every formation keeps the Center at or in front of the QB, never behind them', () => {
  // The Center snaps the ball TO the QB — the Designer enforces this as a
  // hard rule on every drag, so no preset may violate it either. Lower y
  // = further from the offense's own backfield = "in front of."
  for (const f of FORMATIONS) {
    assert.ok(
      f.positions.C.y <= f.positions.QB.y,
      `${f.key}: Center (y=${f.positions.C.y}) must not be positioned behind the QB (y=${f.positions.QB.y})`
    );
  }
});

test('every position is within the field bounds, with margin for the marker radius', () => {
  for (const f of FORMATIONS) {
    for (const [slot, pos] of Object.entries(f.positions)) {
      assert.ok(pos.x >= 0.05 && pos.x <= 0.95, `${f.key}.${slot}.x=${pos.x} out of safe bounds`);
      assert.ok(pos.y >= 0.05 && pos.y <= 0.95, `${f.key}.${slot}.y=${pos.y} out of safe bounds`);
    }
  }
});

test('no two players in the same formation occupy (near) the same spot', () => {
  const MIN_SEPARATION = 0.05; // markers have real visual radius; this catches an accidental exact/near overlap
  for (const f of FORMATIONS) {
    const entries = Object.entries(f.positions);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [slotA, a] = entries[i];
        const [slotB, b] = entries[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(dist >= MIN_SEPARATION, `${f.key}: ${slotA} and ${slotB} are nearly overlapping (dist=${dist.toFixed(3)})`);
      }
    }
  }
});

test('Trips Right and Trips Left are true horizontal mirrors of each other (x reflected around midfield, y identical)', () => {
  const right = getFormation('trips-right');
  const left = getFormation('trips-left');
  for (const slot of ['C', 'QB', 'WR1', 'WR2', 'WR3']) {
    assert.ok(Math.abs((1 - right.positions[slot].x) - left.positions[slot].x) < 0.001, `${slot} x not mirrored`);
    assert.equal(right.positions[slot].y, left.positions[slot].y, `${slot} y should match between mirrored formations`);
  }
});

test('Trips Stack Right and Trips Stack Left are true horizontal mirrors of each other', () => {
  const right = getFormation('trips-stack-right');
  const left = getFormation('trips-stack-left');
  for (const slot of ['C', 'QB', 'WR1', 'WR2', 'WR3']) {
    assert.ok(Math.abs((1 - right.positions[slot].x) - left.positions[slot].x) < 0.001, `${slot} x not mirrored`);
    assert.equal(right.positions[slot].y, left.positions[slot].y, `${slot} y should match between mirrored formations`);
  }
});

test('Twins Right and Twins Left are true horizontal mirrors of each other', () => {
  const right = getFormation('twins-right');
  const left = getFormation('twins-left');
  for (const slot of ['C', 'QB', 'WR1', 'WR2', 'WR3']) {
    assert.ok(Math.abs((1 - right.positions[slot].x) - left.positions[slot].x) < 0.001, `${slot} x not mirrored`);
    assert.equal(right.positions[slot].y, left.positions[slot].y, `${slot} y should match between mirrored formations`);
  }
});

test('getFormation returns null for an unknown key instead of throwing', () => {
  assert.equal(getFormation('nonexistent'), null);
});

test('getFormation returns the exact formation object for a known key', () => {
  assert.equal(getFormation('shotgun').label, 'Shotgun');
});
