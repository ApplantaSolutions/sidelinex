// Season Self-Scout V1 — the "Game -> Season -> future multi-season"
// architecture the roadmap asks for, built the simplest way that's
// actually correct: every postgameAnalytics.js function already operates
// on a flat snap array with no assumption about which single game it came
// from. A season rollup is nothing more than concatenating every ended
// game's real snaps and calling those SAME functions again — no new
// aggregation logic to duplicate or drift from the per-game numbers.
// Multi-season later is the same idea one level up (concatenate more
// games' snaps) — nothing here needs to change to support that.

import {
  derivePlayerPerformance, derivePlayPerformance, deriveTargetShares,
  deriveRunPassDistribution, deriveTeamDefensiveSplits,
} from './postgameAnalytics.js';

/**
 * @param {Array<{gameId, snaps}>} games - each game's already-non-voided snap list
 * @returns the same shape a single game's postgame report would produce,
 * just computed over every game's snaps combined.
 */
export function deriveSeasonRollup(games) {
  const allSnaps = (games || []).flatMap((g) => g.snaps || []);
  const receiving = derivePlayerPerformance(allSnaps).receiving;
  return {
    gamesIncluded: (games || []).length,
    totalSnaps: allSnaps.length,
    playerPerformance: derivePlayerPerformance(allSnaps),
    playPerformance: derivePlayPerformance(allSnaps),
    targetShares: deriveTargetShares(receiving),
    runPassDistribution: deriveRunPassDistribution(allSnaps),
    teamDefensiveSplits: deriveTeamDefensiveSplits(allSnaps),
  };
}

const MIN_GAMES_FOR_TREND = 2;

/**
 * Per-game breakdown for ONE play across a chronological list of ended
 * games — genuinely new logic (a season rollup merges everything
 * together; a trend deliberately keeps each game separate). A game where
 * the play was never called is skipped entirely rather than shown as a
 * zero — "never manufacture significance" means a gap in the data stays
 * a gap, not a fabricated data point.
 *
 * @param {Array<{gameId, snaps, label}>} gamesInOrder - oldest to newest
 * @returns {{playId, points: Array<{gameId, label, timesCalled, averageGain}>, sufficientData: boolean}}
 */
export function derivePlayTrend(gamesInOrder, playId) {
  const points = [];
  (gamesInOrder || []).forEach((g) => {
    const stats = derivePlayPerformance(g.snaps || [])[playId];
    if (stats && stats.timesCalled > 0) {
      points.push({ gameId: g.gameId, label: g.label || g.gameId, timesCalled: stats.timesCalled, averageGain: stats.averageGain });
    }
  });
  return { playId, points, sufficientData: points.length >= MIN_GAMES_FOR_TREND };
}

/**
 * Same idea, for one player's targets across games.
 */
export function derivePlayerTargetTrend(gamesInOrder, playerId) {
  const points = [];
  (gamesInOrder || []).forEach((g) => {
    const stats = derivePlayerPerformance(g.snaps || []).receiving[playerId];
    if (stats && stats.targets > 0) {
      points.push({ gameId: g.gameId, label: g.label || g.gameId, targets: stats.targets, catches: stats.catches });
    }
  });
  return { playerId, points, sufficientData: points.length >= MIN_GAMES_FOR_TREND };
}
