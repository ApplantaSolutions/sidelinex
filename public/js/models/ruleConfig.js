import { db, doc, getDoc } from '../firebase-init.js';

/**
 * Reads the team's active league drive-rule config. Seeded by
 * createTeam with provisional defaults (4 downs to midfield, 3 more to
 * score); safe to edit later directly in Firestore or a future settings
 * UI — no application code depends on these specific numbers, only on
 * this document's shape.
 */
export async function getRuleConfig(teamId) {
  const snap = await getDoc(doc(db, 'teams', teamId, 'ruleConfig', 'current'));
  if (!snap.exists()) return null;
  return snap.data();
}
