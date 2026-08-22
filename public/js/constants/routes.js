// Route shapes for the Play Designer. Every non-custom route is defined by
// exactly two things: a START point (the player's position, fixed) and an
// END point (a single draggable handle — the "gold dot"). The path between
// them is generated from a per-type "break fraction" — how far up the
// straight stem runs before angling toward the end point. This is what
// makes single-handle adjustment possible: dragging the end point just
// re-runs the same function with a new end, and the shape stays
// recognizable as that route type at any length/angle.
//
// No curve library, no bezier math — just 2-3 point polylines, matching
// the "not overengineered" V1 instruction.

export const ROUTE_TEMPLATES = [
  { value: 'go', label: 'Go', desc: 'Run straight down the field.' },
  { value: 'slant', label: 'Slant', desc: 'Run forward, then cut across.' },
  { value: 'out', label: 'Out', desc: 'Run forward, then turn toward the sideline.' },
  { value: 'in', label: 'In', desc: 'Run forward, then cut toward the middle.' },
  { value: 'post', label: 'Post', desc: 'Run forward, then angle toward the goalpost.' },
  { value: 'corner', label: 'Corner', desc: 'Run forward, then angle toward the corner.' },
  { value: 'drag', label: 'Drag', desc: 'Run across the field, close to the line.' },
  { value: 'curl', label: 'Curl', desc: 'Run forward, then turn back toward the QB.' },
  { value: 'hitch', label: 'Hitch', desc: 'Run forward, stop, and turn to the QB.' },
  { value: 'comeback', label: 'Comeback', desc: 'Run deep, then break back.' },
  { value: 'screen', label: 'Screen', desc: 'Wait near the line, then catch a short pass.' },
  { value: 'custom', label: 'Custom', desc: 'Draw your own path.' },
];

export function routeDescription(routeType) {
  return ROUTE_TEMPLATES.find((t) => t.value === routeType)?.desc || '';
}

const BREAK_FRACTION = {
  go: 1.0,
  slant: 0.35,
  out: 0.65,
  in: 0.65,
  post: 0.55,
  corner: 0.55,
  drag: 0.12,
  curl: 0.65,
  hitch: 1.0,
  comeback: 0.65,
  screen: 0.05,
};

// curl/comeback both use the "overshoot then settle back" shape — they
// only differ in default depth/direction below. Kept as a set so
// computeRoutePoints has one place to check membership.
const OVERSHOOT_TYPES = new Set(['curl', 'comeback']);

const DEFAULT_OFFSET = {
  go: { dx: 0, dy: -0.45 },
  slant: { dx: 0.18, dy: -0.2 },
  out: { dx: 0.22, dy: -0.14 },
  in: { dx: -0.22, dy: -0.2 },
  post: { dx: -0.14, dy: -0.4 },
  corner: { dx: 0.18, dy: -0.38 },
  drag: { dx: -0.4, dy: -0.05 },
  curl: { dx: 0, dy: -0.16 },
  hitch: { dx: 0, dy: -0.1 },
  comeback: { dx: 0, dy: -0.32 },
  screen: { dx: 0.1, dy: 0.02 },
  custom: { dx: 0, dy: -0.1 },
};

/**
 * A sensible starting end point for a freshly-applied template, so the
 * coach sees a real route immediately without having to place the handle
 * themselves first. `flipped` mirrors left/right.
 */
export function defaultEndpoint(routeType, start, flipped) {
  const dir = flipped ? -1 : 1;
  const t = DEFAULT_OFFSET[routeType] || DEFAULT_OFFSET.go;
  return { x: clamp01(start.x + dir * t.dx), y: clamp01(start.y + t.dy) };
}

/**
 * Generates the route's polyline from start -> end for a given type.
 * Returns null for 'custom' — hand-drawn routes manage their own points
 * array directly and don't get regenerated from a formula.
 */
export function computeRoutePoints(routeType, start, end) {
  if (routeType === 'custom') return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const bf = BREAK_FRACTION[routeType] ?? 0.5;

  if (OVERSHOOT_TYPES.has(routeType)) {
    // Overshoot slightly upfield, then settle back — approximates a hook
    // without needing real curve math.
    const peak = { x: clamp01(start.x + dx * 0.3), y: clamp01(start.y + dy * 1.15) };
    return [{ ...start }, peak, { ...end }];
  }

  if (bf >= 0.999) return [{ ...start }, { ...end }];

  const breakPoint = { x: start.x, y: clamp01(start.y + dy * bf) };
  return [{ ...start }, breakPoint, { ...end }];
}

/** Approximate yards for a small "~N yards" label — display only. */
export function approxYardsFromDelta(start, end) {
  const yardsPerNormUnit = 40; // the field workspace represents ~40 yards of depth
  return Math.round(Math.abs(start.y - end.y) * yardsPerNormUnit);
}

export function directionFromDelta(start, end) {
  const dx = end.x - start.x;
  if (Math.abs(dx) < 0.03) return 'straight';
  return dx > 0 ? 'right' : 'left';
}

// ---------- Route timing (Play Animation, added for the roadmap) ----------

export const DELAY_OPTIONS_SECONDS = [0, 0.5, 1, 1.5, 2];

/**
 * Every route's `timing` field is optional and backward-compatible: any
 * route saved before this existed (or any route object that never sets
 * it) is read as postsnap + no delay, exactly as if it had been written
 * explicitly. No migration is required for existing saved plays — this
 * is the single place that default is defined, so it can never drift.
 */
export function getTiming(route) {
  return {
    phase: route?.timing?.phase === 'presnap' ? 'presnap' : 'postsnap',
    startDelaySeconds: typeof route?.timing?.startDelaySeconds === 'number' ? route.timing.startDelaySeconds : 0,
  };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
