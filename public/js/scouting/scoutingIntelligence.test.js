import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTotalTrackedCount, deriveTodayLookCounts, deriveRecentLookSequence,
  describeSampleConfidence, compareScoutingToObserved, buildScoutingReasonText,
  scoutSuggestsPressureAnswer,
} from './scoutingIntelligence.js';

function snap(look, voided = false) {
  return { defensiveLookObserved: look, voided };
}

test('deriveTotalTrackedCount only counts snaps with a real observation tagged', () => {
  const snaps = [snap('MAN'), snap(null), snap('ZONE'), snap(undefined)];
  assert.equal(deriveTotalTrackedCount(snaps), 2);
});

test('deriveTotalTrackedCount excludes voided snaps even if they have an observation', () => {
  const snaps = [snap('MAN'), snap('ZONE', true)];
  assert.equal(deriveTotalTrackedCount(snaps), 1);
});

test('deriveTodayLookCounts tallies every distinct observed value honestly, not just the 3 core looks', () => {
  const snaps = [snap('MAN'), snap('MAN'), snap('SOFT'), snap('ZONE')];
  const counts = deriveTodayLookCounts(snaps);
  assert.deepEqual(counts, { MAN: 2, SOFT: 1, ZONE: 1 });
});

test('deriveTodayLookCounts on an empty/no-observation game returns an empty object, never fabricated zeros', () => {
  assert.deepEqual(deriveTodayLookCounts([snap(null), snap(null)]), {});
  assert.deepEqual(deriveTodayLookCounts([]), {});
});

test('deriveRecentLookSequence returns only tracked snaps, in order, skipping untracked ones', () => {
  const snaps = [snap('MAN'), snap(null), snap('ZONE'), snap('MAN'), snap('PRESSURE'), snap('MAN'), snap('ZONE')];
  assert.deepEqual(deriveRecentLookSequence(snaps, 5), ['ZONE', 'MAN', 'PRESSURE', 'MAN', 'ZONE']);
});

test('deriveRecentLookSequence returns fewer than N if fewer tracked snaps exist', () => {
  assert.deepEqual(deriveRecentLookSequence([snap('MAN')], 5), ['MAN']);
});

test('describeSampleConfidence flags a small nonzero sample as LIMITED SAMPLE', () => {
  assert.equal(describeSampleConfidence(2), 'LIMITED SAMPLE');
  assert.equal(describeSampleConfidence(1), 'LIMITED SAMPLE');
});

test('describeSampleConfidence does not flag zero (nothing to be limited about) or a healthy sample', () => {
  assert.equal(describeSampleConfidence(0), null);
  assert.equal(describeSampleConfidence(5), null);
});

test('compareScoutingToObserved returns no_scouting when there is no pregame baseLook and nothing observed', () => {
  assert.deepEqual(compareScoutingToObserved(null, {}), { status: 'no_scouting' });
});

test('compareScoutingToObserved returns insufficient_data below the comparison threshold even with a real pregame look', () => {
  const result = compareScoutingToObserved('MAN', { MAN: 2 });
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.totalTracked, 2);
});

test('compareScoutingToObserved reports conflict when today\'s dominant look genuinely differs from pregame scouting', () => {
  const result = compareScoutingToObserved('MAN', { ZONE: 6, MAN: 2 });
  assert.deepEqual(result, { status: 'conflict', pregame: 'MAN', observed: 'ZONE', observedCount: 6, totalTracked: 8 });
});

test('compareScoutingToObserved reports consistent when today agrees with pregame scouting', () => {
  const result = compareScoutingToObserved('MAN', { MAN: 5, ZONE: 1 });
  assert.deepEqual(result, { status: 'consistent', dominant: 'MAN', dominantCount: 5, totalTracked: 6 });
});

test('compareScoutingToObserved never lets SOFT/TIGHT/etc counts skew the MAN/ZONE/PRESSURE comparison', () => {
  const result = compareScoutingToObserved('MAN', { MAN: 3, SOFT: 10 });
  assert.equal(result.status, 'consistent');
  assert.equal(result.totalTracked, 3); // SOFT never counted toward the denominator
});

test('compareScoutingToObserved treats a MIXED_UNKNOWN pregame look as no real assumption to compare against', () => {
  const result = compareScoutingToObserved('MIXED_UNKNOWN', { MAN: 5, ZONE: 2 });
  assert.equal(result.status, 'insufficient_data');
});

test('buildScoutingReasonText for a conflict states both sides with real counts, matching the exact spec example shape', () => {
  const text = buildScoutingReasonText({ status: 'conflict', pregame: 'MAN', observed: 'ZONE', observedCount: 6, totalTracked: 8 });
  assert.equal(text, 'Pregame scouting suggested Man, but Zone has been observed on 6 of the last 8 tracked snaps.');
});

test('buildScoutingReasonText for consistent cites real counts too, never just "confirmed"', () => {
  const text = buildScoutingReasonText({ status: 'consistent', dominant: 'MAN', dominantCount: 4, totalTracked: 5 });
  assert.equal(text, "Pregame scouting and today's snaps agree on Man (4 of 5 tracked snaps).");
});

test('buildScoutingReasonText for no_scouting or zero insufficient_data returns null rather than a hollow sentence', () => {
  assert.equal(buildScoutingReasonText({ status: 'no_scouting' }), null);
  assert.equal(buildScoutingReasonText({ status: 'insufficient_data', totalTracked: 0 }), null);
  assert.equal(buildScoutingReasonText(null), null);
});

test('buildScoutingReasonText for a nonzero-but-thin sample is honest about the sample size, not a verdict', () => {
  const text = buildScoutingReasonText({ status: 'insufficient_data', totalTracked: 2 });
  assert.match(text, /Only 2 tracked snaps so far/);
});

test('scoutSuggestsPressureAnswer is true when pregame baseLook is PRESSURE', () => {
  assert.equal(scoutSuggestsPressureAnswer({ pregameTendencies: { baseLook: 'PRESSURE' } }), true);
});

test('scoutSuggestsPressureAnswer is true when HEAVY_RUSH tendency tag is present', () => {
  assert.equal(scoutSuggestsPressureAnswer({ pregameTendencies: { baseLook: 'MAN', tendencyTags: ['HEAVY_RUSH'] } }), true);
});

test('scoutSuggestsPressureAnswer is true for an aggressive/fast/contains-QB rusher tag', () => {
  assert.equal(scoutSuggestsPressureAnswer({ pregameTendencies: { rusherTags: ['FAST_RUSHER'] } }), true);
  assert.equal(scoutSuggestsPressureAnswer({ pregameTendencies: { rusherTags: ['DISCIPLINED'] } }), false);
});

test('scoutSuggestsPressureAnswer is false for a scout with no pressure-relevant signal, and never throws on missing data', () => {
  assert.equal(scoutSuggestsPressureAnswer({ pregameTendencies: { baseLook: 'ZONE' } }), false);
  assert.equal(scoutSuggestsPressureAnswer(null), false);
  assert.equal(scoutSuggestsPressureAnswer({}), false);
});
