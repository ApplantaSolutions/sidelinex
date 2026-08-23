// Pure timing/interpolation math for Play Animation — zero DOM
// dependency, zero side effects, deliberately kept separate from
// fieldDesigner.js so it stays testable and so the animation concern is
// obviously isolated from the gesture/editing code (per the engineering
// rule: animation must never touch design.positions/design.routes, only
// read from them).

import { getTiming } from '../constants/routes.js';

/**
 * Interpolates a point along a polyline, proportional to distance
 * traveled (not just point index), so motion speed feels roughly
 * constant across the whole path rather than jumping unevenly between
 * unevenly-spaced points.
 */
export function interpolateAlongPath(points, t) {
  if (!points || points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1 || t <= 0) return { ...points[0] };
  if (t >= 1) return { ...points[points.length - 1] };

  const segmentLengths = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segmentLengths.push(d);
    total += d;
  }
  if (total === 0) return { ...points[0] };

  let target = t * total;
  for (let i = 0; i < segmentLengths.length; i++) {
    if (target <= segmentLengths[i] || i === segmentLengths.length - 1) {
      const segT = segmentLengths[i] === 0 ? 0 : Math.min(1, target / segmentLengths[i]);
      const a = points[i];
      const b = points[i + 1];
      return { x: a.x + (b.x - a.x) * segT, y: a.y + (b.y - a.y) * segT };
    }
    target -= segmentLengths[i];
  }
  return { ...points[points.length - 1] };
}

// Must match constants/routes.js's own YARDS_PER_NORM_UNIT — the field
// workspace represents ~40 yards of depth. Kept as a separate local
// constant (not imported) because routes.js doesn't export it; if that
// ever changes, pathLengthYards()'s own tests will catch the drift.
const YARDS_PER_NORM_UNIT = 40;

/** Total distance actually traveled along a route's path, in yards — the
 * stem plus the break, not just the straight-line start-to-end distance.
 * Used to make animation speed reflect real depth: a 9-yard slant should
 * visibly take longer to run than an 8-yard one, not animate at the same
 * fixed speed regardless of distance. */
export function pathLengthYards(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return total * YARDS_PER_NORM_UNIT;
}

// Fixed, simple V1 timing constants for phases that are inherently
// synchronized across every player (everyone must be set before the same
// snap moment, and the snap beat itself is a fixed visual pause) — not
// distance-proportional, unlike postsnap routes below.
export const PRESNAP_DURATION_S = 1.5;
export const SNAP_BEAT_DURATION_S = 0.6;

// A postsnap route's own duration is proportional to how far it actually
// runs, clamped to a watchable range — this is what makes an 8-yard vs a
// 9-yard slant visibly take different time, not just end up in a
// different spot. "Simplest sensible model" (a flat sprint pace, not a
// real acceleration curve), per the roadmap decision, deliberately not a
// physics simulation.
export const POSTSNAP_YARDS_PER_SECOND = 8;
export const POSTSNAP_MIN_DURATION_S = 0.5;
export const POSTSNAP_MAX_DURATION_S = 3.5;

export function postsnapDurationFor(points) {
  const raw = pathLengthYards(points) / POSTSNAP_YARDS_PER_SECOND;
  return Math.min(POSTSNAP_MAX_DURATION_S, Math.max(POSTSNAP_MIN_DURATION_S, raw));
}

/**
 * Builds the full animation schedule for a design: which routes run in
 * which phase, when each starts/ends (in seconds from t=0), and the
 * total sequence duration. Pure function — given the same design, always
 * returns the same schedule. Each postsnap route carries its own
 * distance-derived duration.
 */
export function buildPlaySchedule(design) {
  const presnapSlots = [];
  const postsnapSlots = [];

  Object.entries(design.routes || {}).forEach(([slot, route]) => {
    if (!route || !route.points || route.points.length < 2) return;
    const timing = getTiming(route);
    if (timing.phase === 'presnap') {
      presnapSlots.push(slot);
    } else {
      postsnapSlots.push({ slot, delay: timing.startDelaySeconds, duration: postsnapDurationFor(route.points) });
    }
  });

  const hasPresnap = presnapSlots.length > 0;
  const presnapStart = 0;
  const presnapEnd = hasPresnap ? PRESNAP_DURATION_S : 0;
  const snapStart = presnapEnd;
  const snapEnd = snapStart + SNAP_BEAT_DURATION_S;
  const postsnapPhaseStart = snapEnd;

  const maxFinish = postsnapSlots.reduce((m, r) => Math.max(m, (r.delay || 0) + r.duration), 0);
  const totalDuration = postsnapPhaseStart + maxFinish;

  return {
    presnapSlots,
    postsnapSlots, // [{slot, delay, duration}]
    hasPresnap,
    presnapStart,
    presnapEnd,
    snapStart,
    snapEnd,
    postsnapPhaseStart,
    totalDuration,
  };
}

/**
 * Given the schedule and the current elapsed time, returns:
 *  - phaseLabel: 'presnap' | 'snap' | 'postsnap' | 'done'
 *  - positions: { slot: {x,y} } for every animated slot's CURRENT point
 * Markers not present in `positions` should be left at their normal
 * design position (i.e. the caller only needs to move the ones returned
 * here — everyone else is standing still at that moment).
 */
export function computeFrame(design, schedule, elapsedS) {
  const positions = {};

  let phaseLabel = 'postsnap';
  if (schedule.hasPresnap && elapsedS < schedule.snapStart) phaseLabel = 'presnap';
  else if (elapsedS < schedule.postsnapPhaseStart) phaseLabel = 'snap';
  else if (elapsedS >= schedule.totalDuration) phaseLabel = 'done';

  schedule.presnapSlots.forEach((slot) => {
    const route = design.routes[slot];
    const t = schedule.hasPresnap ? clamp01(elapsedS / schedule.presnapEnd) : 1;
    positions[slot] = interpolateAlongPath(route.points, t);
  });

  schedule.postsnapSlots.forEach(({ slot, delay, duration }) => {
    const route = design.routes[slot];
    const routeStart = schedule.postsnapPhaseStart + (delay || 0);
    const local = elapsedS - routeStart;
    const t = clamp01(local / duration);
    positions[slot] = interpolateAlongPath(route.points, t);
  });

  return { phaseLabel, positions };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
