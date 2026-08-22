// Central data-access indirection — the ONLY place this decision is made.
//
// Normal operation: re-exports the real Firestore-backed models.
// With ?dev=1 in the URL: swaps in an in-memory mock data layer instead,
// so the UI can be built and visually reviewed without a live
// authenticated session. This exists specifically because Milestone 1's
// auth Cloud Functions are currently blocked by an external Firebase
// billing-account issue — it is a local preview aid, not a change to the
// real architecture. Nothing in the mock layer ever touches real
// Firestore, real Auth, or real Firebase project data.
//
// Views import ONLY from this file, never directly from models/ or
// dev/mock/ — that's what makes the swap invisible to them.

const isDevMode = new URLSearchParams(location.search).get('dev') === '1';

const impl = isDevMode ? await import('./dev/mock/index.js') : await import('./data-real.js');

export const {
  getTeam,
  getSeason,
  getRuleConfig,
  listActivePlayers,
  getPlayer,
  getPlayerProfile,
  listPlays,
  getPlay,
  createPlay,
  updatePlay,
  getActiveVersion,
} = impl;

export { isDevMode };
