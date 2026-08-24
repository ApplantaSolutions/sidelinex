'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withHttp, Errors, corsHeaders, parseJsonBody } = require('../netlify/functions/_lib/http');

function fakeEvent({ method = 'POST', body = null, origin = 'https://sidelinex-beta.web.app' } = {}) {
  return {
    httpMethod: method,
    headers: origin ? { origin } : {},
    body: body === null ? null : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

test('corsHeaders echoes an allowed origin', () => {
  const headers = corsHeaders(fakeEvent({ origin: 'https://sidelinex-beta.web.app' }));
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://sidelinex-beta.web.app');
});

test('corsHeaders falls back to the default origin for an unknown one', () => {
  const headers = corsHeaders(fakeEvent({ origin: 'https://evil.example.com' }));
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://sidelinex-beta.web.app');
});

test('parseJsonBody returns {} for an empty body', () => {
  assert.deepEqual(parseJsonBody({ body: null }), {});
});

test('parseJsonBody throws invalid-argument on malformed JSON', () => {
  assert.throws(() => parseJsonBody({ body: '{not json' }), /invalid-argument|JSON/);
});

test('withHttp handles OPTIONS preflight with 204 and no body', async () => {
  const handler = withHttp(async () => ({ ok: true }));
  const res = await handler(fakeEvent({ method: 'OPTIONS' }));
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, '');
});

test('withHttp rejects non-POST/OPTIONS with 405', async () => {
  const handler = withHttp(async () => ({ ok: true }));
  const res = await handler(fakeEvent({ method: 'GET' }));
  assert.equal(res.statusCode, 405);
});

test('withHttp returns 200 with JSON body on success', async () => {
  const handler = withHttp(async ({ data }) => ({ echoed: data.x }));
  const res = await handler(fakeEvent({ body: { x: 42 } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { echoed: 42 });
});

test('withHttp maps a thrown HttpError to its status code', async () => {
  const handler = withHttp(async () => {
    throw Errors.notFound('nope');
  });
  const res = await handler(fakeEvent({ body: {} }));
  assert.equal(res.statusCode, 404);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.error.code, 'not-found');
});

test('withHttp maps an unexpected thrown error to 500 without leaking details', async () => {
  const handler = withHttp(async () => {
    throw new Error('secret internal detail');
  });
  const res = await handler(fakeEvent({ body: {} }));
  assert.equal(res.statusCode, 500);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.error.code, 'internal');
  assert.ok(!parsed.error.message.includes('secret'));
});
