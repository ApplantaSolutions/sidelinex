// Snap model — real Firestore reads/writes for Game Day logging.
//
// Every snap document ID is CLIENT-GENERATED and stable (see
// gameday/localQueue.js), and every write uses setDoc (never addDoc) —
// that's what makes retrying a failed sync completely safe: writing the
// same snap twice with the same ID just overwrites it with identical
// data, it can never create a duplicate. This is the whole mechanism
// behind "retries must never create duplicate snaps."
//
// Undo does NOT delete a snap — it marks it voided:true (see voidSnap).
// State and stats are always re-derived from the full snap list with
// voided ones filtered out (see gameStateEngine.deriveGameState and
// gameStats.js), so nothing ever needs separate "reversal" logic that
// could drift out of sync with what was actually logged.

import { db, doc, getDoc, setDoc, collection, query, orderBy, getDocs } from '../firebase-init.js';

function snapsCollection(teamId, gameId) {
  return collection(db, 'teams', teamId, 'games', gameId, 'snaps');
}

export async function listSnaps(teamId, gameId) {
  const q = query(snapsCollection(teamId, gameId), orderBy('order', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Writes (or overwrites) one snap by its own client-generated id. Safe to
 * call more than once with the same snap object — e.g. a retried sync
 * after a dropped connection — since it always targets the same document.
 */
export async function saveSnap(teamId, gameId, snap) {
  await setDoc(doc(snapsCollection(teamId, gameId), snap.id), snap);
}

export async function voidSnap(teamId, gameId, snapId) {
  await setDoc(doc(snapsCollection(teamId, gameId), snapId), { voided: true }, { merge: true });
}

export async function getSnap(teamId, gameId, snapId) {
  const d = await getDoc(doc(snapsCollection(teamId, gameId), snapId));
  if (!d.exists()) return null;
  return { id: d.id, ...d.data() };
}
