'use strict';

// Verifies a Team Code + individual access code and, on success, mints a
// Firebase custom auth token carrying {teamId, role, playerId?}. This is
// the only path by which a client ever obtains team-scoped access —
// Firestore rules never trust anything except this token's claims.
//
// Direct port of exports.login from functions/index.js.

const bcrypt = require('bcryptjs');
const { getDb, getAuthAdmin } = require('./_lib/firebaseAdmin');
const { withHttp, Errors } = require('./_lib/http');
const { checkAndConsumeRateLimit } = require('./_lib/rateLimit');
const { validateLoginPayload } = require('./_lib/helpers');

function teamRefPlayerCred(db, teamId, playerId) {
  return db.collection('teams').doc(teamId).collection('playerCredentials').doc(playerId);
}

exports.handler = withHttp(async ({ data }) => {
  const validationError = validateLoginPayload(data);
  if (validationError) {
    throw Errors.invalidArgument(validationError);
  }

  const { teamCode, role, accessCode, playerId } = data;

  await checkAndConsumeRateLimit(`login:${teamCode}:${role}:${playerId || 'coach'}`);

  const db = getDb();
  const teamSnap = await db.collection('teams').where('teamCode', '==', teamCode).limit(1).get();
  if (teamSnap.empty) {
    throw Errors.notFound('Team code not recognized');
  }
  const teamId = teamSnap.docs[0].id;

  if (role === 'coach') {
    const credSnap = await db.collection('teams').doc(teamId).collection('coachCredentials').doc('main').get();
    if (!credSnap.exists) {
      throw Errors.notFound('Coach access is not configured for this team');
    }
    const ok = await bcrypt.compare(accessCode, credSnap.data().accessCodeHash);
    if (!ok) {
      throw Errors.permissionDenied('Incorrect access code');
    }
    const token = await getAuthAdmin().createCustomToken(`coach_${teamId}`, { teamId, role: 'coach' });
    return { token, teamId };
  }

  // role === 'player'
  const credSnap = await teamRefPlayerCred(db, teamId, playerId).get();
  if (!credSnap.exists) {
    throw Errors.notFound('Player access is not configured');
  }
  const ok = await bcrypt.compare(accessCode, credSnap.data().accessCodeHash);
  if (!ok) {
    throw Errors.permissionDenied('Incorrect access code');
  }
  const token = await getAuthAdmin().createCustomToken(`player_${playerId}`, {
    teamId,
    role: 'player',
    playerId,
  });
  return { token, teamId, playerId };
});
