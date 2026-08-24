'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateTeamCode,
  generateAccessCode,
  evaluateRateLimit,
  validateLoginPayload,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
} = require('../netlify/functions/_lib/helpers');

test('generateTeamCode produces a 6-char code from the fixed alphabet', () => {
  const code = generateTeamCode([0, 1, 2, 3, 4, 5]);
  assert.equal(code.length, 6);
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
});

test('generateTeamCode throws with too few bytes', () => {
  assert.throws(() => generateTeamCode([1, 2, 3]));
});

test('generateAccessCode produces a 4-digit numeric code', () => {
  const code = generateAccessCode([12, 34, 56, 78]);
  assert.equal(code.length, 4);
  assert.match(code, /^\d{4}$/);
});

test('generateAccessCode throws with too few bytes', () => {
  assert.throws(() => generateAccessCode([1, 2]));
});

test('evaluateRateLimit allows a fresh key', () => {
  const result = evaluateRateLimit(null, Date.now());
  assert.equal(result.allowed, true);
  assert.equal(result.nextRecord.count, 1);
});

test('evaluateRateLimit allows under the max within the window', () => {
  const now = Date.now();
  const record = { count: RATE_LIMIT_MAX_ATTEMPTS - 1, windowStartMs: now };
  const result = evaluateRateLimit(record, now + 1000);
  assert.equal(result.allowed, true);
  assert.equal(result.nextRecord.count, RATE_LIMIT_MAX_ATTEMPTS);
});

test('evaluateRateLimit blocks at the max within the window', () => {
  const now = Date.now();
  const record = { count: RATE_LIMIT_MAX_ATTEMPTS, windowStartMs: now };
  const result = evaluateRateLimit(record, now + 1000);
  assert.equal(result.allowed, false);
});

test('evaluateRateLimit resets after the window expires', () => {
  const now = Date.now();
  const record = { count: RATE_LIMIT_MAX_ATTEMPTS, windowStartMs: now };
  const result = evaluateRateLimit(record, now + RATE_LIMIT_WINDOW_MS + 1);
  assert.equal(result.allowed, true);
  assert.equal(result.nextRecord.count, 1);
});

test('validateLoginPayload rejects missing body', () => {
  assert.equal(validateLoginPayload(null), 'Missing request body');
});

test('validateLoginPayload rejects missing teamCode', () => {
  const err = validateLoginPayload({ role: 'coach', accessCode: '1234' });
  assert.equal(err, 'Missing or invalid teamCode');
});

test('validateLoginPayload rejects bad role', () => {
  const err = validateLoginPayload({ teamCode: 'ABC123', role: 'ref', accessCode: '1234' });
  assert.equal(err, 'role must be "coach" or "player"');
});

test('validateLoginPayload rejects missing accessCode', () => {
  const err = validateLoginPayload({ teamCode: 'ABC123', role: 'coach' });
  assert.equal(err, 'Missing or invalid accessCode');
});

test('validateLoginPayload requires playerId for player role', () => {
  const err = validateLoginPayload({ teamCode: 'ABC123', role: 'player', accessCode: '1234' });
  assert.equal(err, 'Missing playerId for player login');
});

test('validateLoginPayload accepts a valid coach payload', () => {
  const err = validateLoginPayload({ teamCode: 'ABC123', role: 'coach', accessCode: '1234' });
  assert.equal(err, null);
});

test('validateLoginPayload accepts a valid player payload', () => {
  const err = validateLoginPayload({
    teamCode: 'ABC123',
    role: 'player',
    accessCode: '1234',
    playerId: 'p1',
  });
  assert.equal(err, null);
});
