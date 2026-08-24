'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUserPrompt, extractJsonObject, containsOnlyKnownNumbers, sanitizeSummary } = require('../netlify/functions/postgameSummary');

test('containsOnlyKnownNumbers allows a summary that only uses numbers present in the allowed set', () => {
  assert.equal(containsOnlyKnownNumbers('Green Grass gained 8 yards on 5 calls', ['8', '5']), true);
});

test('containsOnlyKnownNumbers rejects a summary with any invented number', () => {
  assert.equal(containsOnlyKnownNumbers('Your offense converted 85% of the time', ['8', '5']), false);
});

test('sanitizeSummary keeps a summary whose only numbers come straight from the real input data', () => {
  const data = { worked: [{ playId: 'green-grass', timesCalled: 5, averageGain: 8.4 }] };
  const raw = { summary: 'Green Grass produced well across 5 calls, averaging 8.4 yards.' };
  assert.equal(sanitizeSummary(raw, data), 'Green Grass produced well across 5 calls, averaging 8.4 yards.');
});

test('sanitizeSummary rejects a summary that fabricates a number not anywhere in the real input data', () => {
  const data = { worked: [{ playId: 'green-grass', timesCalled: 5, averageGain: 8.4 }] };
  const raw = { summary: 'Your team converted on 92% of third downs.' };
  assert.equal(sanitizeSummary(raw, data), null);
});

test('sanitizeSummary rejects a missing, empty, or wrong-typed summary without throwing', () => {
  assert.equal(sanitizeSummary({}, {}), null);
  assert.equal(sanitizeSummary({ summary: '' }, {}), null);
  assert.equal(sanitizeSummary({ summary: 42 }, {}), null);
  assert.equal(sanitizeSummary(null, {}), null);
});

test('sanitizeSummary truncates an overly long summary rather than rejecting it outright', () => {
  const data = { note: 'safe' };
  const longText = 'Solid effort today. '.repeat(60);
  const result = sanitizeSummary({ summary: longText }, data);
  assert.ok(result.length <= 900);
});

test('buildUserPrompt includes the real postgame data as JSON', () => {
  const prompt = buildUserPrompt({ worked: [{ playId: 'green-grass', timesCalled: 5 }] });
  assert.match(prompt, /green-grass/);
  assert.match(prompt, /"timesCalled":5/);
});

test('extractJsonObject parses a bare JSON object unchanged', () => {
  assert.equal(JSON.parse(extractJsonObject('{"summary":"a"}')).summary, 'a');
});

test('extractJsonObject strips a ```json markdown fence', () => {
  assert.equal(JSON.parse(extractJsonObject('```json\n{"summary":"a"}\n```')).summary, 'a');
});

test('extractJsonObject falls back to slicing the first balanced {...} block when there is stray prose', () => {
  assert.equal(JSON.parse(extractJsonObject('Here you go:\n{"summary":"a"}\nHope this helps!')).summary, 'a');
});
