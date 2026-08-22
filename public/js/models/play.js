// Play model — real Firestore reads/writes. Deliberately does NOT go
// through a Cloud Function: unlike auth (which needs server-side hash
// verification), Play CRUD only ever needs an already-authenticated coach
// session, enforced entirely by firestore.rules' isCoach(teamId) check.
// This is why Playbook can be built now even while the auth Cloud
// Functions deploy is blocked — once a coach can actually log in, this
// code works with no changes.

import {
  db,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from '../firebase-init.js';

function playsCollection(teamId) {
  return collection(db, 'teams', teamId, 'plays');
}

export async function listPlays(teamId, { side } = {}) {
  const constraints = [orderBy('createdAt', 'desc')];
  if (side) constraints.unshift(where('side', '==', side));
  const q = query(playsCollection(teamId), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getPlay(teamId, playId) {
  const snap = await getDoc(doc(db, 'teams', teamId, 'plays', playId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Creates a Play plus its first PlayVersion (versionNumber: 1) in one
 * write. Assignments are keyed by slot label (e.g. "WR1"), each holding
 * {route, roleClassification, job, why, key} — the WHAT/ROLE/WHY/KEY
 * model from the product spec.
 */
export async function createPlay(teamId, playData, assignments) {
  const playRef = doc(playsCollection(teamId));
  const versionRef = doc(collection(playRef, 'versions'));
  const now = new Date().toISOString();

  await setDoc(playRef, {
    ...playData,
    activeVersionId: versionRef.id,
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  await setDoc(versionRef, {
    versionNumber: 1,
    changelogNote: 'Initial version',
    diagramUrl: playData.diagramUrl || null,
    assignments: assignments || {},
    createdAt: now,
  });

  return { id: playRef.id, versionId: versionRef.id };
}

export async function updatePlay(teamId, playId, playData) {
  const now = new Date().toISOString();
  await setDoc(
    doc(db, 'teams', teamId, 'plays', playId),
    { ...playData, updatedAt: now },
    { merge: true }
  );
}

export async function getActiveVersion(teamId, playId, versionId) {
  const snap = await getDoc(doc(db, 'teams', teamId, 'plays', playId, 'versions', versionId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}
