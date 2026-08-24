'use strict';

// Firebase callable functions (onCall) get request.auth populated
// automatically — the client SDK attaches the signed-in user's ID token
// to every call, and Firebase's own infrastructure verifies it before the
// handler ever runs. Netlify Functions have no equivalent: the client must
// explicitly fetch its current ID token (firebase.auth().currentUser
// .getIdToken()) and send it as "Authorization: Bearer <token>", and this
// handler must verify it explicitly on every request that needs it.
//
// Custom claims (teamId, role, playerId) that were set as the second
// argument to createCustomToken() at sign-in time carry through into the
// resulting ID token once the client exchanges it via
// signInWithCustomToken() — so decodedToken.teamId / .role below are the
// same values createTeam.js / login.js minted.

const { getAuthAdmin } = require('./firebaseAdmin');
const { Errors } = require('./http');

async function requireAuth(event) {
  const header = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!header || !header.startsWith('Bearer ')) {
    throw Errors.unauthenticated('Missing Authorization header');
  }
  const idToken = header.slice('Bearer '.length).trim();
  try {
    return await getAuthAdmin().verifyIdToken(idToken);
  } catch {
    throw Errors.unauthenticated('Invalid or expired session — please sign in again');
  }
}

module.exports = { requireAuth };
