'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateTeamCode,
  generateAccessCode,
  evaluateRateLimit,
  validateLoginPayload,
  RATE_LIMIT_MAX_ATTEMPTS,
} = require('../lib/helpers');

test('generateTeamCode produces a 6-character code from the restricted alphabet', () => {
  const bytes = [10, 200, 55, 3, 128, 77];
  const code = generateTeamCode(bytes);
  assert.equal(code.length, 6);
  for (const ch of code) {
    assert.match(ch, /[ABCDEFGHJKMNPQRSTUVWXYZ23456789]/);
  }
});

test('generateTeamCode never includes ambiguous characters (0/O, 1/I/L)', () => {
  // Sweep every possible byte value and confirm none map to a banned char.
  const banned = new Set(['0', 'O', '1', 'I', 'L']);
  for (let b = 0; b < 256; b++) {
    const code = generateTeamCode([b, b, b, b, b, b]);
    for (const ch of code) {
      assert.ok(!banned.has(ch), `character ${ch} should never appear`);
    }
  }
});

test('generateAccessCode produces a 4-digit numeric code', () => {
  const code = generateAccessCode([9, 9, 9, 9]);
  assert.equal(code.length, 4);
  assert.match(code, /^\d{4}$/);
});

test('evaluateRateLimit allows the first attempt with no prior record', () => {
  const result = evaluateRateLimit(null, 1000);
  assert.equal(result.allowed, true);
  assert.equal(result.nextRecord.count, 1);
});

test('evaluateRateLimit allows attempts up to the configured max within the window', () => {
  let record = null;
  let now = 1000;
  for (let i = 0; i < RATE_LIMIT_MAX_ATTEMPTS; i++) {
    const result = evaluateRateLimit(record, now);
    assert.equal(result.allowed, true, `attempt ${i + 1} should be allowed`);
    record = result.nextRecord;
    now += 1000;
  }
});

test('evaluateRateLimit blocks the attempt after the max is reached within the window', () => {
  let record = { count: RATE_LIMIT_MAX_ATTEMPTS, windowStartMs: 1000 };
  const result = evaluateRateLimit(record, 1500);
  assert.equal(result.allowed, false);
});

test('evaluateRateLimit resets the window once it has genuinely expired', () => {
  const record = { count: RATE_LIMIT_MAX_ATTEMPTS, windowStartMs: 1000 };
  const farLater = 1000 + 5 * 60 * 1000 + 1;
  const result = evaluateRateLimit(record, farLater);
  assert.equal(result.allowed, true);
  assert.equal(result.nextRecord.count, 1);
});

test('validateLoginPayload rejects a missing teamCode', () => {
  const err = validateLoginPayload({ role: 'coach', accessCode: '1234' });
  assert.match(err, /teamCode/);
});

test('validateLoginPayload rejects an unknown role', () => {
  const err = validateLoginPayload({ teamCode: 'ABC123', role: 'admin', accessCode: '1234' });
  assert.match(err, /role/);
});

test('validateLoginPayload requires playerId when role is player', () => {
  const err = validateLoginPayload({ teamCode: 'ABC123', role: 'player', accessCode: '1234' });
  assert.match(err, /playerId/);
});

test('validateLoginPayload accepts a well-formed coach login', () => {
  const err = validateLoginPayload({ teamCode: 'ABC123', role: 'coach', accessCode: '1234' });
  assert.equal(err, null);
});

test('validateLoginPayload accepts a well-formed player login', () => {
  const err = validateLoginPayload({
    teamCode: 'ABC123',
    role: 'player',
    playerId: 'p1',
    accessCode: '9821',
  });
  assert.equal(err, null);
});
