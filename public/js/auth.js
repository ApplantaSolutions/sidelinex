// Thin wrapper around the Cloud Functions that make up SidelineX's auth
// architecture (functions/index.js). No password/PIN comparison ever
// happens client-side — this file only ever calls a Cloud Function and
// then hands the resulting custom token to Firebase Auth.

import { functions, auth, httpsCallable, signInWithCustomToken, signOut as fbSignOut, onAuthStateChanged } from './firebase-init.js';

const callCreateTeam = httpsCallable(functions, 'createTeam');
const callAddPlayer = httpsCallable(functions, 'addPlayer');
const callLogin = httpsCallable(functions, 'login');
const callGetRosterPicker = httpsCallable(functions, 'getRosterPicker');

/**
 * Creates a brand-new team and signs the coach in immediately.
 * Returns { teamId, teamCode, seasonId } on success.
 */
export async function createTeam({ teamName, format, coachAccessCode, seasonLabel }) {
  const result = await callCreateTeam({ teamName, format, coachAccessCode, seasonLabel });
  const { token, teamId, teamCode, seasonId } = result.data;
  await signInWithCustomToken(auth, token);
  return { teamId, teamCode, seasonId };
}

/**
 * Logs a coach in with an existing Team Code + coach access code.
 */
export async function loginAsCoach({ teamCode, accessCode }) {
  const result = await callLogin({ teamCode, role: 'coach', accessCode });
  const { token, teamId } = result.data;
  await signInWithCustomToken(auth, token);
  return { teamId };
}

/**
 * Logs a player in with a Team Code + their own playerId + access code.
 * The caller is expected to have already resolved playerId via
 * getRosterForTeamCode (the player picks their name from a list).
 */
export async function loginAsPlayer({ teamCode, playerId, accessCode }) {
  const result = await callLogin({ teamCode, role: 'player', playerId, accessCode });
  const { token, teamId } = result.data;
  await signInWithCustomToken(auth, token);
  return { teamId, playerId };
}

/**
 * Public, unauthenticated roster lookup for the player login screen —
 * returns only {teamName, roster: [{id, firstName, jerseyNumber}]}.
 */
export async function getRosterForTeamCode(teamCode) {
  const result = await callGetRosterPicker({ teamCode });
  return result.data;
}

/**
 * Coach-only: adds a player and returns their newly generated access code
 * exactly once (the coach must write it down / share it — it can never be
 * retrieved again after this call, by design).
 */
export async function addPlayer({ firstName, lastInitial, jerseyNumber, generalPosition }) {
  const result = await callAddPlayer({ firstName, lastInitial, jerseyNumber, generalPosition });
  return result.data; // { playerId, accessCode }
}

export async function signOut() {
  await fbSignOut(auth);
}

/**
 * Resolves once with the current Firebase Auth user's custom claims
 * ({ teamId, role, playerId? }), or null if signed out. Use this to decide
 * which view to render on app load instead of re-implementing session
 * logic per view.
 */
export function getCurrentClaims() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (!user) {
        resolve(null);
        return;
      }
      const tokenResult = await user.getIdTokenResult();
      resolve({
        teamId: tokenResult.claims.teamId || null,
        role: tokenResult.claims.role || null,
        playerId: tokenResult.claims.playerId || null,
      });
    });
  });
}
