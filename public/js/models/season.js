import { db, doc, getDoc } from '../firebase-init.js';

export async function getSeason(teamId, seasonId) {
  const snap = await getDoc(doc(db, 'teams', teamId, 'seasons', seasonId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}
