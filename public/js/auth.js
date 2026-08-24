// Thin wrapper around SidelineX's auth-critical backend logic
// (createTeam, addPlayer, login, getRosterPicker). No password/PIN
// comparison ever happens client-side — this file only ever calls the
// backend and then hands the resulting custom token to Firebase Auth.
//
// These 4 functions live on Netlify (netlify-functions/netlify/functions/)
// rather than Firebase Cloud Functions — the Firebase Blaze billing
// account is blocked, so this is the working substitute. Firestore, Auth,
// and Hosting are unaffected and still run on Firebase as normal. If
// Blaze ever gets unblocked, only FUNCTIONS_BASE_URL + the two fetch
// helpers below would need to change back — every function below this
// point keeps the exact same call signature either way.

import { auth, signInWithCustomToken, signOut as fbSignOut, onAuthStateChanged } from './firebase-init.js';

const FUNCTIONS_BASE_URL = 'https://sidelinex-functions.netlify.app/.netlify/functions';

async function callFunction(name, body, { authToken } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${FUNCTIONS_BASE_URL}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload && payload.error && payload.error.message
      ? payload.error.message
      : `Request to ${name} failed (${res.status})`;
    throw new Error(message);
  }
  return payload;
}

/**
 * Creates a brand-new team and signs the coach in immediately.
 * Returns { teamId, teamCode, seasonId } on success.
 */
export async function createTeam({ teamName, format, coachAccessCode, seasonLabel }) {
  const result = await callFunction('createTeam', { teamName, format, coachAccessCode, seasonLabel });
  const { token, teamId, teamCode, seasonId } = result;
  await signInWithCustomToken(auth, token);
  return { teamId, teamCode, seasonId };
}

/**
 * Logs a coach in with an existing Team Code + coach access code.
 */
export async function loginAsCoach({ teamCode, accessCode }) {
  const result = await callFunction('login', { teamCode, role: 'coach', accessCode });
  const { token, teamId } = result;
  await signInWithCustomToken(auth, token);
  return { teamId };
}

/**
 * Logs a player in with a Team Code + their own playerId + access code.
 * The caller is expected to have already resolved playerId via
 * getRosterForTeamCode (the player picks their name from a list).
 */
export async function loginAsPlayer({ teamCode, playerId, accessCode }) {
  const result = await callFunction('login', { teamCode, role: 'player', playerId, accessCode });
  const { token, teamId } = result;
  await signInWithCustomToken(auth, token);
  return { teamId, playerId };
}

/**
 * Public, unauthenticated roster lookup for the player login screen —
 * returns only {teamName, roster: [{id, firstName, jerseyNumber}]}.
 */
export async function getRosterForTeamCode(teamCode) {
  return callFunction('getRosterPicker', { teamCode });
}

/**
 * Coach-only: adds a player and returns their newly generated access code
 * exactly once (the coach must write it down / share it — it can never be
 * retrieved again after this call, by design).
 *
 * Unlike the other 3 functions, this one requires proof of who's calling —
 * Netlify Functions have no automatic request.auth the way Firebase
 * callable functions did, so we fetch the signed-in coach's current ID
 * token and send it as a Bearer header; the backend verifies it and reads
 * the coach's teamId from its claims.
 */
export async function addPlayer({ firstName, lastInitial, jerseyNumber, generalPosition }) {
  if (!auth.currentUser) {
    throw new Error('You must be signed in as a coach to add a player');
  }
  const idToken = await auth.currentUser.getIdToken();
  return callFunction(
    'addPlayer',
    { firstName, lastInitial, jerseyNumber, generalPosition },
    { authToken: idToken }
  );
}

/**
 * Coach-only: sends structured play data to the server-side AI Play
 * Analyzer (Play Intelligence V1) and returns strengths/weaknesses/best
 * situations/coverage fit/suggested metadata. Same auth pattern as
 * addPlayer — the backend verifies the Bearer ID token and checks
 * role==='coach' itself; this function is not a security boundary, just
 * the client-side call.
 */
export async function analyzePlay(playData) {
  if (!auth.currentUser) {
    throw new Error('You must be signed in as a coach to analyze a play');
  }
  const idToken = await auth.currentUser.getIdToken();
  return callFunction('analyzePlay', { play: playData }, { authToken: idToken });
}

/**
 * Coach-only: sends the Sideline Advisor's already-ranked candidates (never
 * the full Playbook, never raw snap data) to the server-side AI explanation
 * layer and returns a short natural-language sentence per playId (or null
 * for any candidate the server's anti-fabrication check rejected). Same
 * auth pattern as analyzePlay — the backend verifies the Bearer ID token
 * and checks role==='coach' itself.
 */
export async function explainRecommendations(situation, candidates) {
  if (!auth.currentUser) {
    throw new Error('You must be signed in as a coach to use the Sideline Advisor');
  }
  const idToken = await auth.currentUser.getIdToken();
  return callFunction('sidelineAdvisorExplain', { situation, candidates }, { authToken: idToken });
}

/**
 * Coach-only: sends the already-computed deterministic postgame data
 * (never raw snaps, never the full Playbook) to the server-side Postgame
 * AI summary layer. Returns { summary: string|null } — null means the
 * server's anti-fabrication check rejected the model's output, or the
 * call failed; either way the caller's deterministic report already
 * works on its own, so a null summary is never a broken experience.
 */
export async function getPostgameSummary(postgameData) {
  if (!auth.currentUser) {
    throw new Error('You must be signed in as a coach to generate a Postgame AI summary');
  }
  const idToken = await auth.currentUser.getIdToken();
  return callFunction('postgameSummary', { postgameData }, { authToken: idToken });
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
