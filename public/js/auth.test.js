'use strict';

// Exercises auth.js's real fetch-based call logic against a mocked
// firebase-init.js and a mocked global fetch — no network, no real
// Firebase SDK, but the actual auth.js module code runs unmodified.
// Requires --experimental-test-module-mocks (Node 22+).
//
// Deliberately a single test rather than several: ES module caching means
// firebase-init.js can only be usefully mocked once before auth.js's own
// top-level `import { auth, ... } from './firebase-init.js'` binding is
// resolved — a second mock.module() call after that first import has
// already happened has no effect on auth.js's already-bound references.
// global.fetch, by contrast, is looked up fresh on every call (it's never
// imported), so it's safe to reassign between assertions within this one
// test.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('auth.js: full call-logic walkthrough against mocked fetch + firebase-init', async () => {
  const signInCalls = [];
  const fakeAuth = { currentUser: null };

  mock.module('./firebase-init.js', {
    namedExports: {
      auth: fakeAuth,
      signInWithCustomToken: async (authArg, token) => {
        signInCalls.push({ authArg, token });
      },
      signOut: async () => {},
      onAuthStateChanged: () => () => {},
    },
  });

  const {
    createTeam,
    loginAsCoach,
    loginAsPlayer,
    getRosterForTeamCode,
    addPlayer,
    analyzePlay,
  } = await import('./auth.js');

  // --- createTeam: correct URL/body, signs in with the returned token ---
  let fetchCalls = [];
  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    return jsonResponse(200, { token: 'fake-custom-token', teamId: 'team123', teamCode: 'ABC123', seasonId: 'season1' });
  };
  const createResult = await createTeam({ teamName: 'Test Team', format: '5v5', coachAccessCode: '1234', seasonLabel: 'Fall' });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://sidelinex-functions.netlify.app/.netlify/functions/createTeam');
  assert.equal(fetchCalls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(fetchCalls[0].opts.body), {
    teamName: 'Test Team', format: '5v5', coachAccessCode: '1234', seasonLabel: 'Fall',
  });
  assert.equal(signInCalls.length, 1);
  assert.equal(signInCalls[0].token, 'fake-custom-token');
  assert.deepEqual(createResult, { teamId: 'team123', teamCode: 'ABC123', seasonId: 'season1' });

  // --- loginAsCoach: role:coach, no playerId in body ---
  let capturedBody;
  global.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return jsonResponse(200, { token: 'tok2', teamId: 'team123' });
  };
  const coachResult = await loginAsCoach({ teamCode: 'ABC123', accessCode: '1234' });
  assert.deepEqual(capturedBody, { teamCode: 'ABC123', role: 'coach', accessCode: '1234' });
  assert.deepEqual(coachResult, { teamId: 'team123' });

  // --- loginAsPlayer: role:player, playerId included ---
  global.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return jsonResponse(200, { token: 'tok3', teamId: 'team123' });
  };
  const playerResult = await loginAsPlayer({ teamCode: 'ABC123', playerId: 'p1', accessCode: '9999' });
  assert.deepEqual(capturedBody, { teamCode: 'ABC123', role: 'player', playerId: 'p1', accessCode: '9999' });
  assert.deepEqual(playerResult, { teamId: 'team123', playerId: 'p1' });

  // --- getRosterForTeamCode: correct URL, returns parsed payload ---
  let capturedUrl;
  global.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body);
    return jsonResponse(200, { teamName: 'Test Team', roster: [{ id: 'p1', firstName: 'Ariana', jerseyNumber: 7 }] });
  };
  const roster = await getRosterForTeamCode('ABC123');
  assert.equal(capturedUrl, 'https://sidelinex-functions.netlify.app/.netlify/functions/getRosterPicker');
  assert.deepEqual(capturedBody, { teamCode: 'ABC123' });
  assert.deepEqual(roster, { teamName: 'Test Team', roster: [{ id: 'p1', firstName: 'Ariana', jerseyNumber: 7 }] });

  // --- addPlayer with no signed-in user: rejects before ever calling fetch ---
  fakeAuth.currentUser = null;
  let fetchCalledDuringRejection = false;
  global.fetch = async () => {
    fetchCalledDuringRejection = true;
    return jsonResponse(200, {});
  };
  await assert.rejects(() => addPlayer({ firstName: 'Test' }), /You must be signed in as a coach/);
  assert.equal(fetchCalledDuringRejection, false);

  // --- addPlayer with a signed-in coach: sends the ID token as Bearer ---
  fakeAuth.currentUser = { getIdToken: async () => 'fake-id-token' };
  let capturedHeaders;
  global.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    capturedBody = JSON.parse(opts.body);
    return jsonResponse(200, { playerId: 'p1', accessCode: '4321' });
  };
  const addResult = await addPlayer({ firstName: 'Ariana', lastInitial: 'M', jerseyNumber: 7, generalPosition: 'WR' });
  assert.equal(capturedHeaders.Authorization, 'Bearer fake-id-token');
  assert.deepEqual(capturedBody, { firstName: 'Ariana', lastInitial: 'M', jerseyNumber: 7, generalPosition: 'WR' });
  assert.deepEqual(addResult, { playerId: 'p1', accessCode: '4321' });

  // --- analyzePlay: requires a signed-in coach, sends the play data + Bearer token ---
  fakeAuth.currentUser = { getIdToken: async () => 'coach-id-token' };
  let analyzeUrl, analyzeHeaders, analyzeBody;
  global.fetch = async (url, opts) => {
    analyzeUrl = url;
    analyzeHeaders = opts.headers;
    analyzeBody = JSON.parse(opts.body);
    return jsonResponse(200, { strengths: ['Strong vs Man'], coverageFit: { man: { confidence: 'HIGH', why: 'test' } } });
  };
  const analysis = await analyzePlay({ formation: 'Trips Right', side: 'offense' });
  assert.equal(analyzeUrl, 'https://sidelinex-functions.netlify.app/.netlify/functions/analyzePlay');
  assert.equal(analyzeHeaders.Authorization, 'Bearer coach-id-token');
  assert.deepEqual(analyzeBody, { play: { formation: 'Trips Right', side: 'offense' } });
  assert.deepEqual(analysis.strengths, ['Strong vs Man']);

  // --- analyzePlay with no signed-in user: rejects before ever calling fetch ---
  fakeAuth.currentUser = null;
  let analyzeFetchCalled = false;
  global.fetch = async () => { analyzeFetchCalled = true; return jsonResponse(200, {}); };
  await assert.rejects(() => analyzePlay({}), /You must be signed in as a coach/);
  assert.equal(analyzeFetchCalled, false);

  // --- a non-ok response surfaces the server's error message ---
  global.fetch = async () => jsonResponse(403, { error: { code: 'permission-denied', message: 'Incorrect access code' } });
  await assert.rejects(
    () => loginAsCoach({ teamCode: 'ABC123', accessCode: 'wrong' }),
    /Incorrect access code/
  );
});
