'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeConfidence, sanitizeAnalysis, buildUserPrompt, extractJsonObject } = require('../netlify/functions/analyzePlay');

test('sanitizeConfidence passes through valid values (case-insensitive)', () => {
  assert.equal(sanitizeConfidence('HIGH'), 'HIGH');
  assert.equal(sanitizeConfidence('medium'), 'MEDIUM');
  assert.equal(sanitizeConfidence('Limited'), 'LIMITED');
});

test('sanitizeConfidence coerces an invalid or fabricated value to LIMITED', () => {
  assert.equal(sanitizeConfidence('87%'), 'LIMITED');
  assert.equal(sanitizeConfidence('very confident'), 'LIMITED');
  assert.equal(sanitizeConfidence(undefined), 'LIMITED');
  assert.equal(sanitizeConfidence(null), 'LIMITED');
  assert.equal(sanitizeConfidence(0.9), 'LIMITED');
});

test('sanitizeAnalysis never lets a numeric or fabricated confidence through', () => {
  const raw = {
    coverageFit: {
      man: { confidence: '95%', why: 'made up stat' },
      zone: { confidence: 'HIGH', why: 'real reason' },
      pressure: { confidence: 'unsure', why: 'x' },
    },
  };
  const result = sanitizeAnalysis(raw);
  assert.equal(result.coverageFit.man.confidence, 'LIMITED');
  assert.equal(result.coverageFit.zone.confidence, 'HIGH');
  assert.equal(result.coverageFit.pressure.confidence, 'LIMITED');
});

test('sanitizeAnalysis defaults missing coverageFit entries to LIMITED with an honest note', () => {
  const result = sanitizeAnalysis({});
  assert.equal(result.coverageFit.man.confidence, 'LIMITED');
  assert.equal(result.coverageFit.man.why, 'NOT ENOUGH INFORMATION');
  assert.equal(result.coverageFit.zone.confidence, 'LIMITED');
  assert.equal(result.coverageFit.pressure.confidence, 'LIMITED');
});

test('sanitizeAnalysis caps strengths/weaknesses/bestSituations at 6 items each', () => {
  const raw = {
    strengths: Array.from({ length: 20 }, (_, i) => `s${i}`),
    weaknesses: Array.from({ length: 20 }, (_, i) => `w${i}`),
    bestSituations: Array.from({ length: 20 }, (_, i) => `b${i}`),
  };
  const result = sanitizeAnalysis(raw);
  assert.equal(result.strengths.length, 6);
  assert.equal(result.weaknesses.length, 6);
  assert.equal(result.bestSituations.length, 6);
});

test('sanitizeAnalysis filters out non-string entries from arrays', () => {
  const raw = { strengths: ['real one', 42, null, { fake: true }, 'another real one'] };
  const result = sanitizeAnalysis(raw);
  assert.deepEqual(result.strengths, ['real one', 'another real one']);
});

test('sanitizeAnalysis handles a completely empty/malformed input without throwing', () => {
  assert.doesNotThrow(() => sanitizeAnalysis(null));
  assert.doesNotThrow(() => sanitizeAnalysis(undefined));
  assert.doesNotThrow(() => sanitizeAnalysis({}));
  const result = sanitizeAnalysis(null);
  assert.deepEqual(result.strengths, []);
});

test('sanitizeAnalysis passes through suggestedMetadata as-is when it is an object', () => {
  const raw = { suggestedMetadata: { category: 'pass', riskLevel: 'low' } };
  const result = sanitizeAnalysis(raw);
  assert.deepEqual(result.suggestedMetadata, { category: 'pass', riskLevel: 'low' });
});

test('sanitizeAnalysis defaults suggestedMetadata to an empty object when missing or invalid', () => {
  assert.deepEqual(sanitizeAnalysis({}).suggestedMetadata, {});
  assert.deepEqual(sanitizeAnalysis({ suggestedMetadata: 'not an object' }).suggestedMetadata, {});
});

test('buildUserPrompt includes the play formation, routes, and coach intent', () => {
  const play = {
    formation: 'Trips Right',
    category: 'pass',
    side: 'offense',
    positions: { WR1: { x: 0.8, y: 0.3 } },
    routes: { WR1: { routeType: 'go', designation: 'primary' } },
    primaryTargetSlot: 'WR1',
    secondaryTargetSlot: null,
    decoySlots: [],
  };
  const prompt = buildUserPrompt(play);
  assert.match(prompt, /Trips Right/);
  assert.match(prompt, /WR1/);
  assert.match(prompt, /primary=WR1/);
});

test('buildUserPrompt handles a play with no defense selected', () => {
  const play = { side: 'offense', positions: {}, routes: {} };
  const prompt = buildUserPrompt(play);
  assert.match(prompt, /none selected/);
});

test('extractJsonObject parses a bare JSON object unchanged', () => {
  const raw = '{"strengths":["a"]}';
  assert.equal(JSON.parse(extractJsonObject(raw)).strengths[0], 'a');
});

test('extractJsonObject strips a ```json markdown fence', () => {
  const raw = '```json\n{"strengths":["a"]}\n```';
  assert.equal(JSON.parse(extractJsonObject(raw)).strengths[0], 'a');
});

test('extractJsonObject strips a bare ``` fence with no language tag', () => {
  const raw = '```\n{"strengths":["a"]}\n```';
  assert.equal(JSON.parse(extractJsonObject(raw)).strengths[0], 'a');
});

test('extractJsonObject falls back to slicing the first balanced {...} block when there is stray prose', () => {
  const raw = 'Here is my analysis:\n{"strengths":["a"]}\nHope this helps!';
  assert.equal(JSON.parse(extractJsonObject(raw)).strengths[0], 'a');
});

test('extractJsonObject handles nested braces correctly when slicing the balanced block', () => {
  const raw = 'preface {"coverageFit":{"man":{"confidence":"HIGH"}}} trailing text';
  const parsed = JSON.parse(extractJsonObject(raw));
  assert.equal(parsed.coverageFit.man.confidence, 'HIGH');
});
