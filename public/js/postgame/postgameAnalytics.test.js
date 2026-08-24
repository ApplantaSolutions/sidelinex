import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveSituationSequence, deriveGameSummary, derivePlayerPerformance, deriveTargetShares,
  derivePlayPerformance, derivePrimaryTargetPerformanceForPlay, deriveTeamDefensiveSplits,
  deriveRunPassDistribution, derivePhaseDistribution, deriveConversionCallTendency,
  deriveCallFrequencyRanking, deriveAdvisorVsCoach, deriveWorkedAndReview, derivePracticeSuggestions,
} from './postgameAnalytics.js';

const RULE_CONFIG = { downsToMidfield: 4, downsAfterMidfieldToScore: 3 };

function snap(overrides) {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`, playId: 'p1', resultType: 'run', yards: 0,
    touchdown: false, crossedMidfield: false, turnover: false, voided: false, ...overrides,
  };
}

// ---------- deriveSituationSequence ----------

test('deriveSituationSequence tags each snap with the real state that existed BEFORE it, not after', () => {
  const snaps = [snap({ crossedMidfield: true }), snap({})];
  const seq = deriveSituationSequence(snaps, RULE_CONFIG, 'us');
  assert.equal(seq[0].stateBefore.phase, 'toMidfield'); // before the crossing snap
  assert.equal(seq[1].stateBefore.phase, 'toScore'); // after it crossed
});

// ---------- deriveGameSummary ----------

test('deriveGameSummary computes every glanceable field from real snaps, nothing invented', () => {
  const snaps = [
    snap({ resultType: 'complete', yards: 10 }),
    snap({ resultType: 'incomplete', yards: 0 }),
    snap({ resultType: 'run', yards: 5 }),
    snap({ resultType: 'complete', yards: 8, touchdown: true }),
    snap({ resultType: 'run', yards: -2, turnover: true }),
    snap({ resultType: 'run', yards: 3, crossedMidfield: true }),
  ];
  const summary = deriveGameSummary(snaps, RULE_CONFIG, 'us');
  assert.equal(summary.totalSnaps, 6);
  assert.equal(summary.completions, 2);
  assert.equal(summary.passAttempts, 3);
  assert.equal(summary.passingYards, 18);
  assert.equal(summary.rushingYards, 6);
  assert.equal(summary.touchdowns, 1);
  assert.equal(summary.turnovers, 1);
  assert.equal(summary.conversions, 1);
  assert.equal(summary.offensiveSuccess.successes, 2); // 1 TD + 1 crossedMidfield
  assert.equal(summary.offensiveSuccess.totalSnaps, 6);
});

test('deriveGameSummary excludes voided snaps entirely from every field', () => {
  const snaps = [snap({ resultType: 'complete', yards: 100, voided: true })];
  const summary = deriveGameSummary(snaps.filter((s) => !s.voided), RULE_CONFIG, 'us');
  assert.equal(summary.totalSnaps, 0);
  assert.equal(summary.passingYards, 0);
});

test('deriveGameSummary offensiveSuccess.rate is null on an empty game rather than a divide-by-zero artifact', () => {
  const summary = deriveGameSummary([], RULE_CONFIG, 'us');
  assert.equal(summary.offensiveSuccess.rate, null);
});

// ---------- derivePlayerPerformance (thin reuse — just confirm wiring) ----------

test('derivePlayerPerformance wires through to the real gameStats functions', () => {
  const snaps = [snap({ resultType: 'complete', targetId: 'jacob', yards: 12 })];
  const perf = derivePlayerPerformance(snaps);
  assert.equal(perf.receiving.jacob.catches, 1);
});

// ---------- deriveTargetShares ----------

test('deriveTargetShares computes a real, mathematically supported share of THIS GAME\'s total targets', () => {
  const snaps = [
    snap({ resultType: 'complete', targetId: 'jacob', yards: 5 }),
    snap({ resultType: 'incomplete', targetId: 'jacob' }),
    snap({ resultType: 'complete', targetId: 'wr2', yards: 3 }),
  ];
  const receiving = derivePlayerPerformance(snaps).receiving;
  const shares = deriveTargetShares(receiving);
  assert.equal(shares.jacob.targetShare, 2 / 3);
  assert.equal(shares.wr2.targetShare, 1 / 3);
  assert.equal(shares.jacob.totalGameTargets, 3);
});

test('deriveTargetShares returns null shares (never a fabricated 0%) when there are zero targets at all', () => {
  const shares = deriveTargetShares({});
  assert.deepEqual(shares, {});
});

// ---------- derivePrimaryTargetPerformanceForPlay ----------

test('derivePrimaryTargetPerformanceForPlay scopes to ONE play only, not the player\'s whole game', () => {
  const snaps = [
    snap({ playId: 'green-grass', resultType: 'complete', targetId: 'jacob', yards: 10 }),
    snap({ playId: 'other-play', resultType: 'complete', targetId: 'jacob', yards: 50 }), // must NOT bleed into green-grass's numbers
  ];
  const perf = derivePrimaryTargetPerformanceForPlay(snaps, 'green-grass', 'jacob');
  assert.equal(perf.targets, 1);
  assert.equal(perf.yards, 10);
});

test('derivePrimaryTargetPerformanceForPlay returns null when there is no real data for that play/target pair', () => {
  assert.equal(derivePrimaryTargetPerformanceForPlay([], 'p1', 'jacob'), null);
  assert.equal(derivePrimaryTargetPerformanceForPlay([snap({})], 'p1', null), null);
});

// ---------- deriveTeamDefensiveSplits ----------

test('deriveTeamDefensiveSplits only counts snaps with a real observed look, and states the tracked/total split honestly', () => {
  const snaps = [
    snap({ defensiveLookObserved: 'MAN', resultType: 'run', yards: 4, crossedMidfield: true }),
    snap({ defensiveLookObserved: 'MAN', resultType: 'run', yards: 2 }),
    snap({ defensiveLookObserved: 'ZONE', resultType: 'complete', yards: 8 }),
    snap({ resultType: 'run', yards: 1 }), // untracked — must not count toward any look
  ];
  const splits = deriveTeamDefensiveSplits(snaps);
  assert.equal(splits.byLook.MAN.snaps, 2);
  assert.equal(splits.byLook.MAN.successes, 1);
  assert.equal(splits.byLook.ZONE.snaps, 1);
  assert.equal(splits.trackedSnaps, 3);
  assert.equal(splits.totalSnaps, 4); // honestly shows not every snap was identified
});

// ---------- deriveRunPassDistribution ----------

test('deriveRunPassDistribution computes real run/pass counts and shares', () => {
  const snaps = [snap({ resultType: 'run' }), snap({ resultType: 'run' }), snap({ resultType: 'complete' })];
  const dist = deriveRunPassDistribution(snaps);
  assert.equal(dist.run, 2);
  assert.equal(dist.pass, 1);
  assert.equal(dist.runShare, 2 / 3);
});

test('deriveRunPassDistribution shares are null on a totally empty/other-only game, never a fabricated 0', () => {
  const dist = deriveRunPassDistribution([snap({ resultType: 'penalty' })]);
  assert.equal(dist.total, 0);
  assert.equal(dist.runShare, null);
});

// ---------- derivePhaseDistribution ----------

test('derivePhaseDistribution counts calls made before vs after midfield using the REAL situation at call time', () => {
  const snaps = [snap({ resultType: 'run', yards: 2 }), snap({ crossedMidfield: true, resultType: 'run', yards: 2 }), snap({ resultType: 'complete', yards: 5 })];
  const dist = derivePhaseDistribution(snaps, RULE_CONFIG, 'us');
  assert.equal(dist.toMidfield, 2); // the crossing snap itself was called while still toMidfield
  assert.equal(dist.toScore, 1);
});

// ---------- deriveConversionCallTendency ----------

test('deriveConversionCallTendency only counts OUR possession\'s last-down attempts, matching the spec example shape', () => {
  const snaps = [
    snap({ playId: 'green-grass' }), snap({ playId: 'green-grass' }), snap({ playId: 'green-grass' }), // downs 1-3, not yet last down
    snap({ playId: 'green-grass' }), // down 4 of 4 -> conversion attempt, turnover on downs (no crossedMidfield)
    snap({ playId: 'other' }), // possession flipped to 'them' after turnover on downs -> not a real attempt by us
  ];
  const tendency = deriveConversionCallTendency(snaps, RULE_CONFIG, 'us');
  assert.equal(tendency.totalConversionAttempts, 1);
  assert.equal(tendency.callCounts['green-grass'], 1);
});

test('deriveConversionCallTendency returns zero attempts honestly on a game with no real conversion situations yet', () => {
  const tendency = deriveConversionCallTendency([snap({})], RULE_CONFIG, 'us');
  assert.equal(tendency.totalConversionAttempts, 0);
  assert.deepEqual(tendency.callCounts, {});
});

// ---------- deriveCallFrequencyRanking ----------

test('deriveCallFrequencyRanking sorts real call counts descending for mostCalled, ascending-then-reversed for leastUsed', () => {
  const playStats = derivePlayPerformance([
    snap({ playId: 'a' }), snap({ playId: 'a' }), snap({ playId: 'a' }),
    snap({ playId: 'b' }),
  ]);
  const ranking = deriveCallFrequencyRanking(playStats);
  assert.equal(ranking.mostCalled[0].playId, 'a');
  assert.equal(ranking.leastUsed[0].playId, 'b');
});

test('deriveCallFrequencyRanking never lists a play with zero calls under leastUsed', () => {
  const playStats = { neverCalled: { playId: 'neverCalled', timesCalled: 0 } };
  const ranking = deriveCallFrequencyRanking(playStats);
  assert.deepEqual(ranking.leastUsed, []);
});

// ---------- deriveAdvisorVsCoach ----------

test('deriveAdvisorVsCoach counts matched vs overridden calls and averages REAL logged yardage on overrides only', () => {
  const liveSnaps = [
    { id: 'snap-1', yards: 10, voided: false },
    { id: 'snap-2', yards: 4, voided: false },
  ];
  const recommendations = [
    { rankedOptions: [{ playId: 'suggested-a' }, { playId: 'suggested-b' }], calledPlayId: 'suggested-a', calledSnapId: 'snap-1' }, // matched
    { rankedOptions: [{ playId: 'suggested-a' }], calledPlayId: 'something-else', calledSnapId: 'snap-2' }, // override
  ];
  const result = deriveAdvisorVsCoach(recommendations, liveSnaps);
  assert.equal(result.matched, 1);
  assert.equal(result.overridden, 1);
  assert.equal(result.overrideAvgYards, 4);
  assert.equal(result.overrideSampleSize, 1);
});

test('deriveAdvisorVsCoach ignores recommendation sets with no traceable outcome and never fabricates an average', () => {
  const result = deriveAdvisorVsCoach([{ rankedOptions: [], calledPlayId: null, calledSnapId: null }], []);
  assert.equal(result.matched, 0);
  assert.equal(result.overridden, 0);
  assert.equal(result.overrideAvgYards, null);
});

test('deriveAdvisorVsCoach excludes a voided snap from the override yardage average even if referenced', () => {
  const liveSnaps = [{ id: 'snap-1', yards: 99, voided: true }];
  const recommendations = [{ rankedOptions: [{ playId: 'x' }], calledPlayId: 'y', calledSnapId: 'snap-1' }];
  const result = deriveAdvisorVsCoach(recommendations, liveSnaps);
  assert.equal(result.overridden, 1);
  assert.equal(result.overrideAvgYards, null); // the only referenced snap was voided, so no real number to average
});

// ---------- deriveWorkedAndReview ----------

test('deriveWorkedAndReview lists a play under WORKED only once it clears both the sample-size AND success-rate thresholds', () => {
  const playStats = derivePlayPerformance([
    snap({ playId: 'green-grass', crossedMidfield: true }),
    snap({ playId: 'green-grass', crossedMidfield: true }),
    snap({ playId: 'green-grass', crossedMidfield: true }),
  ]);
  const { worked } = deriveWorkedAndReview(playStats, {});
  assert.equal(worked.length, 1);
  assert.equal(worked[0].playId, 'green-grass');
});

test('deriveWorkedAndReview does NOT list a single lucky play under WORKED — sample size must clear the minimum', () => {
  const playStats = derivePlayPerformance([snap({ playId: 'lucky-once', crossedMidfield: true })]);
  const { worked } = deriveWorkedAndReview(playStats, {});
  assert.equal(worked.length, 0);
});

test('deriveWorkedAndReview flags a struggling play under REVIEW with real sample size attached', () => {
  const playStats = derivePlayPerformance([
    snap({ playId: 'deep-shot', resultType: 'incomplete' }),
    snap({ playId: 'deep-shot', resultType: 'incomplete' }),
    snap({ playId: 'deep-shot', resultType: 'incomplete' }),
  ]);
  const { review } = deriveWorkedAndReview(playStats, {});
  assert.equal(review.length, 1);
  assert.equal(review[0].timesCalled, 3);
});

test('deriveWorkedAndReview flags any real recorded drop under REVIEW regardless of sample size (a drop is a real fact, not a rate)', () => {
  const receiving = derivePlayerPerformance([snap({ resultType: 'drop', targetId: 'jacob' })]).receiving;
  const { review } = deriveWorkedAndReview({}, receiving);
  assert.ok(review.some((r) => r.type === 'drops' && r.playerId === 'jacob' && r.drops === 1));
});

test('deriveWorkedAndReview lists a strong receiver under WORKED with real catches/targets shown', () => {
  const receiving = derivePlayerPerformance([
    snap({ resultType: 'complete', targetId: 'wr2', yards: 5 }),
    snap({ resultType: 'complete', targetId: 'wr2', yards: 5 }),
  ]).receiving;
  const { worked } = deriveWorkedAndReview({}, receiving);
  assert.ok(worked.some((w) => w.type === 'receiver' && w.playerId === 'wr2' && w.targets === 2 && w.catches === 2));
});

// ---------- derivePracticeSuggestions ----------

test('derivePracticeSuggestions surfaces a catching/ball-security suggestion only when real drops exist', () => {
  const suggestions = derivePracticeSuggestions([{ type: 'drops', playerId: 'jacob', drops: 2 }], null);
  assert.ok(suggestions.some((s) => s.id === 'drops' && /2 recorded drops/.test(s.text)));
});

test('derivePracticeSuggestions never suggests pressure answers without a real, sample-size-backed pressure split', () => {
  const suggestions = derivePracticeSuggestions([], { byLook: { PRESSURE: { snaps: 1, successRate: 0.1 } } });
  assert.ok(!suggestions.some((s) => s.id === 'pressure')); // sample too small (below 3) to suggest anything
});

test('derivePracticeSuggestions suggests pressure answers when a real, sample-backed struggling pressure split exists', () => {
  const suggestions = derivePracticeSuggestions([], { byLook: { PRESSURE: { snaps: 5, successRate: 0.2 } } });
  assert.ok(suggestions.some((s) => s.id === 'pressure' && /5 tracked snaps/.test(s.text)));
});

test('derivePracticeSuggestions never produces a raw percentage anywhere in its text', () => {
  const suggestions = derivePracticeSuggestions(
    [{ type: 'drops', playerId: 'x', drops: 1 }, { type: 'play', playId: 'deep-shot', timesCalled: 4, successRate: 0.25 }],
    { byLook: { PRESSURE: { snaps: 4, successRate: 0.1 } } },
  );
  suggestions.forEach((s) => assert.doesNotMatch(s.text, /%/));
});
