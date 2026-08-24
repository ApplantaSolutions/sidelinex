// Recommendation model — real Firestore reads/writes for Sideline Advisor
// self-scouting log. Same pattern as snap.js: client-generated stable id,
// setDoc (never addDoc), safe to retry.
//
// This is explicitly NOT used to judge the coach — it's a record of what
// the Advisor showed, what the coach actually called, and what happened,
// so a coach (or the team, later) can review call patterns after the
// season. Nothing here blocks or gates any Game Day action; every write
// is fire-and-forget from the caller's perspective, same as saveSnap.

import { db, doc, setDoc, getDoc, collection, query, orderBy, getDocs } from '../firebase-init.js';

function recommendationsCollection(teamId, gameId) {
  return collection(db, 'teams', teamId, 'games', gameId, 'recommendations');
}

export async function listRecommendations(teamId, gameId) {
  const q = query(recommendationsCollection(teamId, gameId), orderBy('shownAt', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * rec: { id, situationSnapshot, filter, rankedOptions: [{playId, score, confidence, reasons}],
 *        shownAt, calledPlayId: null, calledSnapId: null }
 */
export async function saveRecommendation(teamId, gameId, rec) {
  await setDoc(doc(recommendationsCollection(teamId, gameId), rec.id), rec, { merge: true });
}

/**
 * Filled in once the coach's NEXT snap is actually logged — this is what
 * turns a shown recommendation set into real self-scouting data (what did
 * the Advisor suggest vs. what did the coach actually call).
 */
export async function markRecommendationOutcome(teamId, gameId, recId, { calledPlayId, calledSnapId }) {
  await setDoc(doc(recommendationsCollection(teamId, gameId), recId), { calledPlayId, calledSnapId }, { merge: true });
}

export async function getRecommendation(teamId, gameId, recId) {
  const d = await getDoc(doc(recommendationsCollection(teamId, gameId), recId));
  if (!d.exists()) return null;
  return { id: d.id, ...d.data() };
}
