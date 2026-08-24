// Opponent Scout model — real Firestore reads/writes. Scouts live at the
// TEAM level (not nested under one Game) so the same opponent profile can
// be reused if the team plays them again later in the season — a Game
// only ever stores a reference (game.scoutId), never a copy, matching the
// same "one source of truth" pattern already used for Plays <-> Game Plan.
//
// SECURITY — deliberately different from every other collection in this
// app: scouting reports are coach-owned football intelligence and are NOT
// automatically exposed to Player Mode (explicit product requirement).
// Every other collection in firestore.rules uses `allow read: if
// isTeamMember(teamId)`; this one uses `allow read: if isCoach(teamId)`
// for both read AND write. See firestore.rules for the enforcement — this
// file has no security logic of its own, same as every other model.

import { db, doc, getDoc, setDoc, collection, query, orderBy, getDocs } from '../firebase-init.js';

function scoutsCollection(teamId) {
  return collection(db, 'teams', teamId, 'scouts');
}

export async function listScouts(teamId) {
  const q = query(scoutsCollection(teamId), orderBy('opponentName', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getScout(teamId, scoutId) {
  if (!scoutId) return null;
  const d = await getDoc(doc(scoutsCollection(teamId), scoutId));
  if (!d.exists()) return null;
  return { id: d.id, ...d.data() };
}

/**
 * scoutData: {
 *   opponentName, notes,
 *   pregameTendencies: { baseLook, tendencyTags: string[], rusherTags: string[], rusherNote },
 *   playmakers: [{ id, jerseyNumber, name, strengthTags: string[], observation }],
 *   savedAlignments: [{ id, name, mode, defenders }], // same {mode, defenders} shape as Play Designer's defense.looks
 *   situationalTendencies: [{ situation, tendency }],
 *   source: 'coach_manual', // reserved: future film-derived scouting can add other values without a schema change
 * }
 */
export async function createScout(teamId, scoutData) {
  const ref = doc(scoutsCollection(teamId));
  const now = new Date().toISOString();
  await setDoc(ref, { ...scoutData, source: scoutData.source || 'coach_manual', createdAt: now, updatedAt: now });
  return { id: ref.id };
}

export async function updateScout(teamId, scoutId, fields) {
  const now = new Date().toISOString();
  await setDoc(doc(scoutsCollection(teamId), scoutId), { ...fields, updatedAt: now }, { merge: true });
}
