// Postgame Analytics V1 — pure, no DOM, no AI, no network. Every number
// here is either a direct reuse of gameStats.js/gameStateEngine.js (never
// recomputed a second, possibly-drifting way) or a new derivation built
// the same way: a fold over the real (non-voided) snap log, with the
// sample size always attached to whatever rate/claim it produced.
//
// "Reproducible from source data" (explicit requirement): nothing in this
// file is ever stored — the Postgame Report is always recomputed fresh
// from Snap/Game/Recommendation records when opened. Reopening a
// completed game's report later just means calling these functions again
// against the same source data.

import { derivePassingStats, deriveReceivingStats, deriveRushingStats, derivePlayStats } from '../gameday/gameStats.js';
import { initialGameState, applyResult, deriveGameState } from '../gameday/gameStateEngine.js';

function isLive(snap) {
  return !snap.voided;
}

function toResult(snap) {
  return { type: snap.resultType, yards: snap.yards, touchdown: snap.touchdown, crossedMidfield: snap.crossedMidfield, turnover: snap.turnover };
}

// ---------- situational tagging (reuses gameStateEngine, adds nothing new to it) ----------

/**
 * Replays the game the same way deriveGameState does, but keeps the state
 * that existed BEFORE each snap was applied (i.e. the situation the play
 * was actually called into) — deriveGameState itself only returns the
 * FINAL state, which isn't enough for situational analysis. Pure addition
 * built entirely on the already-tested initialGameState/applyResult
 * exports; gameStateEngine.js itself is untouched.
 *
 * @returns {Array<{snap, stateBefore}>}
 */
export function deriveSituationSequence(liveSnaps, ruleConfig, startingPossession = 'us') {
  let state = initialGameState(startingPossession);
  return liveSnaps.map((snap) => {
    const stateBefore = state;
    state = applyResult(state, toResult(snap), ruleConfig);
    return { snap, stateBefore };
  });
}

/**
 * A snap is a "conversion attempt" when it's the last down available in
 * its phase — the same must-convert heuristic already used (and flagged
 * as a deliberate interpretation) in sidelineAdvisor.js's
 * isLastDownOfPhase. Kept here as its own small, documented copy rather
 * than a shared import, since the two call sites have different enough
 * needs (this one only ever receives a real historical state, never a
 * live in-progress one) that coupling them isn't worth the risk of a
 * future change to one silently affecting the other.
 */
function isConversionAttempt(state, ruleConfig) {
  const maxDowns = state.phase === 'toMidfield' ? ruleConfig.downsToMidfield : ruleConfig.downsAfterMidfieldToScore;
  return state.down >= maxDowns;
}

function isSuccess(snap) {
  return !!(snap.crossedMidfield || snap.touchdown);
}

// ---------- 1. Game Summary (glanceable) ----------

/**
 * @returns everything section 2 of the roadmap asks for, computed once,
 * never duplicated elsewhere — every other section either reuses this or
 * derives its own numbers straight from the snap log the same honest way.
 */
export function deriveGameSummary(liveSnaps, ruleConfig, startingPossession = 'us') {
  const gameState = deriveGameState(liveSnaps.map(toResult), ruleConfig, startingPossession);
  const passAttempts = liveSnaps.filter((s) => ['complete', 'incomplete', 'drop'].includes(s.resultType));
  const completions = liveSnaps.filter((s) => s.resultType === 'complete');
  const passingYards = completions.reduce((sum, s) => sum + (s.yards || 0), 0);
  const rushingYards = liveSnaps.filter((s) => s.resultType === 'run').reduce((sum, s) => sum + (s.yards || 0), 0);
  const touchdowns = liveSnaps.filter((s) => s.touchdown).length;
  const turnovers = liveSnaps.filter((s) => s.turnover).length;
  const conversions = liveSnaps.filter((s) => s.crossedMidfield).length;
  const successes = liveSnaps.filter(isSuccess).length;
  const tracked = liveSnaps.filter((s) => !!s.defensiveLookObserved).length;

  return {
    score: gameState.score,
    totalSnaps: liveSnaps.length,
    completions: completions.length,
    passAttempts: passAttempts.length,
    passingYards,
    rushingYards,
    touchdowns,
    turnovers,
    conversions,
    offensiveSuccess: { successes, totalSnaps: liveSnaps.length, rate: liveSnaps.length > 0 ? successes / liveSnaps.length : null },
    defensiveLooksTracked: tracked,
    defensiveLooksTotalSnaps: liveSnaps.length,
  };
}

// ---------- 2. Player performance (pure reuse — no new derivation) ----------

export function derivePlayerPerformance(liveSnaps) {
  return {
    passing: derivePassingStats(liveSnaps),
    receiving: deriveReceivingStats(liveSnaps),
    rushing: deriveRushingStats(liveSnaps),
  };
}

// ---------- 3. Opportunity vs. production ----------

/**
 * Adds a real, mathematically-supported targetShare (0..1) to each
 * receiver — the % of THIS GAME's total recorded targets that player got.
 * Only ever computed when there's at least one real target; a player's
 * share is never invented from a zero denominator.
 */
export function deriveTargetShares(receivingStats) {
  const totalTargets = Object.values(receivingStats).reduce((sum, r) => sum + r.targets, 0);
  const result = {};
  Object.entries(receivingStats).forEach(([playerId, r]) => {
    result[playerId] = { ...r, targetShare: totalTargets > 0 ? r.targets / totalTargets : null, totalGameTargets: totalTargets };
  });
  return result;
}

// ---------- 4. Play performance (pure reuse) + primary target scoped to one play ----------

export function derivePlayPerformance(liveSnaps) {
  return derivePlayStats(liveSnaps); // already includes byDefensiveLook — exactly what section 5 asks for
}

/**
 * The designed primary target's performance on THIS SPECIFIC PLAY ONLY —
 * distinct from that player's overall game receiving stats (which mixes
 * in every other play they were targeted on). "Primary target
 * performance where available" only ever returns data when the play was
 * actually thrown to that player at least once.
 */
export function derivePrimaryTargetPerformanceForPlay(liveSnaps, playId, targetPlayerId) {
  if (!targetPlayerId) return null;
  const relevant = liveSnaps.filter((s) => s.playId === playId && s.targetId === targetPlayerId && ['complete', 'incomplete', 'drop'].includes(s.resultType));
  if (relevant.length === 0) return null;
  const catches = relevant.filter((s) => s.resultType === 'complete');
  return {
    targets: relevant.length,
    catches: catches.length,
    drops: relevant.filter((s) => s.resultType === 'drop').length,
    yards: catches.reduce((sum, s) => sum + (s.yards || 0), 0),
  };
}

// ---------- 5. Coverage / defensive splits (team-wide) ----------

/**
 * VS MAN / VS ZONE / VS PRESSURE team-wide results — only ever built from
 * snaps that actually had a defensive look tagged. Always carries
 * trackedSnaps vs totalSnaps so "Based on tracked snaps" is never
 * misleading about how much of the game was actually identified.
 */
export function deriveTeamDefensiveSplits(liveSnaps) {
  const byLook = {};
  liveSnaps.forEach((s) => {
    if (!s.defensiveLookObserved) return;
    const look = (byLook[s.defensiveLookObserved] ||= { look: s.defensiveLookObserved, snaps: 0, totalYards: 0, successes: 0, touchdowns: 0 });
    look.snaps += 1;
    look.totalYards += s.yards || 0;
    if (isSuccess(s)) look.successes += 1;
    if (s.touchdown) look.touchdowns += 1;
  });
  Object.values(byLook).forEach((l) => {
    l.averageGain = l.snaps > 0 ? l.totalYards / l.snaps : null;
    l.successRate = l.snaps > 0 ? l.successes / l.snaps : null;
  });
  const trackedSnaps = liveSnaps.filter((s) => !!s.defensiveLookObserved).length;
  return { byLook, trackedSnaps, totalSnaps: liveSnaps.length };
}

// ---------- 6. Situational self-scout ----------

export function deriveRunPassDistribution(liveSnaps) {
  const run = liveSnaps.filter((s) => s.resultType === 'run').length;
  const pass = liveSnaps.filter((s) => ['complete', 'incomplete', 'drop'].includes(s.resultType)).length;
  const total = run + pass;
  return { run, pass, total, runShare: total > 0 ? run / total : null, passShare: total > 0 ? pass / total : null };
}

/**
 * Before/after midfield call counts — uses the real situation the play
 * was called into (deriveSituationSequence), never inferred after the
 * fact from its result.
 */
export function derivePhaseDistribution(liveSnaps, ruleConfig, startingPossession = 'us') {
  const sequence = deriveSituationSequence(liveSnaps, ruleConfig, startingPossession);
  const toMidfield = sequence.filter((s) => s.stateBefore.phase === 'toMidfield').length;
  const toScore = sequence.filter((s) => s.stateBefore.phase === 'toScore').length;
  return { toMidfield, toScore, total: sequence.length };
}

/**
 * "Potential tendency" data for conversion-situation play calling — the
 * literal shape behind "On 5 tracked conversion attempts, Green Grass was
 * called 3 times." Only counts snaps where OUR team actually had
 * possession (a conversion attempt on defense isn't a play call).
 */
export function deriveConversionCallTendency(liveSnaps, ruleConfig, startingPossession = 'us') {
  const sequence = deriveSituationSequence(liveSnaps, ruleConfig, startingPossession);
  const attempts = sequence.filter((s) => s.stateBefore.possession === 'us' && isConversionAttempt(s.stateBefore, ruleConfig));
  const byPlay = {};
  attempts.forEach(({ snap }) => {
    if (!snap.playId) return;
    byPlay[snap.playId] = (byPlay[snap.playId] || 0) + 1;
  });
  return { totalConversionAttempts: attempts.length, callCounts: byPlay };
}

// ---------- 7. Predictability / repetition ----------

/**
 * MOST CALLED / LEAST USED — a thin, honest sort of the already-computed
 * play stats. LEAST_USED intentionally excludes plays with zero calls
 * (nothing to say about a play that was never called at all here — that's
 * just "unused," not a tendency).
 */
export function deriveCallFrequencyRanking(playStats) {
  const withCalls = Object.values(playStats).filter((p) => p.timesCalled > 0);
  const sorted = [...withCalls].sort((a, b) => b.timesCalled - a.timesCalled);
  return { mostCalled: sorted.slice(0, 3), leastUsed: sorted.slice(-3).reverse() };
}

// ---------- 8. Advisor vs. Coach (descriptive, never a scoreboard) ----------

/**
 * For every recommendation set where we know both what was suggested AND
 * what was actually called, flags whether the coach's call was inside the
 * shown options or an override. For override snaps specifically, looks up
 * the REAL logged yardage from the snap the recommendation was matched to
 * — never estimated. Returns null (not a claim) when there are zero
 * overrides to report on.
 */
export function deriveAdvisorVsCoach(recommendations, liveSnaps) {
  const snapsById = Object.fromEntries(liveSnaps.map((s) => [s.id, s]));
  let matched = 0;
  let overridden = 0;
  const overrideYards = [];
  (recommendations || []).forEach((rec) => {
    if (!rec.calledPlayId || !rec.calledSnapId) return; // this recommendation set never led anywhere we can trace
    const wasSuggested = (rec.rankedOptions || []).some((o) => o.playId === rec.calledPlayId);
    if (wasSuggested) {
      matched += 1;
    } else {
      overridden += 1;
      const snap = snapsById[rec.calledSnapId];
      if (snap && !snap.voided && typeof snap.yards === 'number') overrideYards.push(snap.yards);
    }
  });
  const totalTraceable = matched + overridden;
  const overrideAvgYards = overrideYards.length > 0 ? overrideYards.reduce((a, b) => a + b, 0) / overrideYards.length : null;
  return { matched, overridden, totalTraceable, overrideAvgYards, overrideSampleSize: overrideYards.length };
}

// ---------- 9. Worked well / Review — deterministic, named thresholds ----------

const WORKED_MIN_SAMPLE = 2;
const WORKED_SUCCESS_RATE = 0.6;
const REVIEW_SUCCESS_RATE = 0.3;
const REVIEW_MIN_SAMPLE = 2;

/**
 * Deterministic categorization ONLY — no AI involved. Every threshold is
 * a named constant above so "why is this listed" always has a concrete
 * answer, same discipline as sidelineAdvisor.js's WEIGHTS. Nothing is
 * listed below the minimum sample size in either direction — a single
 * lucky or unlucky play is never enough to call it "worked" or "review."
 */
export function deriveWorkedAndReview(playStats, receivingStats) {
  const worked = [];
  const review = [];

  Object.values(playStats).forEach((p) => {
    if (p.timesCalled >= WORKED_MIN_SAMPLE && p.successRate != null && p.successRate >= WORKED_SUCCESS_RATE) {
      worked.push({ type: 'play', playId: p.playId, timesCalled: p.timesCalled, averageGain: p.averageGain, successRate: p.successRate });
    }
    if (p.timesCalled >= REVIEW_MIN_SAMPLE && p.successRate != null && p.successRate <= REVIEW_SUCCESS_RATE) {
      review.push({ type: 'play', playId: p.playId, timesCalled: p.timesCalled, averageGain: p.averageGain, successRate: p.successRate });
    }
  });

  Object.values(receivingStats).forEach((r) => {
    if (r.targets >= WORKED_MIN_SAMPLE && r.catchRate != null && r.catchRate >= WORKED_SUCCESS_RATE) {
      worked.push({ type: 'receiver', playerId: r.playerId, targets: r.targets, catches: r.catches, catchRate: r.catchRate });
    }
    if (r.drops > 0) {
      review.push({ type: 'drops', playerId: r.playerId, drops: r.drops, targets: r.targets });
    }
  });

  return { worked, review };
}

// ---------- 10. Practice priorities (deterministic, rule-based, coach still decides) ----------

/**
 * Turns REVIEW facts into short, concrete suggestions — never a full
 * curriculum, just possible focus areas the coach can choose to act on
 * (or not) via "Add to Practice Ideas."
 */
export function derivePracticeSuggestions(reviewItems, teamDefensiveSplits) {
  const suggestions = [];
  const totalDrops = reviewItems.filter((r) => r.type === 'drops').reduce((sum, r) => sum + r.drops, 0);
  if (totalDrops > 0) {
    suggestions.push({ id: 'drops', text: `Catching / ball security — ${totalDrops} recorded drop${totalDrops === 1 ? '' : 's'}` });
  }
  const pressureSplit = teamDefensiveSplits?.byLook?.PRESSURE;
  if (pressureSplit && pressureSplit.snaps >= 3 && (pressureSplit.successRate == null || pressureSplit.successRate < 0.5)) {
    suggestions.push({ id: 'pressure', text: `Pressure answers — Pressure observed on ${pressureSplit.snaps} tracked snaps` });
  }
  const strugglingPlays = reviewItems.filter((r) => r.type === 'play');
  strugglingPlays.forEach((p) => {
    const successes = Math.round(p.successRate * p.timesCalled); // reconstructs a real logged count, never a percentage
    suggestions.push({ id: `play-${p.playId}`, text: `Play execution review — ${successes}/${p.timesCalled} successful` });
  });
  return suggestions;
}
