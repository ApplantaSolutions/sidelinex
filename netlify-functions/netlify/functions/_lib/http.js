'use strict';

// Shared HTTP plumbing for every function: CORS headers, JSON body
// parsing, and a small HttpError class that mirrors the {code, message}
// shape Firebase's HttpsError gave us, mapped onto real HTTP status codes
// (Netlify Functions have no built-in equivalent of onCall's automatic
// error-to-client marshalling — this replaces it by hand).

// Only the app's own real origins get CORS access — never '*'. Add
// http://localhost:5000 (Firebase Hosting emulator) for local dev.
const ALLOWED_ORIGINS = [
  'https://sidelinex-beta.web.app',
  'https://sidelinex-beta.firebaseapp.com',
  'http://localhost:5000',
];

function corsHeaders(event) {
  const origin = event.headers && (event.headers.origin || event.headers.Origin);
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Mirrors the small subset of Firebase HttpsError codes this project
// actually used, so handler logic below can throw the same vocabulary.
const Errors = {
  invalidArgument: (msg) => new HttpError(400, 'invalid-argument', msg),
  permissionDenied: (msg) => new HttpError(403, 'permission-denied', msg),
  unauthenticated: (msg) => new HttpError(401, 'unauthenticated', msg),
  notFound: (msg) => new HttpError(404, 'not-found', msg),
  resourceExhausted: (msg) => new HttpError(429, 'resource-exhausted', msg),
  internal: (msg) => new HttpError(500, 'internal', msg),
};

function parseJsonBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw Errors.invalidArgument('Request body must be valid JSON');
  }
}

// Wraps a handler so every function file only has to write its own
// business logic — CORS preflight, JSON parsing/serialization, and
// error-to-status-code mapping are all handled once, here.
function withHttp(fn) {
  return async (event, context) => {
    const headers = { ...corsHeaders(event), 'Content-Type': 'application/json' };

    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers, body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
      const data = parseJsonBody(event);
      const result = await fn({ event, context, data });
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (err) {
      if (err instanceof HttpError) {
        return {
          statusCode: err.status,
          headers,
          body: JSON.stringify({ error: { code: err.code, message: err.message } }),
        };
      }
      // eslint-disable-next-line no-console
      console.error('Unhandled function error:', err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: { code: 'internal', message: 'Internal error' } }),
      };
    }
  };
}

module.exports = { withHttp, Errors, HttpError, parseJsonBody, corsHeaders };
