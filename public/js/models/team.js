// Thin Firestore read accessors for Team data. Writes to team-level fields
// go through Cloud Functions (createTeam) in Milestone 1 — there is no
// direct client write path here yet, matching the coach-owned data
// principle applied consistently across the app.

import { db, doc, getDoc } from '../firebase-init.js';

export async function getTeam(teamId) {
  const snap = await getDoc(doc(db, 'teams', teamId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}
