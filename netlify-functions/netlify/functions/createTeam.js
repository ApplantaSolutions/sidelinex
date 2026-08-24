'use strict';

// Bootstraps a brand-new Team: creates the team doc, the default season,
// the provisional rule config (4 downs to midfield, 3 to score), and the
// coach's own access credentials. No auth required to call this — it only
// ever creates a new team, never grants access to an existing one — but it
// is rate-limited the same as login to discourage abuse.
//
// Returns a Firebase custom auth token so the coach is immediately signed
// in via signInWithCustomToken() on the client.
//
// Direct port of exports.createTeam from functions/index.js. Only the
// request/response plumbing changed (Netlify handler shape instead of
// onCall); the security logic is identical.

const bcrypt = require('bcryptjs');
const { getDb, getAuthAdmin } = require('./_lib/firebaseAdmin');
const { FieldValue } = require('firebase-admin/firestore');
const { withHttp, Errors } = require('./_lib/http');
const { checkAndConsumeRateLimit, randomByteArray, clientIp } = require('./_lib/rateLimit');
const { generateTeamCode } = require('./_lib/helpers');

const BCRYPT_ROUNDS = 10;

exports.handler = withHttp(async ({ event, data }) => {
  const { teamName, format, coachAccessCode, seasonLabel } = data;

  if (typeof teamName !== 'string' || teamName.trim().length === 0) {
    throw Errors.invalidArgument('teamName is required');
  }
  if (!['5v5', '6v6', '7v7'].includes(format)) {
    throw Errors.invalidArgument('format must be 5v5, 6v6, or 7v7');
  }
  if (typeof coachAccessCode !== 'string' || coachAccessCode.trim().length < 4) {
    throw Errors.invalidArgument('coachAccessCode must be at least 4 characters');
  }

  await checkAndConsumeRateLimit(`createTeam:${clientIp(event)}`);

  const db = getDb();
  const teamRef = db.collection('teams').doc();
  const teamId = teamRef.id;

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
    throw Errors.internal('Could not generate a unique team code, please try again');
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

  const token = await getAuthAdmin().createCustomToken(`coach_${teamId}`, {
    teamId,
    role: 'coach',
  });

  return { token, teamId, teamCode, seasonId: seasonRef.id };
});
