'use strict';

// Adds a player to the roster. Coach-authenticated only. Generates (or
// accepts) a player access code, hashes it server-side, and creates both
// the public-within-team roster doc and the never-readable credential doc
// in one write.
//
// Direct port of exports.addPlayer from functions/index.js. The one real
// behavioral difference from the Firebase version: auth is verified
// explicitly here via a Bearer ID token (see _lib/auth.js), since Netlify
// Functions have no automatic request.auth context.

const bcrypt = require('bcryptjs');
const { getDb } = require('./_lib/firebaseAdmin');
const { FieldValue } = require('firebase-admin/firestore');
const { withHttp, Errors } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');
const { generateAccessCode } = require('./_lib/helpers');
const { randomByteArray } = require('./_lib/rateLimit');

const BCRYPT_ROUNDS = 10;

function teamRefPlayerCred(db, teamId, playerId) {
  return db.collection('teams').doc(teamId).collection('playerCredentials').doc(playerId);
}

exports.handler = withHttp(async ({ event, data }) => {
  const decoded = await requireAuth(event);
  if (decoded.role !== 'coach') {
    throw Errors.permissionDenied('Only the coach can add players');
  }
  const teamId = decoded.teamId;
  const { firstName, lastInitial, jerseyNumber, generalPosition } = data;

  if (typeof firstName !== 'string' || firstName.trim().length === 0) {
    throw Errors.invalidArgument('firstName is required');
  }

  const db = getDb();
  const playerRef = db.collection('teams').doc(teamId).collection('players').doc();
  const playerId = playerRef.id;

  const accessCode = generateAccessCode(randomByteArray(4));
  const accessCodeHash = await bcrypt.hash(accessCode, BCRYPT_ROUNDS);

  const batch = db.batch();
  batch.set(playerRef, {
    firstName: firstName.trim(),
    lastInitial: (lastInitial || '').trim(),
    jerseyNumber: jerseyNumber != null ? Number(jerseyNumber) : null,
    generalPosition: generalPosition || null,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(playerRef.collection('profile').doc('self'), {
    displayNickname: null,
    avatarUrl: null,
    personalGoals: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(teamRefPlayerCred(db, teamId, playerId), {
    accessCodeHash,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  // The generated code is returned exactly once, here, to the coach's own
  // authenticated request — it is never stored in plaintext and never
  // readable again after this response.
  return { playerId, accessCode };
});
