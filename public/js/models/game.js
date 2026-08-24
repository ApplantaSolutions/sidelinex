// Game model — real Firestore reads/writes for the Weekly Roles / Game
// Plan Builder stage. Same pattern as play.js: coach-only writes enforced
// by firestore.rules (isCoach(teamId)), any team member can read.
//
// A Game is the unit both Weekly Roles and the Game Plan hang off of — one
// game = one week's roster-to-slot mapping + one selection of plays from
// the master Playbook. Nothing here ever copies a Play's content: the
// Game Plan stores only playId references (plus per-game metadata like
// order/isCore), so editing a play in the Playbook is instantly reflected
// everywhere it's referenced — there is exactly one source of truth for
// what a play IS, per the roadmap's "Do NOT duplicate Play records" rule.

import { db, doc, getDoc, setDoc, collection, query, orderBy, getDocs } from '../firebase-init.js';

function gamesCollection(teamId) {
  return collection(db, 'teams', teamId, 'games');
}

export async function listGames(teamId) {
  const q = query(gamesCollection(teamId), orderBy('date', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getGame(teamId, gameId) {
  const snap = await getDoc(doc(db, 'teams', teamId, 'games', gameId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function createGame(teamId, { name, date, opponent }) {
  const ref = doc(gamesCollection(teamId));
  const now = new Date().toISOString();
  await setDoc(ref, {
    name: name || 'Untitled Game',
    date: date || now,
    opponent: opponent || null,
    createdAt: now,
    updatedAt: now,
  });
  return { id: ref.id };
}

export async function updateGame(teamId, gameId, fields) {
  const now = new Date().toISOString();
  await setDoc(doc(db, 'teams', teamId, 'games', gameId), { ...fields, updatedAt: now }, { merge: true });
}

// ---------- Weekly Roles (slot -> playerId, per side, per game) ----------

function weeklyRolesRef(teamId, gameId) {
  return doc(db, 'teams', teamId, 'games', gameId, 'weeklyRoles', 'main');
}

export async function getWeeklyRoles(teamId, gameId) {
  const snap = await getDoc(weeklyRolesRef(teamId, gameId));
  if (!snap.exists()) return { offense: {}, defense: {} };
  const data = snap.data();
  return { offense: data.offense || {}, defense: data.defense || {} };
}

export async function setWeeklyRoles(teamId, gameId, { offense, defense }) {
  const now = new Date().toISOString();
  await setDoc(weeklyRolesRef(teamId, gameId), { offense: offense || {}, defense: defense || {}, updatedAt: now }, { merge: true });
}

// ---------- Game Plan (ordered list of {playId, isCore}, per game) ----------

function gamePlanRef(teamId, gameId) {
  return doc(db, 'teams', teamId, 'games', gameId, 'gamePlan', 'main');
}

export async function getGamePlan(teamId, gameId) {
  const snap = await getDoc(gamePlanRef(teamId, gameId));
  if (!snap.exists()) return { entries: [] };
  return { entries: snap.data().entries || [] };
}

/**
 * entries: [{ playId, order, isCore }] — order is an explicit integer
 * (not array position) so reordering is a plain field update, not a
 * full-array reshuffle each time. isCore marks a "core call" for THIS
 * game specifically — deliberately separate from a Play's own global
 * `favorite` flag in the Playbook, since a play can be a core call for
 * one opponent's game plan and not another's.
 */
export async function setGamePlan(teamId, gameId, entries) {
  const now = new Date().toISOString();
  await setDoc(gamePlanRef(teamId, gameId), { entries: entries || [], updatedAt: now }, { merge: true });
}

// ---------- Game Day session metadata (starting possession, started flag) ----------

function gameDayMetaRef(teamId, gameId) {
  return doc(db, 'teams', teamId, 'games', gameId, 'gameDayMeta', 'main');
}

export async function getGameDayMeta(teamId, gameId) {
  const snap = await getDoc(gameDayMetaRef(teamId, gameId));
  if (!snap.exists()) return null;
  return snap.data();
}

export async function startGameDay(teamId, gameId, { startingPossession }) {
  const now = new Date().toISOString();
  await setDoc(gameDayMetaRef(teamId, gameId), { started: true, startingPossession, startedAt: now }, { merge: true });
}
