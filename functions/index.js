'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const {
  generateTeamCode,
  generateAccessCode,
  evaluateRateLimit,
  validateLoginPayload,
} = require('./lib/helpers');

initializeApp();
const db = getFirestore();

const BCRYPT_ROUNDS = 10;

function randomByteArray(n) {
  return Array.from(crypto.randomBytes(n));
}

async function checkAndConsumeRateLimit(key) {
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
    throw new HttpsError(
      'resource-exhausted',
      'Too many attempts. Please wait a few minutes and try again.'
    );
  }
}

/**
 * Bootstraps a brand-new Team: creates the team doc, the default season,
 * the provisional rule config (4 downs to midfield, 3 to score), and the
 * coach's own access credentials. No auth required to CALL this — it only
 * ever creates a new team, never grants access to an existing one — but it
 * is rate-limited the same as login to discourage abuse.
 *
 * Returns a custom auth token so the coach is immediately signed in.
 */
exports.createTeam = onCall(async (request) => {
  const data = request.data || {};
  const { teamName, format, coachAccessCode, seasonLabel } = data;

  if (typeof teamName !== 'string' || teamName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'teamName is required');
  }
  if (!['5v5', '6v6', '7v7'].includes(format)) {
    throw new HttpsError('invalid-argument', 'format must be 5v5, 6v6, or 7v7');
  }
  if (typeof coachAccessCode !== 'string' || coachAccessCode.trim().length < 4) {
    throw new HttpsError('invalid-argument', 'coachAccessCode must be at least 4 characters');
  }

  await checkAndConsumeRateLimit(`createTeam:${request.rawRequest?.ip || 'unknown'}`);

  const teamRef = db.collection('teams').doc();
  const teamId = teamRef.id;

  // Guarantee a unique, human-friendly team code — retry on the rare
  // collision rather than trusting randomness alone.
  let teamCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateTeamCode(randomByteArray(6));
    const existing = await db.collection('teams').where('teamCode', '==', candidate).limit(1).get();
    if (existing.empty) {
      teamCode = candidate;
      break;
    }
  }
  if (!teamCode) {
    throw new HttpsError('internal', 'Could not generate a unique team code, please try again');
  }

  const seasonRef = teamRef.collection('seasons').doc();
  const ruleConfigRef = teamRef.collection('ruleConfig').doc('current');
  const coachCredRef = teamRef.collection('coachCredentials').doc('main');

  const coachCodeHash = await bcrypt.hash(coachAccessCode, BCRYPT_ROUNDS);

  const batch = db.batch();
  batch.set(teamRef, {
    name: teamName.trim(),
    teamCode,
    format,
    activeSeasonId: seasonRef.id,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(seasonRef, {
    label: seasonLabel || 'Current Season',
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(ruleConfigRef, {
    downsToMidfield: 4,
    downsAfterMidfieldToScore: 3,
    extraPointRules: {},
    format,
    provisional: true,
    note: 'Default values pending the official league rulebook. Editable by the coach; safe to change without touching application code.',
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(coachCredRef, {
    accessCodeHash: coachCodeHash,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  const token = await getAuth().createCustomToken(`coach_${teamId}`, {
    teamId,
    role: 'coach',
  });

  return { token, teamId, teamCode, seasonId: seasonRef.id };
});

/**
 * Adds a player to the roster. Coach-authenticated only. Generates (or
 * accepts) a player access code, hashes it server-side, and creates both
 * the public-within-team roster doc and the never-readable credential doc
 * in one write.
 */
exports.addPlayer = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== 'coach') {
    throw new HttpsError('permission-denied', 'Only the coach can add players');
  }
  const teamId = request.auth.token.teamId;
  const data = request.data || {};
  const { firstName, lastInitial, jerseyNumber, generalPosition } = data;

  if (typeof firstName !== 'string' || firstName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'firstName is required');
  }

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
  batch.set(
    playerRef.collection('profile').doc('self'),
    {
      // Player-editable fields — intentionally empty in Milestone 1.
      // Structure exists now so the permissions model is already correct;
      // the editing UI is a later milestone.
      displayNickname: null,
      avatarUrl: null,
      personalGoals: null,
      createdAt: FieldValue.serverTimestamp(),
    }
  );
  batch.set(
    teamRefPlayerCred(teamId, playerId),
    {
      accessCodeHash,
      updatedAt: FieldValue.serverTimestamp(),
    }
  );
  await batch.commit();

  // The generated code is returned exactly once, here, to the coach's own
  // authenticated request — it is never stored in plaintext and never
  // readable again after this response.
  return { playerId, accessCode };
});

function teamRefPlayerCred(teamId, playerId) {
  return db.collection('teams').doc(teamId).collection('playerCredentials').doc(playerId);
}

/**
 * Verifies a Team Code + individual access code and, on success, mints a
 * Firebase custom auth token carrying {teamId, role, playerId?}. This is
 * the only path by which a client ever obtains team-scoped access —
 * Firestore rules never trust anything except this token's claims.
 */
exports.login = onCall(async (request) => {
  const data = request.data || {};
  const validationError = validateLoginPayload(data);
  if (validationError) {
    throw new HttpsError('invalid-argument', validationError);
  }

  const { teamCode, role, accessCode, playerId } = data;

  await checkAndConsumeRateLimit(
    `login:${teamCode}:${role}:${playerId || 'coach'}`
  );

  const teamSnap = await db.collection('teams').where('teamCode', '==', teamCode).limit(1).get();
  if (teamSnap.empty) {
    throw new HttpsError('not-found', 'Team code not recognized');
  }
  const teamId = teamSnap.docs[0].id;

  if (role === 'coach') {
    const credSnap = await db.collection('teams').doc(teamId).collection('coachCredentials').doc('main').get();
    if (!credSnap.exists) {
      throw new HttpsError('not-found', 'Coach access is not configured for this team');
    }
    const ok = await bcrypt.compare(accessCode, credSnap.data().accessCodeHash);
    if (!ok) {
      throw new HttpsError('permission-denied', 'Incorrect access code');
    }
    const token = await getAuth().createCustomToken(`coach_${teamId}`, { teamId, role: 'coach' });
    return { token, teamId };
  }

  // role === 'player'
  const credSnap = await teamRefPlayerCred(teamId, playerId).get();
  if (!credSnap.exists) {
    throw new HttpsError('not-found', 'Player access is not configured');
  }
  const ok = await bcrypt.compare(accessCode, credSnap.data().accessCodeHash);
  if (!ok) {
    throw new HttpsError('permission-denied', 'Incorrect access code');
  }
  const token = await getAuth().createCustomToken(`player_${playerId}`, {
    teamId,
    role: 'player',
    playerId,
  });
  return { token, teamId, playerId };
});

/**
 * Unauthenticated, public-safe roster picker for the player login screen:
 * returns only {id, firstName, jerseyNumber} for a given team code — never
 * anything sensitive — so a player can pick their own name before entering
 * their access code, without Firestore rules needing to open up broader
 * read access to the players collection itself.
 */
exports.getRosterPicker = onCall(async (request) => {
  const data = request.data || {};
  if (typeof data.teamCode !== 'string' || data.teamCode.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'teamCode is required');
  }

  await checkAndConsumeRateLimit(`rosterPicker:${request.rawRequest?.ip || 'unknown'}`);

  const teamSnap = await db.collection('teams').where('teamCode', '==', data.teamCode).limit(1).get();
  if (teamSnap.empty) {
    throw new HttpsError('not-found', 'Team code not recognized');
  }
  const teamId = teamSnap.docs[0].id;
  const teamName = teamSnap.docs[0].data().name;

  const playersSnap = await db
    .collection('teams')
    .doc(teamId)
    .collection('players')
    .where('active', '==', true)
    .get();

  const roster = playersSnap.docs.map((doc) => ({
    id: doc.id,
    firstName: doc.data().firstName,
    jerseyNumber: doc.data().jerseyNumber,
  }));

  return { teamName, roster };
});
