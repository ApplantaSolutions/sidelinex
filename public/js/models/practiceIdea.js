// Practice Idea model — the bridge between Postgame Analytics and the
// Practice Planner ("ADD TO PRACTICE IDEAS" -> "ADD TO PRACTICE"). Coach-
// owned, same security level as scouting data (see firestore.rules):
// coach analytics remain coach-owned, per the explicit product
// requirement.
//
// `source` preserves provenance ('postgame' | 'coach_manual' |
// 'film_derived' — the last one reserved, unused until a future film
// stage). `scheduledInPracticeId` is set once a coach pulls an idea into
// a real practice block — the idea document itself is never duplicated
// into the practice; the practice block just holds a `practiceIdeaId`
// reference back to it (see models/practice.js).

import { db, doc, getDoc, setDoc, deleteDoc, collection, query, orderBy, getDocs } from '../firebase-init.js';

function ideasCollection(teamId) {
  return collection(db, 'teams', teamId, 'practiceIdeas');
}

export async function listPracticeIdeas(teamId) {
  const q = query(ideasCollection(teamId), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * @param {{text: string, sourceGameId?: string, category?: string, source?: 'postgame'|'coach_manual'}} idea
 */
export async function addPracticeIdea(teamId, idea) {
  const ref = doc(ideasCollection(teamId));
  const now = new Date().toISOString();
  await setDoc(ref, {
    text: idea.text, sourceGameId: idea.sourceGameId || null, category: idea.category || null,
    source: idea.source || 'coach_manual', scheduledInPracticeId: null, done: false, createdAt: now,
  });
  return { id: ref.id };
}

export async function removePracticeIdea(teamId, ideaId) {
  await deleteDoc(doc(ideasCollection(teamId), ideaId));
}

export async function markPracticeIdeaScheduled(teamId, ideaId, practiceId) {
  await setDoc(doc(ideasCollection(teamId), ideaId), { scheduledInPracticeId: practiceId }, { merge: true });
}
