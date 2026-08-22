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

export async function listPlays(teamId, { side, includeArchived = false } = {}) {
  const constraints = [orderBy('createdAt', 'desc')];
  if (side) constraints.unshift(where('side', '==', side));
  const q = query(playsCollection(teamId), ...constraints);
  const snap = await getDocs(q);
  const plays = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return includeArchived ? plays : plays.filter((p) => p.active !== false);
}

export async function getPlay(teamId, playId) {
  const snap = await getDoc(doc(db, 'teams', teamId, 'plays', playId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Creates a Play plus its first PlayVersion (versionNumber: 1) in one
 * write. Assignments are keyed by slot label (e.g. "WR1"), each holding
 * {route, roleClassification, job, why, key}. fieldDesign (optional) is
 * the Play Designer's structured output: {positions, routes}.
 */
export async function createPlay(teamId, playData, assignments, fieldDesign) {
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
    fieldDesign: fieldDesign || null,
    createdAt: now,
  });

  return { id: playRef.id, versionId: versionRef.id };
}

/**
 * Updates a Play's fields plus its existing active version's assignments/
 * fieldDesign in place. V1 deliberately does not create a new version
 * record per edit (full version history + diff UI is a later increment,
 * per the Milestone 1 architecture review) — the version document itself
 * already exists in the schema so that upgrade path stays open.
 */
export async function updatePlay(teamId, playId, playData, assignments, fieldDesign) {
  const now = new Date().toISOString();
  const playRef = doc(db, 'teams', teamId, 'plays', playId);
  const existing = await getDoc(playRef);
  if (!existing.exists()) throw new Error('Play not found');

  await setDoc(playRef, { ...playData, updatedAt: now }, { merge: true });

  const versionId = existing.data().activeVersionId;
  if (versionId) {
    await setDoc(
      doc(db, 'teams', teamId, 'plays', playId, 'versions', versionId),
      {
        diagramUrl: playData.diagramUrl ?? null,
        assignments: assignments || {},
        fieldDesign: fieldDesign || null,
      },
      { merge: true }
    );
  }
}

/**
 * Duplicates a play (and its active version's assignments/fieldDesign)
 * into a brand-new play. Wristband code is intentionally cleared — two
 * plays sharing a wristband call would be a real, dangerous mistake on
 * game day, so the coach must consciously assign a new one.
 */
export async function duplicatePlay(teamId, playId) {
  const original = await getPlay(teamId, playId);
  if (!original) throw new Error('Play not found');
  const version = await getActiveVersion(teamId, playId, original.activeVersionId);

  const { id, activeVersionId, createdAt, updatedAt, ...playFields } = original;
  const copyData = { ...playFields, name: `${original.name} (Copy)`, wristbandCode: '' };
  return createPlay(teamId, copyData, version?.assignments || {}, version?.fieldDesign || null);
}

/**
 * Safe removal: archives rather than hard-deletes, consistent with this
 * project's standing "preserve everything already built" principle. An
 * archived play drops out of the default Playbook list/search but is
 * never destroyed — it can be restored the same way.
 */
export async function setPlayActive(teamId, playId, active) {
  const now = new Date().toISOString();
  await setDoc(doc(db, 'teams', teamId, 'plays', playId), { active, updatedAt: now }, { merge: true });
}

export async function getActiveVersion(teamId, playId, versionId) {
  const snap = await getDoc(doc(db, 'teams', teamId, 'plays', playId, 'versions', versionId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}
