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
  { value: 'go', label: 'Go' },
  { value: 'slant', label: 'Slant' },
  { value: 'out', label: 'Out' },
  { value: 'in', label: 'In' },
  { value: 'post', label: 'Post' },
  { value: 'corner', label: 'Corner' },
  { value: 'drag', label: 'Drag' },
  { value: 'curl', label: 'Curl' },
  { value: 'screen', label: 'Screen' },
  { value: 'custom', label: 'Custom' },
];

const BREAK_FRACTION = {
  go: 1.0,
  slant: 0.35,
  out: 0.65,
  in: 0.65,
  post: 0.55,
  corner: 0.55,
  drag: 0.12,
  curl: 0.65,
  screen: 0.05,
};

const DEFAULT_OFFSET = {
  go: { dx: 0, dy: -0.45 },
  slant: { dx: 0.18, dy: -0.2 },
  out: { dx: 0.22, dy: -0.14 },
  in: { dx: -0.22, dy: -0.2 },
  post: { dx: -0.14, dy: -0.4 },
  corner: { dx: 0.18, dy: -0.38 },
  drag: { dx: -0.4, dy: -0.05 },
  curl: { dx: 0, dy: -0.16 },
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

  if (routeType === 'curl') {
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

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
