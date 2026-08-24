// Custom Focus Area model — the extensibility half of the Drill/Focus
// library (see practice/focusAreaTaxonomy.js for the built-in list).
// Team information, same trust level as Plays: any team member can read
// it, only the coach can add one.

import { db, doc, collection, query, orderBy, getDocs, setDoc } from '../firebase-init.js';

function focusAreasCollection(teamId) {
  return collection(db, 'teams', teamId, 'customFocusAreas');
}

export async function listCustomFocusAreas(teamId) {
  const q = query(focusAreasCollection(teamId), orderBy('label', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addCustomFocusArea(teamId, label) {
  const ref = doc(focusAreasCollection(teamId));
  await setDoc(ref, { label, createdAt: new Date().toISOString() });
  return { id: ref.id };
}
