// Practice model — real Firestore reads/writes. Practices are team
// information (same trust level as Games/Plays) — any team member can
// read the agenda/attendance, only the coach can create or edit one.
// Private coach evaluations live in a SEPARATE, coach-only collection
// (models/evaluation.js) — never mixed into this document, since the two
// have deliberately different security boundaries.

import { db, doc, getDoc, setDoc, collection, query, orderBy, getDocs } from '../firebase-init.js';

function practicesCollection(teamId) {
  return collection(db, 'teams', teamId, 'practices');
}

export async function listPractices(teamId) {
  const q = query(practicesCollection(teamId), orderBy('date', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getPractice(teamId, practiceId) {
  const d = await getDoc(doc(practicesCollection(teamId), practiceId));
  if (!d.exists()) return null;
  return { id: d.id, ...d.data() };
}

/**
 * data: {
 *   date, title, durationMinutes,
 *   blocks: [{ id, label, durationMinutes, order, focusArea, playIds:[],
 *              assignmentType: 'team'|'players'|'role', assignedPlayerIds:[], assignedRole,
 *              practiceIdeaId, complete }],
 *   attendance: { [playerId]: 'PRESENT'|'ABSENT'|'LATE'|'EXCUSED' },
 *   notes,
 * }
 */
export async function createPractice(teamId, data) {
  const ref = doc(practicesCollection(teamId));
  const now = new Date().toISOString();
  await setDoc(ref, { blocks: [], attendance: {}, ...data, createdAt: now, updatedAt: now });
  return { id: ref.id };
}

export async function updatePractice(teamId, practiceId, fields) {
  const now = new Date().toISOString();
  await setDoc(doc(practicesCollection(teamId), practiceId), { ...fields, updatedAt: now }, { merge: true });
}
