import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGameState, applyResult, deriveGameState, describeDown } from './gameStateEngine.js';

const RULES = { downsToMidfield: 4, downsAfterMidfieldToScore: 3 };

test('initialGameState defaults to us-possession, phase 1, down 1, 0-0', () => {
  const s = initialGameState();
  assert.deepEqual(s, { possession: 'us', phase: 'toMidfield', down: 1, score: { us: 0, them: 0 } });
});

test('initialGameState respects an explicit starting possession', () => {
  const s = initialGameState('them');
  assert.equal(s.possession, 'them');
});

test('applyResult never mutates the input state object', () => {
  const s = initialGameState();
  const frozenCopy = JSON.parse(JSON.stringify(s));
  applyResult(s, { type: 'incomplete' }, RULES);
  assert.deepEqual(s, frozenCopy);
});

test('incomplete pass advances the down without changing phase/possession/score', () => {
  const s = initialGameState();
  const next = applyResult(s, { type: 'incomplete' }, RULES);
  assert.equal(next.down, 2);
  assert.equal(next.phase, 'toMidfield');
  assert.equal(next.possession, 'us');
  assert.deepEqual(next.score, { us: 0, them: 0 });
});

test('a completed pass with no crossedMidfield flag still just advances the down', () => {
  const s = initialGameState();
  const next = applyResult(s, { type: 'complete', yards: 5 }, RULES);
  assert.equal(next.down, 2);
  assert.equal(next.phase, 'toMidfield');
});

test('crossedMidfield moves to toScore phase and resets down to 1', () => {
  const s = { ...initialGameState(), down: 3 };
  const next = applyResult(s, { type: 'run', yards: 8, crossedMidfield: true }, RULES);
  assert.equal(next.phase, 'toScore');
  assert.equal(next.down, 1);
  assert.equal(next.possession, 'us'); // possession does NOT change on a normal midfield crossing
});

test('crossedMidfield flag is ignored once already in toScore phase (no-op on phase)', () => {
  const s = { possession: 'us', phase: 'toScore', down: 2, score: { us: 0, them: 0 } };
  const next = applyResult(s, { type: 'run', yards: 5, crossedMidfield: true }, RULES);
  assert.equal(next.phase, 'toScore');
  assert.equal(next.down, 3); // normal down progression applies instead
});

test('turnover on downs: 4th down in toMidfield phase without crossing flips possession', () => {
  const s = { possession: 'us', phase: 'toMidfield', down: 4, score: { us: 0, them: 0 } };
  const next = applyResult(s, { type: 'incomplete' }, RULES);
  assert.equal(next.possession, 'them');
  assert.equal(next.phase, 'toMidfield');
  assert.equal(next.down, 1);
});

test('turnover on downs: 3rd down (max) in toScore phase without scoring flips possession', () => {
  const s = { possession: 'us', phase: 'toScore', down: 3, score: { us: 0, them: 0 } };
  const next = applyResult(s, { type: 'run', yards: 2 }, RULES);
  assert.equal(next.possession, 'them');
  assert.equal(next.phase, 'toMidfield');
  assert.equal(next.down, 1);
});

test('touchdown: scores 6, flips possession, resets to toMidfield down 1', () => {
  const s = { possession: 'us', phase: 'toScore', down: 2, score: { us: 6, them: 3 } };
  const next = applyResult(s, { type: 'run', yards: 4, touchdown: true }, RULES);
  assert.equal(next.score.us, 12);
  assert.equal(next.score.them, 3);
  assert.equal(next.possession, 'them');
  assert.equal(next.phase, 'toMidfield');
  assert.equal(next.down, 1);
});

test('touchdown on defense (them) scores for "them", not "us"', () => {
  const s = { possession: 'them', phase: 'toScore', down: 1, score: { us: 0, them: 0 } };
  const next = applyResult(s, { type: 'complete', yards: 10, touchdown: true }, RULES);
  assert.equal(next.score.them, 6);
  assert.equal(next.score.us, 0);
  assert.equal(next.possession, 'us');
});

test('touchdown flag takes priority over crossedMidfield if both are somehow set', () => {
  const s = initialGameState();
  const next = applyResult(s, { type: 'run', yards: 40, touchdown: true, crossedMidfield: true }, RULES);
  assert.equal(next.score.us, 6);
  assert.equal(next.possession, 'them');
});

test('explicit turnover (interception/fumble) flips possession immediately, any down', () => {
  const s = { possession: 'us', phase: 'toMidfield', down: 1, score: { us: 0, them: 0 } };
  const next = applyResult(s, { type: 'incomplete', turnover: true }, RULES);
  assert.equal(next.possession, 'them');
  assert.equal(next.phase, 'toMidfield');
  assert.equal(next.down, 1);
});

test('penalty replays the down by default — no down consumed, no phase change', () => {
  const s = { possession: 'us', phase: 'toMidfield', down: 2, score: { us: 0, them: 0 } };
  const next = applyResult(s, { type: 'penalty', yards: -5 }, RULES);
  assert.equal(next.down, 2);
  assert.equal(next.phase, 'toMidfield');
});

test('penalty can still cross midfield if explicitly marked', () => {
  const s = { possession: 'us', phase: 'toMidfield', down: 2, score: { us: 0, them: 0 } };
  const next = applyResult(s, { type: 'penalty', yards: 15, crossedMidfield: true }, RULES);
  assert.equal(next.phase, 'toScore');
  assert.equal(next.down, 1);
});

test('"other" with no crossedMidfield/touchdown/turnover flag is a pure no-op on down/phase', () => {
  const s = { possession: 'us', phase: 'toMidfield', down: 2, score: { us: 0, them: 0 } };
  const next = applyResult(s, { type: 'other' }, RULES);
  assert.deepEqual(next, s);
});

test('deriveGameState replays a full sequence of results correctly from scratch', () => {
  const results = [
    { type: 'incomplete' },              // us: toMidfield down 1 -> 2
    { type: 'run', yards: 6 },           // us: toMidfield down 2 -> 3
    { type: 'complete', yards: 12, crossedMidfield: true }, // us: toMidfield -> toScore, down 1
    { type: 'run', yards: 2, touchdown: true }, // us scores, flips to them
  ];
  const final = deriveGameState(results, RULES);
  assert.equal(final.score.us, 6);
  assert.equal(final.possession, 'them');
  assert.equal(final.phase, 'toMidfield');
  assert.equal(final.down, 1);
});

test('deriveGameState with an empty result list returns the plain initial state', () => {
  assert.deepEqual(deriveGameState([], RULES), initialGameState());
});

test('deriveGameState is what UNDO relies on: dropping the last result reproduces the prior state exactly', () => {
  const results = [
    { type: 'incomplete' },
    { type: 'run', yards: 6 },
    { type: 'complete', yards: 12, crossedMidfield: true },
  ];
  const beforeLast = deriveGameState(results.slice(0, 2), RULES);
  const afterLast = deriveGameState(results, RULES);
  assert.notDeepEqual(beforeLast, afterLast);
  // Simulating "undo" by dropping the last entry and re-deriving:
  const undone = deriveGameState(results.slice(0, -1), RULES);
  assert.deepEqual(undone, beforeLast);
});

test('describeDown produces a readable, config-driven label for toMidfield phase', () => {
  const s = { possession: 'us', phase: 'toMidfield', down: 2, score: { us: 0, them: 0 } };
  assert.equal(describeDown(s, RULES), '2nd down (of 4) to Midfield');
});

test('describeDown produces a readable label for toScore phase', () => {
  const s = { possession: 'us', phase: 'toScore', down: 1, score: { us: 0, them: 0 } };
  assert.equal(describeDown(s, RULES), '1st down (of 3) to Score');
});

test('describeDown respects a DIFFERENT ruleConfig (never hardcodes 4/3)', () => {
  const customRules = { downsToMidfield: 6, downsAfterMidfieldToScore: 2 };
  const s = { possession: 'us', phase: 'toScore', down: 2, score: { us: 0, them: 0 } };
  assert.equal(describeDown(s, customRules), '2nd down (of 2) to Score');
});

test('a full alternating-possession game sequence keeps scores and possession consistent', () => {
  const results = [
    { type: 'run', yards: 3, touchdown: true },       // us scores -> possession them
    { type: 'incomplete' },                            // them toMidfield 1->2
    { type: 'incomplete' },                            // them 2->3
    { type: 'incomplete' },                            // them 3->4
    { type: 'incomplete' },                            // them 4 -> turnover on downs -> us
    { type: 'complete', yards: 20, touchdown: true },  // us scores -> them
  ];
  const final = deriveGameState(results, RULES);
  assert.equal(final.score.us, 12);
  assert.equal(final.score.them, 0);
  assert.equal(final.possession, 'them');
});
