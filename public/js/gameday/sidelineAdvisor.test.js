import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPlayCalls, QUICK_FILTERS } from './sidelineAdvisor.js';

function play(id, overrides = {}) {
  return { id, name: id, side: 'offense', category: 'pass', tags: {}, intent: {}, favorite: false, ...overrides };
}

function makePlaysById(plays, versions = {}) {
  const byId = {};
  plays.forEach((p) => { byId[p.id] = { play: p, version: versions[p.id] || { assignments: {} } }; });
  return byId;
}

function entriesFor(plays) {
  return plays.map((p, i) => ({ playId: p.id, order: i, isCore: false }));
}

const gameState = { possession: 'us', phase: 'toMidfield', down: 1, score: { us: 0, them: 0 } };

test('returns only offense plays from the Game Plan, never defense or anything outside it', () => {
  const plays = [play('p1'), play('p2', { side: 'defense' })];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [] });
  assert.deepEqual(result.map((r) => r.playId), ['p1']);
});

test('returns between 2 and 4 candidates by default when the plan has more', () => {
  const plays = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id) => play(id));
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [] });
  assert.equal(result.length, 4);
});

test('returns fewer than 4 if the Game Plan itself has fewer offense plays', () => {
  const plays = [play('p1')];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [] });
  assert.equal(result.length, 1);
});

test('every candidate carries a real, non-fabricated confidence level based on sample size', () => {
  const plays = [play('p1'), play('p2')];
  const snaps = [
    { playId: 'p1', resultType: 'run', yards: 4, crossedMidfield: true, voided: false },
    { playId: 'p1', resultType: 'run', yards: 3, crossedMidfield: false, voided: false },
    { playId: 'p1', resultType: 'run', yards: 5, crossedMidfield: true, voided: false },
  ];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [] });
  const p1 = result.find((r) => r.playId === 'p1');
  const p2 = result.find((r) => r.playId === 'p2');
  assert.equal(p1.confidence, 'HIGH'); // called 3x this game
  assert.equal(p2.confidence, 'LIMITED'); // never called, no observation data
});

test('repetition: a play called on every recent snap is penalized and says so in its reasons', () => {
  const plays = [play('p1'), play('p2')];
  const snaps = [
    { playId: 'p1', resultType: 'run', yards: 4, voided: false },
    { playId: 'p1', resultType: 'run', yards: 4, voided: false },
    { playId: 'p1', resultType: 'run', yards: 4, voided: false },
  ];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [] });
  const p1 = result.find((r) => r.playId === 'p1');
  const p2 = result.find((r) => r.playId === 'p2');
  assert.ok(p1.reasons.some((r) => /Called 3 of last 3 snaps/.test(r)));
  assert.ok(p2.score > p1.score, 'a fresh, never-called play should outrank one just spammed 3 straight times');
});

test('a play called earlier but not recently says "not called in last N snaps", not "never called"', () => {
  const plays = [play('p1')];
  const snaps = [
    { playId: 'p1', resultType: 'run', yards: 4, voided: false },
    { playId: 'other', resultType: 'run', yards: 4, voided: false },
    { playId: 'other', resultType: 'run', yards: 4, voided: false },
    { playId: 'other', resultType: 'run', yards: 4, voided: false },
    { playId: 'other', resultType: 'run', yards: 4, voided: false },
    { playId: 'other', resultType: 'run', yards: 4, voided: false },
    { playId: 'other', resultType: 'run', yards: 4, voided: false },
  ];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [] });
  assert.ok(result[0].reasons.some((r) => /Not called in last 6 snaps/.test(r)));
});

test('a play never called this game says so explicitly, distinct from "not called recently"', () => {
  const plays = [play('p1')];
  const snaps = [{ playId: 'other', resultType: 'run', yards: 4, voided: false }];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [] });
  assert.ok(result[0].reasons.some((r) => r === 'Not called yet this game'));
});

test('voided snaps are fully excluded from repetition, performance, and sample-size calculations', () => {
  const plays = [play('p1')];
  const snaps = [
    { playId: 'p1', resultType: 'run', yards: 4, voided: true },
    { playId: 'p1', resultType: 'run', yards: 4, voided: true },
  ];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [] });
  assert.equal(result[0].confidence, 'LIMITED');
  assert.ok(result[0].reasons.some((r) => /Not called yet this game/.test(r)));
});

test('defensive-look fit: a play tagged beatsMan is boosted and explained when MAN was the recent observation', () => {
  const plays = [play('p1', { tags: { beatsMan: true } }), play('p2')];
  const snaps = [
    { playId: 'p2', resultType: 'run', yards: 2, defensiveLookObserved: 'MAN', voided: false },
    { playId: 'p2', resultType: 'run', yards: 2, defensiveLookObserved: 'MAN', voided: false },
  ];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [] });
  const p1 = result.find((r) => r.playId === 'p1');
  assert.ok(p1.reasons.some((r) => /Strong vs MAN/.test(r)));
});

test('a play tagged beatsZone gets no defensive-look boost when the observed look is MAN', () => {
  const plays = [play('p1', { tags: { beatsZone: true } }), play('p2', { tags: { beatsMan: true } })];
  const snaps = [{ playId: 'other', resultType: 'run', yards: 2, defensiveLookObserved: 'MAN', voided: false }];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [] });
  const p2 = result.find((r) => r.playId === 'p2');
  const p1 = result.find((r) => r.playId === 'p1');
  assert.ok(p2.score > p1.score);
});

test('player performance surfaces real numbers for the designed primary target, never a blanket verdict', () => {
  const plays = [play('p1', { intent: { primaryTargetSlot: 'WR1' } })];
  const versions = { p1: { assignments: {} } };
  const snaps = [
    { playId: 'p1', resultType: 'complete', targetId: 'jacob', yards: 5, voided: false },
    { playId: 'p1', resultType: 'drop', targetId: 'jacob', yards: 0, voided: false },
    { playId: 'p1', resultType: 'drop', targetId: 'jacob', yards: 0, voided: false },
  ];
  const weeklyRoles = { offense: { WR1: 'jacob' }, defense: {} };
  const players = [{ id: 'jacob', firstName: 'Jacob' }];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays, versions), snaps, weeklyRoles, players });
  assert.ok(result[0].reasons.some((r) => r === 'Jacob is 1/3 today with 2 recorded drops'));
});

test('player performance never states a judgment sentence like "stop throwing to X" — only real counted numbers', () => {
  const plays = [play('p1', { intent: { primaryTargetSlot: 'WR1' } })];
  const snaps = [
    { playId: 'p1', resultType: 'drop', targetId: 'jacob', yards: 0, voided: false },
    { playId: 'p1', resultType: 'drop', targetId: 'jacob', yards: 0, voided: false },
  ];
  const weeklyRoles = { offense: { WR1: 'jacob' }, defense: {} };
  const players = [{ id: 'jacob', firstName: 'Jacob' }];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles, players });
  result.forEach((r) => r.reasons.forEach((reason) => {
    assert.doesNotMatch(reason, /stop|never throw|bench/i);
  }));
});

test('ball carrier rushing performance surfaces real yards-per-carry with the sample size stated', () => {
  const versions = { p1: { assignments: { RB: { roleClassification: 'ball_carrier' } } } };
  const plays = [play('p1', { category: 'run' })];
  const snaps = [
    { playId: 'p1', resultType: 'run', ballCarrierId: 'amani', yards: 8, voided: false },
    { playId: 'p1', resultType: 'run', ballCarrierId: 'amani', yards: 6, voided: false },
  ];
  const weeklyRoles = { offense: { RB: 'amani' }, defense: {} };
  const players = [{ id: 'amani', firstName: 'Amani' }];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays, versions), snaps, weeklyRoles, players });
  assert.ok(result[0].reasons.some((r) => /Amani averaging 7\.0 yds\/carry today \(2 carries\)/.test(r)));
});

test('quick filter RUN excludes pass plays entirely', () => {
  const plays = [play('p1', { category: 'run' }), play('p2', { category: 'pass' })];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [], filter: 'run' });
  assert.deepEqual(result.map((r) => r.playId), ['p1']);
});

test('quick filter SAFE only returns plays tagged safe', () => {
  const plays = [play('p1', { tags: { safe: true } }), play('p2')];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [], filter: 'safe' });
  assert.deepEqual(result.map((r) => r.playId), ['p1']);
});

test('quick filter NOT_CALLED_YET only returns plays with zero snaps this game', () => {
  const plays = [play('p1'), play('p2')];
  const snaps = [{ playId: 'p1', resultType: 'run', yards: 2, voided: false }];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [], filter: 'not_called_yet' });
  assert.deepEqual(result.map((r) => r.playId), ['p2']);
});

test('quick filter that matches nothing returns an empty list rather than falling back to unfiltered', () => {
  const plays = [play('p1', { category: 'pass' })];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [], filter: 'run' });
  assert.deepEqual(result, []);
});

test('re-ranking with a different filter is a pure re-derivation — same inputs, same filter, same output', () => {
  const plays = [play('p1', { category: 'run' }), play('p2', { category: 'pass' })];
  const args = { gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [], filter: 'run' };
  const a = rankPlayCalls(args);
  const b = rankPlayCalls(args);
  assert.deepEqual(a, b);
});

test('coach favorite / core call gets a modest, explicit boost but never dominates repetition penalty', () => {
  const plays = [play('p1', { favorite: true }), play('p2')];
  const snaps = [
    { playId: 'p1', resultType: 'run', yards: 2, voided: false },
    { playId: 'p1', resultType: 'run', yards: 2, voided: false },
    { playId: 'p1', resultType: 'run', yards: 2, voided: false },
  ];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [] });
  const p1 = result.find((r) => r.playId === 'p1');
  const p2 = result.find((r) => r.playId === 'p2');
  assert.ok(p2.score > p1.score, 'favorite status alone should not overcome heavy recent repetition');
});

test('reasons are always short — capped at 3 per candidate, sideline-glanceable not an essay', () => {
  const versions = { p1: { assignments: { RB: { roleClassification: 'ball_carrier' } } } };
  const plays = [play('p1', { category: 'run', tags: { beatsMan: true, conversion: true }, favorite: true, intent: { primaryTargetSlot: 'WR1' } })];
  const weeklyRoles = { offense: { WR1: 'jacob', RB: 'amani' }, defense: {} };
  const players = [{ id: 'jacob', firstName: 'Jacob' }, { id: 'amani', firstName: 'Amani' }];
  const snaps = [
    { playId: 'p1', resultType: 'complete', targetId: 'jacob', yards: 5, crossedMidfield: true, defensiveLookObserved: 'MAN', voided: false },
    { playId: 'p1', resultType: 'run', ballCarrierId: 'amani', yards: 4, voided: false },
  ];
  const lateDownState = { ...gameState, down: 3 };
  const result = rankPlayCalls({ gameState: lateDownState, entries: entriesFor(plays), playsById: makePlaysById(plays, versions), snaps, weeklyRoles, players });
  assert.ok(result[0].reasons.length <= 3);
});

test('confidence stays MEDIUM (not HIGH) on a single call even with a big single gain — sample size matters, not magnitude', () => {
  const plays = [play('p1')];
  const snaps = [{ playId: 'p1', resultType: 'run', yards: 40, touchdown: true, voided: false }];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [] });
  assert.equal(result[0].confidence, 'MEDIUM');
});

test('exports QUICK_FILTERS matching the exact chip set from the spec', () => {
  const values = QUICK_FILTERS.map((f) => f.value);
  assert.deepEqual(values, ['run', 'pass', 'safe', 'shot', 'beat_man', 'beat_zone', 'beat_pressure', 'not_called_yet']);
});

// ---------- Opponent Scouting integration ----------

test('with no scout provided, behavior is unchanged — no scouting reason ever appears', () => {
  const plays = [play('p1', { tags: { beatsMan: true } })];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [] });
  result.forEach((r) => r.reasons.forEach((reason) => assert.doesNotMatch(reason, /scouting|Pregame/i)));
});

test('pregame-only scouting boosts a matching play when there is zero live observation data yet', () => {
  const plays = [play('p1', { tags: { beatsMan: true } }), play('p2')];
  const scout = { pregameTendencies: { baseLook: 'MAN' } };
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [], scout });
  const p1 = result.find((r) => r.playId === 'p1');
  assert.ok(p1.reasons.some((r) => /Pregame scouting: opponent tends toward Man/.test(r)));
});

test('a MIXED_UNKNOWN pregame baseLook never boosts anything or produces a reason', () => {
  const plays = [play('p1', { tags: { beatsMan: true, beatsZone: true, beatsPressure: true } })];
  const scout = { pregameTendencies: { baseLook: 'MIXED_UNKNOWN' } };
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [], scout });
  result[0].reasons.forEach((reason) => assert.doesNotMatch(reason, /Pregame scouting/));
});

test('once enough live snaps confirm pregame scouting, the reason states real counts (consistent case)', () => {
  const plays = [play('p1', { tags: { beatsMan: true } })];
  const scout = { pregameTendencies: { baseLook: 'MAN' } };
  const snaps = [
    { playId: 'other', resultType: 'run', yards: 2, defensiveLookObserved: 'MAN', voided: false },
    { playId: 'other', resultType: 'run', yards: 2, defensiveLookObserved: 'MAN', voided: false },
    { playId: 'other', resultType: 'run', yards: 2, defensiveLookObserved: 'MAN', voided: false },
  ];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [], scout });
  assert.ok(result[0].reasons.some((r) => r === "Pregame scouting and today's snaps agree on Man (3 of 3 tracked snaps)."));
});

test('when live observation genuinely CONTRADICTS pregame scouting, real evidence wins — the operative look flips', () => {
  const plays = [play('p1', { tags: { beatsZone: true } }), play('p2', { tags: { beatsMan: true } })];
  const scout = { pregameTendencies: { baseLook: 'MAN' } };
  const snaps = [
    { playId: 'other', resultType: 'run', yards: 2, defensiveLookObserved: 'ZONE', voided: false },
    { playId: 'other', resultType: 'run', yards: 2, defensiveLookObserved: 'ZONE', voided: false },
    { playId: 'other', resultType: 'run', yards: 2, defensiveLookObserved: 'MAN', voided: false },
  ];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [], scout });
  const p1 = result.find((r) => r.playId === 'p1'); // beatsZone
  const p2 = result.find((r) => r.playId === 'p2'); // beatsMan (matches stale pregame scouting)
  assert.ok(p1.score > p2.score, 'the play that beats the OBSERVED look should outrank the one matching only stale pregame scouting');
  assert.ok(p1.reasons.some((r) => /Pregame scouting suggested Man, but Zone has been observed on 2 of the last 3 tracked snaps\./.test(r)));
});

test('the conflict reason sentence never appears until the live sample meets the minimum threshold', () => {
  const plays = [play('p1', { tags: { beatsZone: true } })];
  const scout = { pregameTendencies: { baseLook: 'MAN' } };
  const snaps = [{ playId: 'other', resultType: 'run', yards: 2, defensiveLookObserved: 'ZONE', voided: false }];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [], scout });
  result[0].reasons.forEach((reason) => assert.doesNotMatch(reason, /but Zone has been observed/));
});

test('pressure-answer connection boosts a beatsPressure play when scouting flags an aggressive/fast rusher', () => {
  const plays = [play('p1', { tags: { beatsPressure: true } }), play('p2')];
  const scout = { pregameTendencies: { rusherTags: ['FAST_RUSHER'] } };
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [], scout });
  const p1 = result.find((r) => r.playId === 'p1');
  assert.ok(p1.reasons.some((r) => /aggressive\/fast rusher — tagged to beat pressure/.test(r)));
});

test('pressure-answer connection never fires for a disciplined rusher with no other pressure signal', () => {
  const plays = [play('p1', { tags: { beatsPressure: true } })];
  const scout = { pregameTendencies: { rusherTags: ['DISCIPLINED'] } };
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps: [], weeklyRoles: {}, players: [], scout });
  result[0].reasons.forEach((reason) => assert.doesNotMatch(reason, /tagged to beat pressure/));
});

test('scouting integration never introduces a fabricated percentage anywhere in its reasons', () => {
  const plays = [play('p1', { tags: { beatsMan: true, beatsPressure: true } })];
  const scout = { pregameTendencies: { baseLook: 'MAN', rusherTags: ['AGGRESSIVE'] } };
  const snaps = [
    { playId: 'other', resultType: 'run', yards: 2, defensiveLookObserved: 'MAN', voided: false },
    { playId: 'other', resultType: 'run', yards: 2, defensiveLookObserved: 'MAN', voided: false },
    { playId: 'other', resultType: 'run', yards: 2, defensiveLookObserved: 'MAN', voided: false },
  ];
  const result = rankPlayCalls({ gameState, entries: entriesFor(plays), playsById: makePlaysById(plays), snaps, weeklyRoles: {}, players: [], scout });
  result[0].reasons.forEach((reason) => assert.doesNotMatch(reason, /%/));
});
