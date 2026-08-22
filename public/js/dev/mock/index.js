// In-memory mock data layer — implements the exact same function names and
// shapes as public/js/data-real.js, so views never know the difference.
// Used only when the URL contains ?dev=1 (see data.js). Nothing here ever
// touches real Firebase. Data resets on every page reload — this is a
// preview aid, not persistent storage.

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
};

let nextPlayId = 1;

// Seed a couple of realistic example plays so the list view isn't empty.
seedPlay({
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
}, {
  WR1: { route: 'Go', roleClassification: 'decoy_clearout', job: 'Get vertical immediately and force the defender to respect the deep route.', why: 'Opens underneath space for another receiver.', key: "Don't slow down just because you're not the primary target." },
  Center: { route: 'Drag', roleClassification: 'primary_target', job: 'Cross the field underneath at 5 yards.', why: 'Designed target once the deep routes clear the middle.', key: 'Sell the block first, then release.' },
});

seedPlay({
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
  intent: {
    description: 'Test defensive pursuit toward the edge with a safe, reliable gain.',
    primaryTargetSlot: null,
    secondaryTargetSlot: null,
    decoySlots: [],
  },
  effectiveness: { vsMan: 'strong', vsZone: 'neutral', vsPressure: 'strong' },
}, {
  Amani: { route: 'Jet Sweep', roleClassification: 'ball_carrier', job: 'Take the handoff and get to the edge fast.', why: 'Primary ball carrier on this call.', key: 'Press the hole, then bounce outside if it closes.' },
});

function seedPlay(playData, assignments) {
  const id = `dev-play-${nextPlayId++}`;
  const now = new Date().toISOString();
  const versionId = `${id}-v1`;
  state.plays.push({ id, ...playData, activeVersionId: versionId, createdAt: now, updatedAt: now });
  state.playVersions[id] = {
    [versionId]: { id: versionId, versionNumber: 1, changelogNote: 'Initial version', diagramUrl: null, assignments, createdAt: now },
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

export async function getPlayerProfile() {
  return { displayNickname: null, avatarUrl: null, personalGoals: null };
}

export async function listPlays(_teamId, { side } = {}) {
  const plays = side ? state.plays.filter((p) => p.side === side) : state.plays;
  return [...plays].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getPlay(_teamId, playId) {
  return state.plays.find((p) => p.id === playId) || null;
}

export async function createPlay(_teamId, playData, assignments) {
  const id = `dev-play-${nextPlayId++}`;
  const now = new Date().toISOString();
  const versionId = `${id}-v1`;
  state.plays.unshift({ id, ...playData, activeVersionId: versionId, active: true, createdAt: now, updatedAt: now });
  state.playVersions[id] = {
    [versionId]: { id: versionId, versionNumber: 1, changelogNote: 'Initial version', diagramUrl: playData.diagramUrl || null, assignments: assignments || {}, createdAt: now },
  };
  return { id, versionId };
}

export async function updatePlay(_teamId, playId, playData) {
  const idx = state.plays.findIndex((p) => p.id === playId);
  if (idx !== -1) {
    state.plays[idx] = { ...state.plays[idx], ...playData, updatedAt: new Date().toISOString() };
  }
}

export async function getActiveVersion(_teamId, playId, versionId) {
  return state.playVersions[playId]?.[versionId] || null;
}
