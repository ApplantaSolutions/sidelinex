// Sideline Advisor V1 — the deterministic ranking core. Pure, no AI, no
// network, no DOM. This is the pipeline's first two stages: "deterministic
// filtering" and "transparent ranking" — every number here is computed
// directly from real Snap/Play data, nothing is invented, and every
// factor is a named, inspectable constant, not a black box. The AI layer
// (sidelineAdvisorExplain.js's server-side counterpart) is only ever
// allowed to explain THESE results in prose — never to choose or score
// plays itself. If the AI is slow or unavailable, everything this module
// produces (reasons included) is already useful on its own.
//
// The candidate pool is ALWAYS the active Game Plan — never the full
// Playbook — per the explicit "Do NOT let the LLM (or this engine) choose
// directly from the full Playbook" rule.

import { derivePlayStats, deriveAllStats } from './gameStats.js';
import { resolvePlayerForSlot } from '../playbook/roleResolution.js';
import { deriveTodayLookCounts, compareScoutingToObserved, buildScoutingReasonText, scoutSuggestsPressureAnswer } from '../scouting/scoutingIntelligence.js';

const REPETITION_WINDOW = 6;
const OBSERVATION_WINDOW = 6;
const SCOUTING_MIN_SAMPLE = 3;
const TOP_N = 4;
const MIN_N = 2;

// Named, transparent scoring weights — each one is a single, inspectable
// number so "why did this play rank here" always has a concrete answer.
const WEIGHTS = {
  situationalFit: 3,
  defensiveLookFit: 4,
  performanceMax: 5, // scaled down by sample-size confidence before applying
  playerTrendMax: 2, // small on purpose — player trends inform, they don't dominate
  favoriteOrCore: 1,
  repetitionPenaltyMax: 6, // largest single factor — repetition avoidance is explicit in the roadmap
  scoutingLookFit: 2, // pregame-only fallback — smaller than defensiveLookFit since it's not live evidence
  pressureAnswerFit: 2, // opponent scouting flags pressure/aggressive rush + play is tagged to beat it
};

const FILTERS = {
  run: (play) => play.category === 'run',
  pass: (play) => ['pass', 'play_action_pass'].includes(play.category),
  safe: (play) => !!play.tags?.safe,
  shot: (play) => !!play.tags?.explosive,
  beat_man: (play) => !!play.tags?.beatsMan,
  beat_zone: (play) => !!play.tags?.beatsZone,
  beat_pressure: (play) => !!play.tags?.beatsPressure,
};

/**
 * @returns {Array<{playId, score, confidence: 'HIGH'|'MEDIUM'|'LIMITED', reasons: string[], calledInLastWindow: number}>}
 * Sorted descending by score, length MIN_N..TOP_N (or fewer if the Game
 * Plan itself has fewer offensive plays than that).
 */
export function rankPlayCalls({ gameState, entries, playsById, snaps, weeklyRoles, players, filter, scout }) {
  const liveSnaps = (snaps || []).filter((s) => !s.voided);
  const offenseEntries = (entries || []).filter((e) => playsById[e.playId]?.play?.side === 'offense');

  let candidates = offenseEntries.filter((e) => {
    const play = playsById[e.playId]?.play;
    if (!play) return false;
    if (filter === 'not_called_yet') {
      return !liveSnaps.some((s) => s.playId === e.playId);
    }
    if (filter && FILTERS[filter]) return FILTERS[filter](play);
    return true;
  });

  const recentObservation = mostCommonObservation(liveSnaps.slice(-OBSERVATION_WINDOW));
  const playStats = derivePlayStats(liveSnaps);
  const { receiving, rushing } = deriveAllStats(liveSnaps);
  const recentPlayIds = liveSnaps.slice(-REPETITION_WINDOW).map((s) => s.playId);

  // Opponent Scouting integration (only computed when a scout is provided
  // — with none, behavior is byte-for-byte identical to before scouting
  // existed). "Real current-game evidence > historical scouting
  // assumption": compareScoutingToObserved only reaches 'conflict' or
  // 'consistent' once enough of TODAY's tracked snaps exist to say
  // something real; until then it honestly falls back to the pregame
  // assumption alone rather than pretending there's live confirmation.
  const scoutComparison = scout
    ? compareScoutingToObserved(scout.pregameTendencies?.baseLook, deriveTodayLookCounts(liveSnaps), SCOUTING_MIN_SAMPLE)
    : null;
  const scoutOperativeLook = scoutComparison?.status === 'conflict'
    ? scoutComparison.observed
    : scoutComparison?.status === 'consistent'
      ? scoutComparison.dominant
      : scout?.pregameTendencies?.baseLook && scout.pregameTendencies.baseLook !== 'MIXED_UNKNOWN'
        ? scout.pregameTendencies.baseLook
        : null;

  const scored = candidates.map((entry) => {
    const play = playsById[entry.playId].play;
    const version = playsById[entry.playId].version;
    const stats = playStats[entry.playId];
    const timesCalled = stats?.timesCalled || 0;
    const calledInLastWindow = recentPlayIds.filter((id) => id === entry.playId).length;

    let score = 0;
    const reasons = [];

    // ---- situational fit ----
    const needsConversion = isLastDownOfPhase(gameState);
    if (needsConversion && (play.tags?.conversion || play.tags?.goalLine)) {
      score += WEIGHTS.situationalFit;
      reasons.push(play.tags?.goalLine ? 'Tagged for goal line situations' : 'Tagged as a conversion call');
    }

    // ---- defensive look fit (live window — unchanged from before scouting existed) ----
    if (recentObservation) {
      const beatsIt = observationBeatsTag(recentObservation, play.tags);
      if (beatsIt) {
        score += WEIGHTS.defensiveLookFit;
        // When a scout is attached AND enough of today's snaps have been
        // tracked to say something real, the richer scouting-aware
        // sentence (which states BOTH pregame scouting and today's real
        // count) replaces the plain one in this same reason slot — this
        // never adds a net-new reason, it just makes the existing one
        // more honest when there's more real context to give.
        const scoutingText = (scoutComparison?.status === 'conflict' || scoutComparison?.status === 'consistent')
          ? buildScoutingReasonText(scoutComparison)
          : null;
        reasons.push(scoutingText || `Strong vs ${recentObservation} — seen on ${countObservation(liveSnaps.slice(-OBSERVATION_WINDOW), recentObservation)} of last ${Math.min(OBSERVATION_WINDOW, liveSnaps.length)} snaps`);
      }
    } else if (scoutOperativeLook) {
      // No live-window signal yet at all — fall back to pregame scouting
      // alone, clearly labeled as such and weighted lower than any real
      // observed evidence would be.
      const beatsIt = observationBeatsTag(scoutOperativeLook, play.tags);
      if (beatsIt) {
        score += WEIGHTS.scoutingLookFit;
        reasons.push(`Pregame scouting: opponent tends toward ${scoutOperativeLook === 'MAN' ? 'Man' : scoutOperativeLook === 'ZONE' ? 'Zone' : 'Pressure'} coverage.`);
      }
    }

    // ---- opponent rusher tendencies -> pressure-answer plays ----
    // Deterministic-only: only fires when the scout's own stored tags
    // (not a guess) suggest pressure/aggressive rush AND the play itself
    // already carries a real beatsPressure tag (from the coach or the AI
    // Play Analyzer applied earlier) — never an invented compatibility.
    if (scout && play.tags?.beatsPressure && scoutSuggestsPressureAnswer(scout)) {
      score += WEIGHTS.pressureAnswerFit;
      reasons.push('Opponent scouting flags an aggressive/fast rusher — tagged to beat pressure.');
    }

    // ---- recent performance this game (sample-size dampened) ----
    if (stats && timesCalled > 0) {
      const confidenceScale = Math.min(1, timesCalled / 3);
      const performanceSignal = (stats.successRate ?? 0) * 2 - 1; // -1..1
      score += performanceSignal * WEIGHTS.performanceMax * confidenceScale;
      reasons.push(`${stats.successes}/${stats.timesCalled} successful in similar situations today`);
    }

    // ---- player performance (primary target / ball carrier) ----
    const primarySlot = play.intent?.primaryTargetSlot;
    if (primarySlot) {
      const playerId = resolvePlayerForSlot(weeklyRoles, 'offense', primarySlot);
      const rec = playerId ? receiving[playerId] : null;
      if (rec && rec.targets > 0) {
        const trendSignal = (rec.catchRate ?? 0.5) * 2 - 1;
        score += trendSignal * WEIGHTS.playerTrendMax * Math.min(1, rec.targets / 3);
        const name = playerName(players, playerId);
        if (rec.drops > 0) {
          reasons.push(`${name} is ${rec.catches}/${rec.targets} today with ${rec.drops} recorded drop${rec.drops === 1 ? '' : 's'}`);
        } else {
          reasons.push(`${name} has ${rec.catches} catches on ${rec.targets} targets`);
        }
      }
    }
    const ballCarrierSlot = Object.entries(version?.assignments || {}).find(([, a]) => a.roleClassification === 'ball_carrier')?.[0];
    if (ballCarrierSlot) {
      const playerId = resolvePlayerForSlot(weeklyRoles, 'offense', ballCarrierSlot);
      const rush = playerId ? rushing[playerId] : null;
      if (rush && rush.carries > 0) {
        const ypcSignal = clamp(((rush.yardsPerCarry ?? 0) - 3) / 6, -1, 1); // rough, transparent midpoint at 3 ypc
        score += ypcSignal * WEIGHTS.playerTrendMax * Math.min(1, rush.carries / 3);
        reasons.push(`${playerName(players, playerId)} averaging ${rush.yardsPerCarry.toFixed(1)} yds/carry today (${rush.carries} carr${rush.carries === 1 ? 'y' : 'ies'})`);
      }
    }

    // ---- coach favorite / core call ----
    if (play.favorite || entry.isCore) {
      score += WEIGHTS.favoriteOrCore;
    }

    // ---- repetition penalty ----
    if (calledInLastWindow > 0) {
      const windowSize = Math.min(REPETITION_WINDOW, liveSnaps.length) || 1;
      score -= WEIGHTS.repetitionPenaltyMax * (calledInLastWindow / windowSize);
      reasons.push(`Called ${calledInLastWindow} of last ${windowSize} snaps`);
    } else if (timesCalled === 0) {
      reasons.push('Not called yet this game');
    } else {
      reasons.push(`Not called in last ${Math.min(REPETITION_WINDOW, liveSnaps.length)} snaps`);
    }

    const confidence = computeConfidence(timesCalled, !!recentObservation);

    return {
      playId: entry.playId,
      score,
      confidence,
      reasons: reasons.slice(0, 3), // keep it short — sideline glanceable, not an essay
      calledInLastWindow,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(MIN_N, Math.min(TOP_N, scored.length)));
}

function isLastDownOfPhase(gameState) {
  // Pure signal used only for a modest situational-fit boost — the caller
  // is expected to pass a gameState already resolved against the real
  // ruleConfig max-downs elsewhere; this file intentionally stays
  // ruleConfig-agnostic beyond what's given to it via callers who compute
  // "is this the last realistic down" themselves. Kept simple: treat
  // down >= 3 within toMidfield, or down >= 2 within toScore, as
  // "need this to convert" — a deliberately conservative, documented
  // heuristic, not a hardcoded rule count.
  if (gameState.phase === 'toMidfield') return gameState.down >= 3;
  return gameState.down >= 2;
}

function mostCommonObservation(recentSnaps) {
  const counts = {};
  recentSnaps.forEach((s) => {
    if (!s.defensiveLookObserved) return;
    counts[s.defensiveLookObserved] = (counts[s.defensiveLookObserved] || 0) + 1;
  });
  let best = null;
  let bestCount = 0;
  Object.entries(counts).forEach(([obs, count]) => {
    if (count > bestCount) { best = obs; bestCount = count; }
  });
  return best;
}

function countObservation(recentSnaps, observation) {
  return recentSnaps.filter((s) => s.defensiveLookObserved === observation).length;
}

function observationBeatsTag(observation, tags) {
  const map = { MAN: 'beatsMan', ZONE: 'beatsZone', PRESSURE: 'beatsPressure' };
  const tagKey = map[observation];
  return tagKey ? !!tags?.[tagKey] : false;
}

/**
 * Confidence reflects DATA VOLUME, never a probability — "sample size
 * must always matter" applies here exactly as it does in gameStats.js.
 */
function computeConfidence(timesCalled, hasObservation) {
  if (timesCalled >= 3) return 'HIGH';
  if (timesCalled >= 1 || hasObservation) return 'MEDIUM';
  return 'LIMITED';
}

function playerName(players, playerId) {
  return (players || []).find((p) => p.id === playerId)?.firstName || 'That player';
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export const QUICK_FILTERS = [
  { value: 'run', label: 'RUN' },
  { value: 'pass', label: 'PASS' },
  { value: 'safe', label: 'SAFE' },
  { value: 'shot', label: 'SHOT' },
  { value: 'beat_man', label: 'BEAT MAN' },
  { value: 'beat_zone', label: 'BEAT ZONE' },
  { value: 'beat_pressure', label: 'BEAT PRESSURE' },
  { value: 'not_called_yet', label: 'NOT CALLED YET' },
];
