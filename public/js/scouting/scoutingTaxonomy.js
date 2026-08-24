// Centralized, extensible vocabulary for Opponent Scouting — one place to
// add a new tag, everywhere (scout editor chips, playmaker cards,
// situational tendencies, the deterministic Advisor's scouting signal)
// reads from the same list. Adding a new tendency tag later never means
// hunting through multiple files.
//
// DEFENSIVE_LOOKS deliberately reuses the exact 'MAN'/'ZONE'/'PRESSURE'
// string values already stored on Snap.defensiveLookObserved and already
// checked against in sidelineAdvisor.js (rankPlayCalls, mostCommonObservation)
// and gameDayView.js's live observation chips — this is what lets
// pregame scouting and live-observed data be compared apples-to-apples in
// scoutingIntelligence.js. MIXED_UNKNOWN is new (pregame-only; you can't
// "observe" a mixed look on a single live snap the same way).

export const DEFENSIVE_LOOKS = [
  { value: 'MAN', label: 'Man' },
  { value: 'ZONE', label: 'Zone' },
  { value: 'PRESSURE', label: 'Pressure' },
  { value: 'MIXED_UNKNOWN', label: 'Mixed / Unknown' },
];

export const TENDENCY_TAGS = [
  { value: 'TIGHT', label: 'Tight' },
  { value: 'SOFT', label: 'Soft' },
  { value: 'INSIDE_LEVERAGE', label: 'Inside Leverage' },
  { value: 'OUTSIDE_LEVERAGE', label: 'Outside Leverage' },
  { value: 'MIDDLE_OPEN', label: 'Middle Open' },
  { value: 'EDGE_OPEN', label: 'Edge Open' },
  { value: 'HEAVY_RUSH', label: 'Heavy Rush' },
  { value: 'CONTAIN', label: 'Contain' },
  { value: 'SPY', label: 'Spy' },
];

export const RUSHER_TAGS = [
  { value: 'FAST_RUSHER', label: 'Fast Rusher' },
  { value: 'AGGRESSIVE', label: 'Aggressive' },
  { value: 'DELAYED_RUSH', label: 'Delayed Rush' },
  { value: 'INSIDE_RUSH', label: 'Inside Rush' },
  { value: 'EDGE_RUSH', label: 'Edge Rush' },
  { value: 'CONTAINS_QB', label: 'Contains QB' },
  { value: 'BITES_ON_FAKE', label: 'Bites on Fake' },
  { value: 'DISCIPLINED', label: 'Disciplined' },
];

// Playmaker cards use a slightly different, smaller vocabulary — a mix of
// rusher tendencies and coverage-specific strengths — since a playmaker
// card is "what makes THIS player worth watching," not the full rusher
// tendency set.
export const PLAYMAKER_STRENGTH_TAGS = [
  { value: 'FAST_RUSHER', label: 'Fast Rusher' },
  { value: 'BEST_COVER_DEFENDER', label: 'Best Cover Defender' },
  { value: 'AGGRESSIVE', label: 'Aggressive' },
  { value: 'BITES_ON_MOTION', label: 'Bites on Motion' },
  { value: 'EDGE_RUSH', label: 'Edge Rush' },
  { value: 'CONTAINS_QB', label: 'Contains QB' },
  { value: 'DISCIPLINED', label: 'Disciplined' },
];

export const SITUATIONS = [
  { value: 'BASE', label: 'Base' },
  { value: 'SHORT_YARDAGE', label: 'Short Yardage' },
  { value: 'NEAR_GOAL_LINE', label: 'Near Goal Line' },
  { value: 'AFTER_MIDFIELD', label: 'After Midfield' },
  { value: 'IMPORTANT_DOWN', label: 'Important Down' },
];

// Every scouting-derived statement carries one of these so pregame
// assumption, today's live evidence, and (future) historical/film data are
// never silently blended into one unlabeled claim.
export const SOURCE_TYPES = {
  COACH_SCOUTING: 'Coach Scouting',
  OBSERVED_TODAY: 'Observed Today',
  HISTORICAL_DATA: 'Historical Data',
};

// Reused by the defensive-alignment editor — same mode vocabulary as the
// Play Designer's defense.mode so a saved scouting alignment stores the
// identical {mode, defenders} shape and can be reused there later without
// a schema change (section 14's "clean provenance/schema" requirement
// extends to this too).
export const ALIGNMENT_MODES = [
  { value: 'man', label: 'MAN' },
  { value: 'zone', label: 'ZONE' },
  { value: 'pressure', label: 'PRESSURE' },
  { value: 'custom', label: 'MIXED / CUSTOM' },
];

export function labelFor(list, value) {
  return list.find((item) => item.value === value)?.label || value;
}
