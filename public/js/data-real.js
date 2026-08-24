// Aggregates the real, Firestore-backed model modules into the one shape
// data.js expects. Exists purely so data.js can dynamically pick between
// this and the dev mock layer without views needing to know which is
// active.

export { getTeam } from './models/team.js';
export { getSeason } from './models/season.js';
export { getRuleConfig } from './models/ruleConfig.js';
export { listActivePlayers, getPlayer, getPlayerProfile, removePlayer } from './models/player.js';
export {
  listPlays,
  getPlay,
  createPlay,
  updatePlay,
  duplicatePlay,
  setPlayActive,
  getActiveVersion,
} from './models/play.js';
export {
  listGames,
  getGame,
  createGame,
  updateGame,
  getWeeklyRoles,
  setWeeklyRoles,
  getGamePlan,
  setGamePlan,
  getGameDayMeta,
  startGameDay,
} from './models/game.js';
export { listSnaps, saveSnap, voidSnap, getSnap } from './models/snap.js';
export {
  listRecommendations,
  saveRecommendation,
  markRecommendationOutcome,
  getRecommendation,
} from './models/recommendation.js';
export { listScouts, getScout, createScout, updateScout } from './models/scout.js';
export { listPracticeIdeas, addPracticeIdea, removePracticeIdea, markPracticeIdeaScheduled } from './models/practiceIdea.js';
export { listPractices, getPractice, createPractice, updatePractice } from './models/practice.js';
export { listCustomFocusAreas, addCustomFocusArea } from './models/focusArea.js';
export { listEvaluations, addEvaluation } from './models/evaluation.js';
export { getChecklist, setChecklistItem } from './models/checklist.js';
