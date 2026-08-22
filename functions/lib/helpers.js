'use strict';

// Pure, dependency-free helper functions — no Firebase Admin SDK, no
// network calls. Kept separate from index.js specifically so they can be
// unit-tested with Node's built-in test runner (no extra packages, no
// emulator, no live project needed).

/**
 * Generates a Team Code: 6 characters, uppercase letters + digits only,
 * excluding visually ambiguous characters (0/O, 1/I/L) since coaches will
 * read this aloud or write it on a whiteboard.
 */
const TEAM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateTeamCode(randomBytes) {
  // randomBytes: a Uint8Array-like of length >= 6, injected so this stays
  // pure/testable rather than calling crypto directly inside the function.
  if (!randomBytes || randomBytes.length < 6) {
    throw new Error('generateTeamCode requires at least 6 random bytes');
  }
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += TEAM_CODE_ALPHABET[randomBytes[i] % TEAM_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Generates a player/coach access code: 4 digits. Short and easy for a
 * middle-schooler to remember, per the product requirement — the security
 * boundary against guessing is the rate limiter (checkRateLimit below),
 * not code length alone.
 */
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

/**
 * Rate-limit window logic, pure. Given the current attempt record
 * ({ count, windowStartMs }) and the current time, decides whether a new
 * attempt is allowed and returns the updated record to persist.
 *
 * Policy: max 5 attempts per rolling 5-minute window per key. This is
 * intentionally simple for Milestone 1 — the goal is to make PIN-guessing
 * impractical, not to build a full abuse-detection system.
 */
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

/**
 * Validates the shape of a login request payload before any Firestore or
 * bcrypt work happens — fails fast and cheaply on malformed input.
 */
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
  return null; // valid
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
