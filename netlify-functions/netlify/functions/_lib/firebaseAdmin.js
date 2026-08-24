'use strict';

// Shared Firebase Admin SDK bootstrap for every Netlify Function in this
// project. Netlify's runtime does NOT auto-detect Google Cloud credentials
// the way Firebase's own Cloud Functions infrastructure does — we have to
// hand it an explicit service account.
//
// The service account JSON is read from the FIREBASE_SERVICE_ACCOUNT_JSON
// environment variable (set in the Netlify site's Environment Variables —
// NEVER committed to the repo). It may be stored either as raw JSON or as
// a base64-encoded string (base64 is the safer choice for pasting into
// Netlify's UI, since it has no newlines/quotes to mangle).
//
// initializeApp() is only ever called once per warm Lambda container —
// module-level caching here is what makes that true across invocations.

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not set. Add it as a Netlify environment variable (site Settings > Environment variables) — never commit it to the repo.'
    );
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
}

function getAdminApp() {
  const existing = getApps();
  if (existing.length > 0) return existing[0];
  const serviceAccount = loadServiceAccount();
  return initializeApp({ credential: cert(serviceAccount) });
}

function getDb() {
  return getFirestore(getAdminApp());
}

function getAuthAdmin() {
  return getAuth(getAdminApp());
}

module.exports = { getDb, getAuthAdmin };
