'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildUserPrompt, extractJsonObject, sanitizeExplanations, containsOnlyKnownNumbers, validateCandidates,
} = require('../netlify/functions/sidelineAdvisorExplain');

test('containsOnlyKnownNumbers allows a sentence using only numbers present in the allowed set', () => {
  assert.equal(containsOnlyKnownNumbers('3 of the last 6 snaps used this', ['3', '6']), true);
});

test('containsOnlyKnownNumbers rejects a sentence with a fabricated number', () => {
  assert.equal(containsOnlyKnownNumbers('This play works 85% of the time', ['3', '6']), false);
});

test('containsOnlyKnownNumbers rejects any invented percentage even if unrelated numbers are real', () => {
  assert.equal(containsOnlyKnownNumbers('3 carries so far, roughly 70% success', ['3']), false);
});

test('containsOnlyKnownNumbers allows a sentence with zero numbers regardless of the allowed set', () => {
  assert.equal(containsOnlyKnownNumbers('A safe, reliable call against this look', []), true);
});

test('sanitizeExplanations keeps an explanation whose only numbers came from the real reasons', () => {
  const candidates = [{ playId: 'p1', playName: 'Slant', reasons: ['3/4 successful in similar situations today'] }];
  const raw = { explanations: { p1: 'Worked 3 of 4 times in situations like this.' } };
  const result = sanitizeExplanations(raw, candidates, 'Down 3');
  assert.equal(result.p1, 'Worked 3 of 4 times in situations like this.');
});

test('sanitizeExplanations discards an explanation that invents a number not present anywhere in the input', () => {
  const candidates = [{ playId: 'p1', playName: 'Slant', reasons: ['3/4 successful in similar situations today'] }];
  const raw = { explanations: { p1: 'This play has an 85% success rate.' } };
  const result = sanitizeExplanations(raw, candidates, 'Down 3');
  assert.equal(result.p1, null);
});

test('sanitizeExplanations allows a number that only appears in the situation string, not the reasons', () => {
  const candidates = [{ playId: 'p1', playName: 'Slant', reasons: ['Not called yet this game'] }];
  const raw = { explanations: { p1: 'A fresh call on 3rd down.' } };
  const result = sanitizeExplanations(raw, candidates, '3rd down, need midfield');
  assert.equal(result.p1, 'A fresh call on 3rd down.');
});

test('sanitizeExplanations returns null for a candidate the model skipped entirely', () => {
  const candidates = [{ playId: 'p1', playName: 'Slant', reasons: ['Not called yet this game'] }];
  const raw = { explanations: {} };
  const result = sanitizeExplanations(raw, candidates, '');
  assert.equal(result.p1, null);
});

test('sanitizeExplanations returns null for every candidate on totally malformed input, never throws', () => {
  const candidates = [{ playId: 'p1', playName: 'Slant', reasons: [] }, { playId: 'p2', playName: 'Dive', reasons: [] }];
  assert.doesNotThrow(() => sanitizeExplanations(null, candidates, ''));
  const result = sanitizeExplanations(null, candidates, '');
  assert.equal(result.p1, null);
  assert.equal(result.p2, null);
});

test('sanitizeExplanations truncates an overly long explanation rather than rejecting it outright', () => {
  const candidates = [{ playId: 'p1', playName: 'Slant', reasons: ['safe call'] }];
  const longText = 'A very safe call '.repeat(20);
  const raw = { explanations: { p1: longText } };
  const result = sanitizeExplanations(raw, candidates, '');
  assert.ok(result.p1.length <= 160);
});

test('buildUserPrompt includes the situation and every candidate playId/name/confidence/reasons', () => {
  const candidates = [{ playId: 'p1', playName: 'Slant', confidence: 'HIGH', reasons: ['3/4 successful today'] }];
  const prompt = buildUserPrompt('3rd down, need midfield', candidates);
  assert.match(prompt, /3rd down, need midfield/);
  assert.match(prompt, /p1/);
  assert.match(prompt, /Slant/);
  assert.match(prompt, /HIGH/);
  assert.match(prompt, /3\/4 successful today/);
});

test('validateCandidates rejects an empty array', () => {
  assert.throws(() => validateCandidates([]));
});

test('validateCandidates rejects more than 4 candidates', () => {
  const candidates = Array.from({ length: 5 }, (_, i) => ({ playId: `p${i}`, playName: 'x', reasons: [] }));
  assert.throws(() => validateCandidates(candidates));
});

test('validateCandidates rejects a candidate missing required fields', () => {
  assert.throws(() => validateCandidates([{ playId: 'p1' }]));
});

test('validateCandidates accepts a well-formed 2-4 candidate list', () => {
  const candidates = [{ playId: 'p1', playName: 'Slant', reasons: ['x'] }, { playId: 'p2', playName: 'Dive', reasons: [] }];
  assert.doesNotThrow(() => validateCandidates(candidates));
});

test('extractJsonObject parses a bare JSON object unchanged', () => {
  const raw = '{"explanations":{"p1":"a"}}';
  assert.equal(JSON.parse(extractJsonObject(raw)).explanations.p1, 'a');
});

test('extractJsonObject strips a ```json markdown fence', () => {
  const raw = '```json\n{"explanations":{"p1":"a"}}\n```';
  assert.equal(JSON.parse(extractJsonObject(raw)).explanations.p1, 'a');
});

test('extractJsonObject falls back to slicing the first balanced {...} block when there is stray prose', () => {
  const raw = 'Here you go:\n{"explanations":{"p1":"a"}}\nEnjoy!';
  assert.equal(JSON.parse(extractJsonObject(raw)).explanations.p1, 'a');
});
