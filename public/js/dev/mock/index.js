// In-memory mock data layer — implements the exact same function names and
// shapes as public/js/data-real.js, so views never know the difference.
// Used only when the URL contains ?dev=1 (see data.js). Nothing here ever
// touches real Firebase, and nothing here can grant access to real data —
// every function operates purely on the in-memory `state` object below.
// Data resets on every page reload — this is a preview aid, not
// persistent storage. See docs/DESIGN-PRINCIPLES.md's dev-mode safety note.

const TEAM_ID = 'dev-team-1';
const SEASON_ID = 'dev-season-1';

const state = {
  team: {
    id: TEAM_ID,
    name: 'Chosen One Sports — 7th Grade',
    teamCode: 'DEV123',
    format: '5v5',
    activeSeasonId: SEASON_ID,
  },
  season: {
    id: SEASON_ID,
    label: 'Fall 2026',
    active: true,
  },
  ruleConfig: {
    downsToMidfield: 4,
    downsAfterMidfieldToScore: 3,
    extraPointRules: {},
    format: '5v5',
    provisional: true,
    note: 'Default values pending the official league rulebook.',
  },
  players: [
    { id: 'p1', firstName: 'Jacob', lastInitial: 'M', jerseyNumber: 7, generalPosition: 'WR', active: true },
    { id: 'p2', firstName: 'Amani', lastInitial: 'T', jerseyNumber: 3, generalPosition: 'RB', active: true },
    { id: 'p3', firstName: 'Miles', lastInitial: 'D', jerseyNumber: 12, generalPosition: 'QB', active: true },
    { id: 'p4', firstName: 'Owen', lastInitial: 'R', jerseyNumber: 88, generalPosition: 'WR', active: true },
    { id: 'p5', firstName: 'Caleb', lastInitial: 'S', jerseyNumber: 55, generalPosition: 'C', active: true },
  ],
  plays: [],
  playVersions: {}, // playId -> { versionId -> versionDoc }
  games: [],
  weeklyRoles: {}, // gameId -> { offense: {slot: playerId}, defense: {...} }
  gamePlans: {}, // gameId -> { entries: [{playId, order, isCore}] }
  gameDayMeta: {}, // gameId -> { started, startingPossession, startedAt }
  snaps: {}, // gameId -> [snap, ...]
  recommendations: {}, // gameId -> [recommendation, ...]
  scouts: {}, // scoutId -> scout
  practiceIdeas: [], // [idea, ...]
  practices: {}, // practiceId -> practice
  customFocusAreas: [], // [{id, label}, ...]
  evaluations: {}, // playerId -> [evaluation, ...]
  checklists: {}, // playerId -> checklist
};

let nextPlayId = 1;
let nextGameId = 1;

seedPlay(
  {
    side: 'offense',
    name: 'Green Grass',
    wristbandCode: '11',
    category: 'pass',
    formation: 'Trips Right',
    favorite: true,
    active: true,
    tags: { beatsMan: false, beatsZone: true, beatsPressure: false, yardageDepth: 'deep', goalLine: false, conversion: false, explosive: true, safe: false, riskLevel: 'medium' },
    supplementalTags: ['clear-out', 'crossing'],
    intendedYardage: 25,
    intent: {
      description: 'Clear deep defenders and create underneath space for the center/WR2 crossing action.',
      primaryTargetSlot: 'Center',
      secondaryTargetSlot: 'WR2',
      decoySlots: ['WR1', 'WR4'],
    },
    effectiveness: { vsMan: 'neutral', vsZone: 'strong', vsPressure: 'neutral' },
  },
  {
    WR1: { route: 'Go', roleClassification: 'decoy_clearout', job: 'Get vertical immediately and force the defender to respect the deep route.', why: 'Opens underneath space for another receiver.', key: "Don't slow down just because you're not the primary target." },
    Center: { route: 'Drag', roleClassification: 'primary_target', job: 'Cross the field underneath at 5 yards.', why: 'Designed target once the deep routes clear the middle.', key: 'Sell the block first, then release.' },
  },
  {
    positions: {
      QB: { x: 0.5, y: 0.8 },
      Center: { x: 0.5, y: 0.72 },
      WR1: { x: 0.14, y: 0.72 },
      WR2: { x: 0.72, y: 0.72 },
      WR4: { x: 0.88, y: 0.72 },
    },
    routes: {
      WR1: { points: [{ x: 0.14, y: 0.72 }, { x: 0.15, y: 0.16 }], designation: 'decoy' },
      Center: { points: [{ x: 0.5, y: 0.72 }, { x: 0.5, y: 0.64 }, { x: 0.16, y: 0.6 }], designation: 'primary' },
      WR2: { points: [{ x: 0.72, y: 0.72 }, { x: 0.72, y: 0.5 }, { x: 0.52, y: 0.4 }], designation: 'secondary' },
      WR4: { points: [{ x: 0.88, y: 0.72 }, { x: 0.88, y: 0.58 }, { x: 0.74, y: 0.56 }] },
    },
  }
);

seedPlay(
  {
    side: 'offense',
    name: 'Jet Right',
    wristbandCode: '12',
    category: 'run',
    formation: 'Jet',
    favorite: false,
    active: true,
    tags: { beatsMan: true, beatsZone: false, beatsPressure: true, yardageDepth: 'short', goalLine: false, conversion: true, explosive: false, safe: true, riskLevel: 'low' },
    supplementalTags: ['edge'],
    intendedYardage: 6,
    intent: { description: 'Test defensive pursuit toward the edge with a safe, reliable gain.', primaryTargetSlot: null, secondaryTargetSlot: null, decoySlots: [] },
    effectiveness: { vsMan: 'strong', vsZone: 'neutral', vsPressure: 'strong' },
  },
  {
    Amani: { route: 'Jet Sweep', roleClassification: 'ball_carrier', job: 'Take the handoff and get to the edge fast.', why: 'Primary ball carrier on this call.', key: 'Press the hole, then bounce outside if it closes.' },
  },
  {
    positions: {
      QB: { x: 0.5, y: 0.8 },
      Center: { x: 0.5, y: 0.72 },
      Amani: { x: 0.3, y: 0.75 },
      WR1: { x: 0.14, y: 0.72 },
      WR2: { x: 0.82, y: 0.72 },
    },
    routes: {
      Amani: { points: [{ x: 0.3, y: 0.75 }, { x: 0.48, y: 0.78 }, { x: 0.78, y: 0.7 }, { x: 0.9, y: 0.55 }], designation: 'primary' },
      WR1: { points: [{ x: 0.14, y: 0.72 }, { x: 0.3, y: 0.7 }] },
      WR2: { points: [{ x: 0.82, y: 0.72 }, { x: 0.82, y: 0.6 }] },
    },
  }
);

function seedPlay(playData, assignments, fieldDesign = null) {
  const id = `dev-play-${nextPlayId++}`;
  const now = new Date().toISOString();
  const versionId = `${id}-v1`;
  state.plays.push({ id, ...playData, activeVersionId: versionId, createdAt: now, updatedAt: now });
  state.playVersions[id] = {
    [versionId]: { id: versionId, versionNumber: 1, changelogNote: 'Initial version', diagramUrl: null, assignments, fieldDesign, createdAt: now },
  };
}

export async function getTeam() {
  return { ...state.team };
}

export async function getSeason() {
  return { ...state.season };
}

export async function getRuleConfig() {
  return { ...state.ruleConfig };
}

export async function listActivePlayers() {
  return state.players.filter((p) => p.active);
}

export async function getPlayer(_teamId, playerId) {
  return state.players.find((p) => p.id === playerId) || null;
}

export async function removePlayer(_teamId, playerId) {
  const p = state.players.find((x) => x.id === playerId);
  if (p) p.active = false;
}

export async function getPlayerProfile() {
  return { displayNickname: null, avatarUrl: null, personalGoals: null };
}

/**
 * Dev-only, mock-layer equivalent of the coach's addPlayer action.
 * Deliberately separate from public/js/auth.js's real addPlayer (which
 * calls a live Cloud Function) — dev mode must never attempt a real
 * network call toward the production backend. See data.js / this file's
 * header comment.
 */
export async function addPlayerMock({ firstName, lastInitial, jerseyNumber }) {
  const id = `dev-p-${state.players.length + 1}`;
  state.players.push({ id, firstName, lastInitial: lastInitial || '', jerseyNumber: jerseyNumber ? Number(jerseyNumber) : null, generalPosition: null, active: true });
  return { playerId: id, accessCode: '0000' };
}

export async function listPlays(_teamId, { side, includeArchived = false } = {}) {
  let plays = side ? state.plays.filter((p) => p.side === side) : state.plays;
  if (!includeArchived) plays = plays.filter((p) => p.active !== false);
  return [...plays].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getPlay(_teamId, playId) {
  return state.plays.find((p) => p.id === playId) || null;
}

export async function createPlay(_teamId, playData, assignments, fieldDesign) {
  const id = `dev-play-${nextPlayId++}`;
  const now = new Date().toISOString();
  const versionId = `${id}-v1`;
  state.plays.unshift({ id, ...playData, activeVersionId: versionId, active: true, createdAt: now, updatedAt: now });
  state.playVersions[id] = {
    [versionId]: { id: versionId, versionNumber: 1, changelogNote: 'Initial version', diagramUrl: playData.diagramUrl || null, assignments: assignments || {}, fieldDesign: fieldDesign || null, createdAt: now },
  };
  return { id, versionId };
}

export async function updatePlay(_teamId, playId, playData, assignments, fieldDesign) {
  const idx = state.plays.findIndex((p) => p.id === playId);
  if (idx === -1) return;
  state.plays[idx] = { ...state.plays[idx], ...playData, updatedAt: new Date().toISOString() };
  const versionId = state.plays[idx].activeVersionId;
  if (versionId && state.playVersions[playId]?.[versionId]) {
    state.playVersions[playId][versionId] = {
      ...state.playVersions[playId][versionId],
      diagramUrl: playData.diagramUrl ?? null,
      assignments: assignments || {},
      fieldDesign: fieldDesign || null,
    };
  }
}

export async function duplicatePlay(teamId, playId) {
  const original = await getPlay(teamId, playId);
  if (!original) throw new Error('Play not found');
  const versionId = original.activeVersionId;
  const version = state.playVersions[playId]?.[versionId];
  const { id, activeVersionId, createdAt, updatedAt, ...playFields } = original;
  const copyData = { ...playFields, name: `${original.name} (Copy)`, wristbandCode: '' };
  return createPlay(teamId, copyData, version?.assignments || {}, version?.fieldDesign || null);
}

export async function setPlayActive(_teamId, playId, active) {
  const idx = state.plays.findIndex((p) => p.id === playId);
  if (idx !== -1) state.plays[idx].active = active;
}

export async function getActiveVersion(_teamId, playId, versionId) {
  return state.playVersions[playId]?.[versionId] || null;
}

export async function listGames(_teamId) {
  return [...state.games].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getGame(_teamId, gameId) {
  return state.games.find((g) => g.id === gameId) || null;
}

export async function createGame(_teamId, { name, date, opponent }) {
  const id = `dev-game-${nextGameId++}`;
  const now = new Date().toISOString();
  state.games.push({ id, name: name || 'Untitled Game', date: date || now, opponent: opponent || null, createdAt: now, updatedAt: now });
  return { id };
}

export async function updateGame(_teamId, gameId, fields) {
  const idx = state.games.findIndex((g) => g.id === gameId);
  if (idx !== -1) state.games[idx] = { ...state.games[idx], ...fields, updatedAt: new Date().toISOString() };
}

export async function getWeeklyRoles(_teamId, gameId) {
  return state.weeklyRoles[gameId] ? { ...state.weeklyRoles[gameId] } : { offense: {}, defense: {} };
}

export async function setWeeklyRoles(_teamId, gameId, { offense, defense }) {
  state.weeklyRoles[gameId] = { offense: offense || {}, defense: defense || {} };
}

export async function getGamePlan(_teamId, gameId) {
  return state.gamePlans[gameId] ? { entries: [...state.gamePlans[gameId].entries] } : { entries: [] };
}

export async function setGamePlan(_teamId, gameId, entries) {
  state.gamePlans[gameId] = { entries: entries || [] };
}

export async function getGameDayMeta(_teamId, gameId) {
  return state.gameDayMeta[gameId] || null;
}

export async function startGameDay(_teamId, gameId, { startingPossession }) {
  state.gameDayMeta[gameId] = { started: true, startingPossession, startedAt: new Date().toISOString() };
}

export async function listSnaps(_teamId, gameId) {
  return [...(state.snaps[gameId] || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function saveSnap(_teamId, gameId, snapData) {
  const list = (state.snaps[gameId] ||= []);
  const idx = list.findIndex((s) => s.id === snapData.id);
  if (idx !== -1) list[idx] = { ...snapData };
  else list.push({ ...snapData });
}

export async function voidSnap(_teamId, gameId, snapId) {
  const list = state.snaps[gameId] || [];
  const s = list.find((x) => x.id === snapId);
  if (s) s.voided = true;
}

export async function getSnap(_teamId, gameId, snapId) {
  const list = state.snaps[gameId] || [];
  return list.find((s) => s.id === snapId) || null;
}

export async function listRecommendations(_teamId, gameId) {
  return [...(state.recommendations[gameId] || [])].sort((a, b) => (a.shownAt || '').localeCompare(b.shownAt || ''));
}

export async function saveRecommendation(_teamId, gameId, rec) {
  const list = (state.recommendations[gameId] ||= []);
  const idx = list.findIndex((r) => r.id === rec.id);
  if (idx !== -1) list[idx] = { ...rec };
  else list.push({ ...rec });
}

export async function markRecommendationOutcome(_teamId, gameId, recId, { calledPlayId, calledSnapId }) {
  const list = state.recommendations[gameId] || [];
  const r = list.find((x) => x.id === recId);
  if (r) { r.calledPlayId = calledPlayId; r.calledSnapId = calledSnapId; }
}

export async function getRecommendation(_teamId, gameId, recId) {
  const list = state.recommendations[gameId] || [];
  return list.find((r) => r.id === recId) || null;
}

let scoutIdCounter = 0;

export async function listScouts(_teamId) {
  return Object.values(state.scouts).sort((a, b) => (a.opponentName || '').localeCompare(b.opponentName || ''));
}

export async function getScout(_teamId, scoutId) {
  return state.scouts[scoutId] || null;
}

export async function createScout(_teamId, scoutData) {
  const id = `scout-mock-${++scoutIdCounter}`;
  const now = new Date().toISOString();
  state.scouts[id] = { id, ...scoutData, source: scoutData.source || 'coach_manual', createdAt: now, updatedAt: now };
  return { id };
}

export async function updateScout(_teamId, scoutId, fields) {
  const existing = state.scouts[scoutId] || { id: scoutId };
  state.scouts[scoutId] = { ...existing, ...fields, updatedAt: new Date().toISOString() };
}

let ideaIdCounter = 0;

export async function listPracticeIdeas(_teamId) {
  return [...state.practiceIdeas].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function addPracticeIdea(_teamId, idea) {
  const id = `idea-mock-${++ideaIdCounter}`;
  state.practiceIdeas.push({ id, text: idea.text, sourceGameId: idea.sourceGameId || null, category: idea.category || null, done: false, createdAt: new Date().toISOString() });
  return { id };
}

export async function removePracticeIdea(_teamId, ideaId) {
  state.practiceIdeas = state.practiceIdeas.filter((i) => i.id !== ideaId);
}

export async function markPracticeIdeaScheduled(_teamId, ideaId, practiceId) {
  const idea = state.practiceIdeas.find((i) => i.id === ideaId);
  if (idea) idea.scheduledInPracticeId = practiceId;
}

let practiceIdCounter = 0;

export async function listPractices(_teamId) {
  return Object.values(state.practices).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export async function getPractice(_teamId, practiceId) {
  return state.practices[practiceId] || null;
}

export async function createPractice(_teamId, data) {
  const id = `practice-mock-${++practiceIdCounter}`;
  const now = new Date().toISOString();
  state.practices[id] = { id, blocks: [], attendance: {}, ...data, createdAt: now, updatedAt: now };
  return { id };
}

export async function updatePractice(_teamId, practiceId, fields) {
  const existing = state.practices[practiceId] || { id: practiceId };
  state.practices[practiceId] = { ...existing, ...fields, updatedAt: new Date().toISOString() };
}

let focusAreaIdCounter = 0;

export async function listCustomFocusAreas(_teamId) {
  return [...state.customFocusAreas].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
}

export async function addCustomFocusArea(_teamId, label) {
  const id = `focus-mock-${++focusAreaIdCounter}`;
  state.customFocusAreas.push({ id, label, createdAt: new Date().toISOString() });
  return { id };
}

let evalIdCounter = 0;

export async function listEvaluations(_teamId, playerId) {
  return [...(state.evaluations[playerId] || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export async function addEvaluation(_teamId, playerId, data) {
  const id = `eval-mock-${++evalIdCounter}`;
  const list = (state.evaluations[playerId] ||= []);
  list.push({ id, ...data, createdAt: new Date().toISOString() });
  return { id };
}

export async function getChecklist(_teamId, playerId) {
  return state.checklists[playerId] || {};
}

export async function setChecklistItem(_teamId, playerId, itemKey, done, source = 'player_marked') {
  const existing = (state.checklists[playerId] ||= {});
  existing[itemKey] = { done, source, completedAt: done ? new Date().toISOString() : null };
}
