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
  { value: 'jetsweep', label: 'Jet Sweep', desc: 'Fast motion sweeping across near the line — often a decoy to pull the defense before a play-action pass.' },
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
  jetsweep: 0.06,
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
  jetsweep: { dx: -0.55, dy: -0.03 },
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

// The field workspace represents ~40 yards of depth. Shared by every
// yards<->normalized-coordinate conversion so the two directions can
// never drift out of sync with each other.
const YARDS_PER_NORM_UNIT = 40;

/** Approximate yards for a small "~N yards" label — display only. */
export function approxYardsFromDelta(start, end) {
  return Math.round(Math.abs(start.y - end.y) * YARDS_PER_NORM_UNIT);
}

export function directionFromDelta(start, end) {
  const dx = end.x - start.x;
  if (Math.abs(dx) < 0.03) return 'straight';
  return dx > 0 ? 'right' : 'left';
}

// ---------- Explicit depth + direction (coach-facing, in yards/L-R) ----------
//
// A coach thinks in terms like "5 yard out, breaking left" — not "drag a
// dot." These let that be set directly, while the gold-dot drag handle
// stays available as a freeform fine-tune on top. Both write to the exact
// same route.points/endPoint the drag handle already produces, so nothing
// downstream (rendering, animation, saved-play shape) needs to know which
// method set them.

export const DEPTH_OPTIONS_YARDS = [3, 5, 7, 10, 12, 15, 18, 20];

// How far sideways (normalized) the route travels once it breaks, for a
// direction chip tap. 'go' and 'custom' are excluded from direction
// entirely (a go route has no break; custom is hand-drawn).
const LATERAL_MAGNITUDE = {
  go: 0,
  slant: 0.18,
  out: 0.22,
  in: 0.22,
  post: 0.14,
  corner: 0.18,
  drag: 0.4,
  jetsweep: 0.55,
  curl: 0.14,
  hitch: 0.14,
  comeback: 0.16,
  screen: 0.1,
};

export function hasDirectionChoice(routeType) {
  return routeType !== 'go' && routeType !== 'custom';
}

/**
 * Builds an end point from an explicit depth (yards, measured to where the
 * route BREAKS — matching how a coach actually calls a route, e.g. "5 yard
 * out") and an explicit direction. Feeding this end point into
 * computeRoutePoints() reproduces that exact break depth regardless of the
 * route type's break fraction, by solving the break-fraction formula
 * backward.
 */
// Types where "depth" naturally means the END point's depth, not a break
// point solved backward through BREAK_FRACTION: go and hitch have no real
// break (bf~1) to solve for; curl/comeback overshoot-then-settle already
// measure from the end (settle) point; drag and screen break so close to
// the line (bf 0.12 / 0.05) that dividing depth by that tiny fraction
// would demand an end point far off the field — for these, "N yard drag"
// means the crossing itself sits at N yards, not a break-then-continue.
function usesEndPointForDepth(routeType, bf) {
  return routeType === 'go' || routeType === 'drag' || routeType === 'screen' || routeType === 'jetsweep' || OVERSHOOT_TYPES.has(routeType) || bf >= 0.999;
}

export function endpointFromDepthAndDirection(routeType, start, depthYards, direction) {
  const normDepth = depthYards / YARDS_PER_NORM_UNIT;
  const bf = BREAK_FRACTION[routeType] ?? 0.5;
  const magnitude = LATERAL_MAGNITUDE[routeType] ?? 0;
  const sign = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;

  const endY = usesEndPointForDepth(routeType, bf) ? start.y - normDepth : start.y - normDepth / bf;
  const endX = routeType === 'go' ? start.x : start.x + sign * magnitude;
  return { x: clamp01(endX), y: clamp01(endY) };
}

/**
 * The inverse read: given a route's current points, what depth (yards) is
 * it actually breaking at right now? Used to highlight the matching Depth
 * chip and to show an accurate "About N yards" hint — works the same
 * whether the points came from a chip tap or a freeform drag.
 */
export function currentDepthYards(routeType, start, points) {
  if (!points || points.length < 2) return null;
  const bf = BREAK_FRACTION[routeType] ?? 0.5;
  const useEndPoint = usesEndPointForDepth(routeType, bf) || points.length < 3;
  const depthPoint = useEndPoint ? points[points.length - 1] : points[1];
  return approxYardsFromDelta(start, depthPoint);
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
