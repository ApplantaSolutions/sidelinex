// Aggregates the real, Firestore-backed model modules into the one shape
// data.js expects. Exists purely so data.js can dynamically pick between
// this and the dev mock layer without views needing to know which is
// active.

export { getTeam } from './models/team.js';
export { getSeason } from './models/season.js';
export { getRuleConfig } from './models/ruleConfig.js';
export { listActivePlayers, getPlayer, getPlayerProfile } from './models/player.js';
export {
  listPlays,
  getPlay,
  createPlay,
  updatePlay,
  duplicatePlay,
  setPlayActive,
  getActiveVersion,
} from './models/play.js';
