'use strict';

// Unauthenticated, public-safe roster picker for the player login screen:
// returns only {id, firstName, jerseyNumber} for a given team code — never
// anything sensitive — so a player can pick their own name before entering
// their access code, without Firestore rules needing to open up broader
// read access to the players collection itself.
//
// Direct port of exports.getRosterPicker from functions/index.js.

const { getDb } = require('./_lib/firebaseAdmin');
const { withHttp, Errors } = require('./_lib/http');
const { checkAndConsumeRateLimit, clientIp } = require('./_lib/rateLimit');

exports.handler = withHttp(async ({ event, data }) => {
  if (typeof data.teamCode !== 'string' || data.teamCode.trim().length === 0) {
    throw Errors.invalidArgument('teamCode is required');
  }

  await checkAndConsumeRateLimit(`rosterPicker:${clientIp(event)}`);

  const db = getDb();
  const teamSnap = await db.collection('teams').where('teamCode', '==', data.teamCode).limit(1).get();
  if (teamSnap.empty) {
    throw Errors.notFound('Team code not recognized');
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
