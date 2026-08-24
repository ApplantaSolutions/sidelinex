// Player Evaluation model — coach-owned development observations, NEVER
// exposed to Player Mode in this stage (see the roadmap's explicit "Do
// NOT expose private coach evaluations... to Player Mode"). Same
// coach-only-for-both-read-and-write trust level as scouting data and
// Postgame practice ideas. These are coaching observations about a
// moment in time, not permanent labels — see the fixed, neutral vocabulary
// enforced by the UI (execution/effort/understanding), never freeform
// judgment words.

import { db, doc, collection, query, orderBy, getDocs, setDoc } from '../firebase-init.js';

function evaluationsCollection(teamId, playerId) {
  return collection(db, 'teams', teamId, 'players', playerId, 'evaluations');
}

export async function listEvaluations(teamId, playerId) {
  const q = query(evaluationsCollection(teamId, playerId), orderBy('date', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * data: { practiceId, date, execution, effort, understanding, note }
 * execution: 'needs_work'|'developing'|'solid'|'strong'
 * effort: 'needs_work'|'solid'|'strong'
 * understanding: 'needs_help'|'getting_it'|'ready'
 */
export async function addEvaluation(teamId, playerId, data) {
  const ref = doc(evaluationsCollection(teamId, playerId));
  await setDoc(ref, { ...data, createdAt: new Date().toISOString() });
  return { id: ref.id };
}
