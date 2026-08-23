import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTE_TEMPLATES,
  computeRoutePoints,
  directionFromDelta,
  hasDirectionChoice,
  endpointFromDepthAndDirection,
  currentDepthYards,
  DEPTH_OPTIONS_YARDS,
  defaultEndpoint,
} from './routes.js';

const start = { x: 0.8, y: 0.72 }; // a receiver lined up on the right side, on the LOS

const NON_CUSTOM_TYPES = ROUTE_TEMPLATES.map((t) => t.value).filter((v) => v !== 'custom');

// Some (low break-fraction type) x (large depth) x (start position)
// combinations are geometrically impossible to hit exactly — the break
// point would have to sit off the field. That's a real boundary, not a
// bug, so the ceiling is derived empirically from the same functions
// under test (via a deliberately-huge probe request) rather than assumed
// to always equal the requested depth.
function achievableDepth(routeType, requestedDepth) {
  const probeEnd = endpointFromDepthAndDirection(routeType, start, 1000, 'left');
  const ceiling = currentDepthYards(routeType, start, computeRoutePoints(routeType, start, probeEnd));
  return Math.min(requestedDepth, ceiling);
}

for (const routeType of NON_CUSTOM_TYPES) {
  for (const depth of [3, 10, 20]) {
    test(`${routeType} @ ${depth}yd: setting depth+direction and reading it back round-trips (up to the field's own ceiling)`, () => {
      const direction = hasDirectionChoice(routeType) ? 'left' : 'straight';
      const end = endpointFromDepthAndDirection(routeType, start, depth, direction);
      const points = computeRoutePoints(routeType, start, end);
      const readBack = currentDepthYards(routeType, start, points);
      const expected = achievableDepth(routeType, depth);
      // Rounding (approxYardsFromDelta rounds to whole yards) means this
      // can be off by 1, never more — if it drifts further the break-depth
      // math has a real bug, not just display rounding or a field-edge clamp.
      assert.ok(Math.abs(readBack - expected) <= 1, `expected ~${expected} (requested ${depth}), got ${readBack} for ${routeType}`);
    });
  }
}

test('a depth within every route type\'s realistic short-field range (7 yards) round-trips exactly for every type', () => {
  // Distinct from the ceiling-aware test above: this specifically proves
  // there is no type where the depth model is simply broken across the
  // board at an ordinary, clearly-in-bounds depth.
  for (const routeType of NON_CUSTOM_TYPES) {
    const direction = hasDirectionChoice(routeType) ? 'right' : 'straight';
    const end = endpointFromDepthAndDirection(routeType, start, 7, direction);
    const points = computeRoutePoints(routeType, start, end);
    const readBack = currentDepthYards(routeType, start, points);
    assert.ok(Math.abs(readBack - 7) <= 1, `expected ~7, got ${readBack} for ${routeType}`);
  }
});

for (const routeType of NON_CUSTOM_TYPES.filter((t) => hasDirectionChoice(t))) {
  test(`${routeType}: direction chip actually breaks that way`, () => {
    const leftEnd = endpointFromDepthAndDirection(routeType, start, 10, 'left');
    const rightEnd = endpointFromDepthAndDirection(routeType, start, 10, 'right');
    assert.equal(directionFromDelta(start, leftEnd), 'left', `${routeType} left chip should break left`);
    assert.equal(directionFromDelta(start, rightEnd), 'right', `${routeType} right chip should break right`);
  });
}

test('go has no direction choice (straight route, no meaningful left/right)', () => {
  assert.equal(hasDirectionChoice('go'), false);
});

test('custom has no direction choice (freeform, not depth/direction modeled)', () => {
  assert.equal(hasDirectionChoice('custom'), false);
});

test('a go route stays perfectly vertical regardless of requested direction sign', () => {
  const end = endpointFromDepthAndDirection('go', start, 15, 'left');
  assert.equal(end.x, start.x);
});

test('DEPTH_OPTIONS_YARDS is a sorted, positive list (sanity on the constant itself)', () => {
  assert.ok(DEPTH_OPTIONS_YARDS.every((y) => y > 0));
  assert.deepEqual(DEPTH_OPTIONS_YARDS, [...DEPTH_OPTIONS_YARDS].sort((a, b) => a - b));
});

test('out route breaking depth is unaffected by its (smaller) lateral travel distance', () => {
  // Out has a break-fraction of 0.65 — this specifically exercises the
  // "solve backward through the break fraction" math, not just the
  // straight-line (go/hitch) shortcut path.
  const end = endpointFromDepthAndDirection('out', start, 5, 'right');
  const points = computeRoutePoints('out', start, end);
  const depth = currentDepthYards('out', start, points);
  assert.ok(Math.abs(depth - 5) <= 1, `expected ~5, got ${depth}`);
});

// ---------- default (un-configured) direction, matching fieldDesigner.js's
// pickRouteTemplate() call site: flipped = start.x <= 0.5 ----------
//
// This is the specific bug the coach hit live: an "out" route defaulted
// to breaking toward midfield instead of toward the player's own
// sideline, on BOTH sides of the field. These lock in the fix so it can't
// silently invert again.

const rightSideStart = { x: 0.85, y: 0.72 };
const leftSideStart = { x: 0.15, y: 0.72 };

test('out route: default direction breaks toward the RIGHT sideline for a right-side player', () => {
  const flipped = rightSideStart.x <= 0.5; // mirrors fieldDesigner.js's call site
  const end = defaultEndpoint('out', rightSideStart, flipped);
  assert.equal(directionFromDelta(rightSideStart, end), 'right', 'a right-side out route must break right, toward the sideline, not toward midfield');
});

test('out route: default direction breaks toward the LEFT sideline for a left-side player', () => {
  const flipped = leftSideStart.x <= 0.5;
  const end = defaultEndpoint('out', leftSideStart, flipped);
  assert.equal(directionFromDelta(leftSideStart, end), 'left', 'a left-side out route must break left, toward the sideline, not toward midfield');
});

test('in route: default direction breaks toward the MIDDLE for a right-side player (opposite of out)', () => {
  const flipped = rightSideStart.x <= 0.5;
  const end = defaultEndpoint('in', rightSideStart, flipped);
  assert.equal(directionFromDelta(rightSideStart, end), 'left', 'a right-side in route must break left, toward midfield');
});

test('in route: default direction breaks toward the MIDDLE for a left-side player (opposite of out)', () => {
  const flipped = leftSideStart.x <= 0.5;
  const end = defaultEndpoint('in', leftSideStart, flipped);
  assert.equal(directionFromDelta(leftSideStart, end), 'right', 'a left-side in route must break right, toward midfield');
});
