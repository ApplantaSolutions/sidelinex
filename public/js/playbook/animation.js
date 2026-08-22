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

// Fixed, simple V1 timing constants — not per-route speed, not
// user-configurable beyond startDelaySeconds. "Simplest sensible model,"
// per the roadmap decision, not a real physics/speed simulation.
export const PRESNAP_DURATION_S = 1.5;
export const SNAP_BEAT_DURATION_S = 0.6;
export const POSTSNAP_BASE_DURATION_S = 2.0;

/**
 * Builds the full animation schedule for a design: which routes run in
 * which phase, when each starts/ends (in seconds from t=0), and the
 * total sequence duration. Pure function — given the same design, always
 * returns the same schedule.
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
      postsnapSlots.push({ slot, delay: timing.startDelaySeconds });
    }
  });

  const hasPresnap = presnapSlots.length > 0;
  const presnapStart = 0;
  const presnapEnd = hasPresnap ? PRESNAP_DURATION_S : 0;
  const snapStart = presnapEnd;
  const snapEnd = snapStart + SNAP_BEAT_DURATION_S;
  const postsnapPhaseStart = snapEnd;

  const maxDelay = postsnapSlots.reduce((m, r) => Math.max(m, r.delay || 0), 0);
  const totalDuration = postsnapPhaseStart + maxDelay + POSTSNAP_BASE_DURATION_S;

  return {
    presnapSlots,
    postsnapSlots, // [{slot, delay}]
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

  schedule.postsnapSlots.forEach(({ slot, delay }) => {
    const route = design.routes[slot];
    const routeStart = schedule.postsnapPhaseStart + (delay || 0);
    const local = elapsedS - routeStart;
    const t = clamp01(local / POSTSNAP_BASE_DURATION_S);
    positions[slot] = interpolateAlongPath(route.points, t);
  });

  return { phaseLabel, positions };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
