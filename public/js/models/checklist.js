// Game Ready Checklist model — a player's own preparation checklist.
// Deliberately simple and NOT a gamification system yet (no points,
// streaks, badges — those are intentionally deferred, see
// docs/PROJECT-STATUS.md). Items SidelineX can actually verify itself
// (e.g. "watchedMyJob" — see myPracticeView.js) get marked with
// source:'auto_verified'; everything else is the player's own honest
// self-report with source:'player_marked'. Never fabricated completion.

import { db, doc, getDoc, setDoc } from '../firebase-init.js';

function checklistRef(teamId, playerId) {
  return doc(db, 'teams', teamId, 'players', playerId, 'checklist', 'current');
}

export async function getChecklist(teamId, playerId) {
  const d = await getDoc(checklistRef(teamId, playerId));
  if (!d.exists()) return {};
  return d.data();
}

/**
 * @param {string} itemKey - one of practice/practiceLogic.js's CHECKLIST_ITEMS
 * @param {boolean} done
 * @param {'player_marked'|'auto_verified'} source
 */
export async function setChecklistItem(teamId, playerId, itemKey, done, source = 'player_marked') {
  const now = new Date().toISOString();
  await setDoc(checklistRef(teamId, playerId), { [itemKey]: { done, source, completedAt: done ? now : null } }, { merge: true });
}
