'use strict';

// Direct port of checkAndConsumeRateLimit + randomByteArray from the
// original functions/index.js — same Firestore transaction pattern,
// same _loginRateLimits collection, so rate-limit state is shared
// regardless of which backend (Firebase Cloud Functions or these
// Netlify Functions) happens to serve a given request.

const crypto = require('node:crypto');
const { getDb } = require('./firebaseAdmin');
const { evaluateRateLimit } = require('./helpers');
const { Errors } = require('./http');

function randomByteArray(n) {
  return Array.from(crypto.randomBytes(n));
}

async function checkAndConsumeRateLimit(key) {
  const db = getDb();
  const ref = db.collection('_loginRateLimits').doc(key);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const record = snap.exists ? snap.data() : null;
    const evaluation = evaluateRateLimit(record, now);
    tx.set(ref, evaluation.nextRecord, { merge: false });
    return evaluation.allowed;
  });
  if (!result) {
    throw Errors.resourceExhausted('Too many attempts. Please wait a few minutes and try again.');
  }
}

function clientIp(event) {
  const header = event.headers && (event.headers['x-nf-client-connection-ip'] || event.headers['client-ip']);
  return header || 'unknown';
}

module.exports = { checkAndConsumeRateLimit, randomByteArray, clientIp };
