// Player model — read accessors only in Milestone 1. Creation goes through
// the addPlayer Cloud Function (see js/auth.js) so access-code hashing
// always happens server-side.
//
// Deliberate separation kept visible here even though only reads exist so
// far: `players/{id}` is coach-owned football data (roster fields, and in
// later milestones weekly roles/evaluations/attendance/stats/assignments/
// notes all live in sibling coach-only collections keyed by playerId).
// `players/{id}/profile/self` is the player-editable subdocument (avatar,
// nickname, personal goals) — present in the schema and security rules now,
// with no editing UI built yet.

import { db, doc, getDoc, collection, query, where, getDocs } from '../firebase-init.js';

export async function listActivePlayers(teamId) {
  const q = query(collection(db, 'teams', teamId, 'players'), where('active', '==', true));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getPlayer(teamId, playerId) {
  const snap = await getDoc(doc(db, 'teams', teamId, 'players', playerId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getPlayerProfile(teamId, playerId) {
  const snap = await getDoc(doc(db, 'teams', teamId, 'players', playerId, 'profile', 'self'));
  if (!snap.exists()) return null;
  return snap.data();
}
