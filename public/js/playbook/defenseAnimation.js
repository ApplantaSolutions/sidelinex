// Pure, testable defender-reaction computation for Watch Play. NOT a
// football simulation — a simple, explainable "teaching" model per mode,
// meant to visually demonstrate concepts (clearing defenders, crossing
// traffic, zone reaction, pressure arrival) without claiming to predict
// real defensive behavior. Every mode's reaction is a direct function of
// the offense's actual positions — never randomized, never a black box.
// The UI is responsible for labeling this as a modeled/teaching reaction,
// never a guarantee — see wristbandPrint.js's equivalent honesty pattern
// for print-accuracy claims.
//
// MAN mode specifically: a defender is NOT a receiver's shadow. Real
// coverage (a) plays with LEVERAGE — alongside the receiver, not stacked
// directly on top of or behind them — and (b) REACTS to a route break
// with a beat of delay, because a real defender has to see it happen,
// not anticipate it. That reaction lag is exactly what makes separation
// visible on a break — which is the entire teaching point of showing
// defense at all: "here's why the primary target is open." Every
// defender gets the same honest lag/leverage rule; a decoy route pulling
// its own defender away, or a primary's route breaking before its
// defender can fully mirror it, is what naturally produces separation —
// nothing here is special-cased to flatter one designation over another.

export const MAN_REACTION_LAG_S = 0.35;
// Leverage offset applied on top of the lagged tracking position — reads
// as "running alongside," never "standing on the receiver's back."
const MAN_LEVERAGE_DX = 0.05;
const MAN_LEVERAGE_DY = 0.045;
const ZONE_MAX_DRIFT = 0.08;
const ZONE_REACT_RADIUS = ZONE_MAX_DRIFT * 3;
const PRESSURE_ARRIVE_BY_S = 1.75;

/**
 * @param {{mode: 'man'|'zone'|'pressure'|'custom', defenders: object}} defense
 * @param {Object.<string, {x:number,y:number}>} fullOffensePositions - every offense slot's CURRENT position (this frame), moving or not
 * @param {Object.<string, {x:number,y:number}>} laggedOffensePositions - every offense slot's position from MAN_REACTION_LAG_S seconds earlier (same shape) — used only by MAN mode; pass the same object as fullOffensePositions if no lag data is available (degrades to instant tracking rather than crashing)
 * @param {number} elapsedSinceSnapS - seconds since the snap moment (0 or negative before/at snap)
 * @param {number} postsnapDurationS - total post-snap duration, for pressure's arrival clamp
 * @returns {Object.<string, {x:number,y:number}>} defenderId -> current position
 */
export function computeDefensePositions(defense, fullOffensePositions, laggedOffensePositions, elapsedSinceSnapS, postsnapDurationS) {
  if (!defense || !defense.mode || !defense.defenders) return {};
  const positions = {};
  Object.entries(defense.defenders).forEach(([id, defender]) => {
    positions[id] = computeOneDefenderPosition(defense.mode, defender, fullOffensePositions, laggedOffensePositions, elapsedSinceSnapS, postsnapDurationS);
  });
  return positions;
}

function computeOneDefenderPosition(mode, defender, offensePositions, laggedOffensePositions, elapsedSinceSnapS, postsnapDurationS) {
  const base = defender.position;

  if (mode === 'man' && defender.assignment && offensePositions[defender.assignment]) {
    // Track where the receiver WAS a beat ago, not where they are right
    // now — a real defender reacts to a break, doesn't anticipate it.
    // This is what makes separation visibly appear right after a route
    // breaks, instead of the defender staying glued to it the whole way.
    const laggedTarget = (laggedOffensePositions && laggedOffensePositions[defender.assignment]) || offensePositions[defender.assignment];
    // Leverage side is fixed per defender from their own starting spot
    // relative to the receiver's start — stays consistent for the whole
    // route instead of flipping side to side, matching how a real
    // defender commits to inside or outside leverage pre-snap.
    const sideSign = base.x >= offensePositions[defender.assignment].x ? 1 : -1;
    return {
      x: clamp01(laggedTarget.x + sideSign * MAN_LEVERAGE_DX),
      y: clamp01(laggedTarget.y + MAN_LEVERAGE_DY),
    };
  }

  if (mode === 'zone') {
    // Stays anchored to its home zone, but drifts a small, capped amount
    // toward whichever offensive player is currently nearest — enough to
    // demonstrate "reacting to a route entering the area" without ever
    // reading as man coverage.
    let nearest = null;
    let nearestDist = Infinity;
    Object.values(offensePositions).forEach((p) => {
      const dist = Math.hypot(p.x - base.x, p.y - base.y);
      if (dist < nearestDist) { nearestDist = dist; nearest = p; }
    });
    if (!nearest || nearestDist > ZONE_REACT_RADIUS) return { ...base };
    const dx = nearest.x - base.x;
    const dy = nearest.y - base.y;
    const dist = Math.hypot(dx, dy) || 1;
    const drift = Math.min(ZONE_MAX_DRIFT, nearestDist * 0.4);
    return { x: clamp01(base.x + (dx / dist) * drift), y: clamp01(base.y + (dy / dist) * drift) };
  }

  if (mode === 'pressure') {
    // Converges toward the QB's position over a short, fixed window after
    // the snap — demonstrating pressure arriving, not any real rush lane
    // or blocker interaction. Stays put during presnap (no negative
    // progress) and holds at the QB once "arrived."
    const qbPos = offensePositions.QB || base;
    const arriveBy = Math.min(PRESSURE_ARRIVE_BY_S, postsnapDurationS || PRESSURE_ARRIVE_BY_S);
    const t = arriveBy > 0 ? clamp01(elapsedSinceSnapS / arriveBy) : (elapsedSinceSnapS > 0 ? 1 : 0);
    return { x: base.x + (qbPos.x - base.x) * t, y: base.y + (qbPos.y - base.y) * t };
  }

  // 'custom' (and any unrecognized mode): a fixed teaching placement —
  // deliberately never moves, since the coach positioned it for one
  // specific freeze-frame look, not a reactive demonstration.
  return { ...base };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
