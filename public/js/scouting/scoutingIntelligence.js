// Opponent Scouting's deterministic, no-fabrication core. Pure, no DOM, no
// AI, no network — this is what makes "pregame scouting" vs "observed
// today" vs "historical data" a real, honest distinction instead of a
// blended guess, and what lets the Sideline Advisor prefer real
// current-game evidence over a stale pregame assumption without ever
// inventing a number to justify it.
//
// Every count here is a real tally over the (non-voided) snap log — same
// "sample size must always matter" discipline as gameStats.js. Nothing in
// this file ever produces a percentage; only real observed/tracked counts.

function isLive(snap) {
  return !snap.voided;
}

/**
 * How many of today's live snaps had ANY defensive look logged — this is
 * the honest denominator for every "observed" claim. A snap with no
 * defensiveLookObserved tag was simply not tracked, and never counts
 * toward either side of a ratio.
 */
export function deriveTotalTrackedCount(snaps) {
  return (snaps || []).filter(isLive).filter((s) => !!s.defensiveLookObserved).length;
}

/**
 * Counts of every DISTINCT value actually tapped on the defensive
 * observation chips today (MAN/ZONE/PRESSURE and any of the other
 * Game Day chips) — generic and honest rather than hardcoded to the 3
 * core looks, so nothing observed is ever silently dropped.
 * @returns {Object.<string, number>}
 */
export function deriveTodayLookCounts(snaps) {
  const counts = {};
  (snaps || []).filter(isLive).forEach((s) => {
    if (!s.defensiveLookObserved) return;
    counts[s.defensiveLookObserved] = (counts[s.defensiveLookObserved] || 0) + 1;
  });
  return counts;
}

/**
 * The last N snaps that actually had a defensive look tracked, in
 * chronological order — untracked snaps are skipped rather than shown as
 * a blank, since "recent" here means "recent TRACKED observations."
 */
export function deriveRecentLookSequence(snaps, n = 5) {
  return (snaps || [])
    .filter(isLive)
    .filter((s) => !!s.defensiveLookObserved)
    .slice(-n)
    .map((s) => s.defensiveLookObserved);
}

/**
 * A small, honest qualifier — not a source type, a modifier on one. Used
 * anywhere an "Observed Today" count is shown with too little data behind
 * it to lean on.
 */
export function describeSampleConfidence(totalTracked, minForConfidence = 3) {
  return totalTracked > 0 && totalTracked < minForConfidence ? 'LIMITED SAMPLE' : null;
}

/**
 * The core "does today's evidence disagree with pregame scouting" check.
 * Returns one of three honest states — never forces a comparison when
 * there isn't enough real data to make one meaningful.
 *
 * @param {string|null} pregameBaseLook - scout.pregameTendencies.baseLook
 * @param {Object.<string, number>} todayLookCounts - from deriveTodayLookCounts
 * @param {number} minSampleForComparison - below this many tracked snaps, comparison is not attempted
 * @returns {{status: 'no_scouting'} | {status: 'insufficient_data', totalTracked: number} | {status: 'consistent', dominant: string, dominantCount: number, totalTracked: number} | {status: 'conflict', pregame: string, observed: string, observedCount: number, totalTracked: number}}
 */
export function compareScoutingToObserved(pregameBaseLook, todayLookCounts, minSampleForComparison = 3) {
  // Only the 3 real, comparable looks are eligible to be "the dominant
  // observed look" — a coach's SOFT/TIGHT/EDGE OPEN taps are real
  // observations too, but they don't map onto a MAN/ZONE/PRESSURE
  // pregame assumption, so they're excluded from this specific
  // comparison (they still show up in the raw counts elsewhere).
  const comparableCounts = {};
  ['MAN', 'ZONE', 'PRESSURE'].forEach((look) => {
    if (todayLookCounts[look]) comparableCounts[look] = todayLookCounts[look];
  });
  const totalTracked = Object.values(comparableCounts).reduce((sum, c) => sum + c, 0);

  if (!pregameBaseLook || pregameBaseLook === 'MIXED_UNKNOWN') {
    return totalTracked === 0 ? { status: 'no_scouting' } : { status: 'insufficient_data', totalTracked };
  }
  if (totalTracked < minSampleForComparison) {
    return { status: 'insufficient_data', totalTracked };
  }

  let dominant = null;
  let dominantCount = 0;
  Object.entries(comparableCounts).forEach(([look, count]) => {
    if (count > dominantCount) { dominant = look; dominantCount = count; }
  });

  if (dominant === pregameBaseLook) {
    return { status: 'consistent', dominant, dominantCount, totalTracked };
  }
  return { status: 'conflict', pregame: pregameBaseLook, observed: dominant, observedCount: dominantCount, totalTracked };
}

const LOOK_DISPLAY = { MAN: 'Man', ZONE: 'Zone', PRESSURE: 'Pressure', MIXED_UNKNOWN: 'Mixed/Unknown' };

/**
 * Turns a compareScoutingToObserved() result into ONE short, honest
 * sentence — or null when there's genuinely nothing useful to say yet.
 * This is exactly what feeds the Advisor's reasons array (deterministic,
 * no AI) and what the AI explanation layer is later allowed to paraphrase
 * but never permitted to add numbers to.
 */
export function buildScoutingReasonText(comparison) {
  if (!comparison) return null;
  switch (comparison.status) {
    case 'conflict':
      return `Pregame scouting suggested ${LOOK_DISPLAY[comparison.pregame] || comparison.pregame}, but ${LOOK_DISPLAY[comparison.observed] || comparison.observed} has been observed on ${comparison.observedCount} of the last ${comparison.totalTracked} tracked snaps.`;
    case 'consistent':
      return `Pregame scouting and today's snaps agree on ${LOOK_DISPLAY[comparison.dominant] || comparison.dominant} (${comparison.dominantCount} of ${comparison.totalTracked} tracked snaps).`;
    case 'insufficient_data':
      return comparison.totalTracked > 0 ? `Only ${comparison.totalTracked} tracked snap${comparison.totalTracked === 1 ? '' : 's'} so far — not enough yet to compare against pregame scouting.` : null;
    case 'no_scouting':
    default:
      return null;
  }
}

/**
 * Deterministic-only check: does this opponent's pregame scouting suggest
 * pressure/aggressive rush tendencies that a "beatsPressure"-tagged play
 * would be a real, stored-data-driven answer to? Never invents a
 * compatibility that isn't backed by an actual tag the coach (or the AI
 * Play Analyzer, applied earlier) actually set.
 */
export function scoutSuggestsPressureAnswer(scout) {
  const tendency = scout?.pregameTendencies;
  if (!tendency) return false;
  if (tendency.baseLook === 'PRESSURE') return true;
  if ((tendency.tendencyTags || []).includes('HEAVY_RUSH')) return true;
  const aggressiveRusher = (tendency.rusherTags || []).some((t) => ['FAST_RUSHER', 'AGGRESSIVE', 'CONTAINS_QB'].includes(t));
  return aggressiveRusher;
}
