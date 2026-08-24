'use strict';

// Pure, dependency-free helper functions — no Firebase Admin SDK, no
// network calls. Kept separate from the handler files specifically so
// they can be unit-tested with Node's built-in test runner (no extra
// packages, no emulator, no live project needed).
//
// This file is a deliberate, exact port of functions/lib/helpers.js (the
// original Firebase Cloud Functions version) — the security logic itself
// (PIN rate limiting, code generation, payload validation) is identical.
// Only the surrounding request/response handling differs between Firebase
// callable functions and Netlify Functions; this pure logic doesn't care
// which one calls it.

const TEAM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateTeamCode(randomBytes) {
  if (!randomBytes || randomBytes.length < 6) {
    throw new Error('generateTeamCode requires at least 6 random bytes');
  }
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += TEAM_CODE_ALPHABET[randomBytes[i] % TEAM_CODE_ALPHABET.length];
  }
  return code;
}

function generateAccessCode(randomBytes) {
  if (!randomBytes || randomBytes.length < 4) {
    throw new Error('generateAccessCode requires at least 4 random bytes');
  }
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += (randomBytes[i] % 10).toString();
  }
  return code;
}

const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

function evaluateRateLimit(record, nowMs) {
  if (!record || nowMs - record.windowStartMs > RATE_LIMIT_WINDOW_MS) {
    return { allowed: true, nextRecord: { count: 1, windowStartMs: nowMs } };
  }
  if (record.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    return { allowed: false, nextRecord: record };
  }
  return {
    allowed: true,
    nextRecord: { count: record.count + 1, windowStartMs: record.windowStartMs },
  };
}

function validateLoginPayload(data) {
  if (!data || typeof data !== 'object') return 'Missing request body';
  if (typeof data.teamCode !== 'string' || data.teamCode.trim().length === 0) {
    return 'Missing or invalid teamCode';
  }
  if (data.role !== 'coach' && data.role !== 'player') {
    return 'role must be "coach" or "player"';
  }
  if (typeof data.accessCode !== 'string' || data.accessCode.trim().length === 0) {
    return 'Missing or invalid accessCode';
  }
  if (data.role === 'player' && (typeof data.playerId !== 'string' || data.playerId.trim().length === 0)) {
    return 'Missing playerId for player login';
  }
  return null;
}

module.exports = {
  TEAM_CODE_ALPHABET,
  generateTeamCode,
  generateAccessCode,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  evaluateRateLimit,
  validateLoginPayload,
};
