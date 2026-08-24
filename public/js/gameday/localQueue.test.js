import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal in-memory localStorage polyfill — Node has no built-in
// localStorage, and this module deliberately has no other browser
// dependency, so a plain Map-backed stub is enough to exercise the real
// module code (not a rewrite of it) under Node's test runner.
function installFakeLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}
installFakeLocalStorage();

const {
  generateSnapId,
  cacheGameDayData,
  loadCachedGameDayData,
  cacheGameDayMeta,
  loadCachedGameDayMeta,
  loadLocalSnaps,
  queueSnapLocally,
  hasPendingSnaps,
  flushPendingSnaps,
} = await import('./localQueue.js');

test('generateSnapId produces unique, stable-looking ids', () => {
  const a = generateSnapId();
  const b = generateSnapId();
  assert.notEqual(a, b);
  assert.match(a, /^snap-\d+-[a-z0-9]+$/);
});

test('cacheGameDayData / loadCachedGameDayData round-trips arbitrary game data', () => {
  const data = { plays: [{ id: 'p1' }], roster: [{ id: 'player1' }] };
  cacheGameDayData('game1', data);
  assert.deepEqual(loadCachedGameDayData('game1'), data);
});

test('loadCachedGameDayData returns null when nothing was cached for this game', () => {
  assert.equal(loadCachedGameDayData('never-cached-game'), null);
});

test('cacheGameDayMeta / loadCachedGameDayMeta round-trips the started/possession state', () => {
  const meta = { started: true, startingPossession: 'us' };
  cacheGameDayMeta('game1', meta);
  assert.deepEqual(loadCachedGameDayMeta('game1'), meta);
});

test('loadCachedGameDayMeta returns null when a game was never started locally', () => {
  assert.equal(loadCachedGameDayMeta('never-started-game'), null);
});

test('queueSnapLocally adds a new snap to the local list and marks it pending', () => {
  const snap = { id: 'snap-a', resultType: 'run', yards: 5 };
  const snaps = queueSnapLocally('game2', snap);
  assert.equal(snaps.length, 1);
  assert.deepEqual(loadLocalSnaps('game2'), [snap]);
  assert.equal(hasPendingSnaps('game2'), true);
});

test('queueSnapLocally overwrites an existing snap with the same id instead of duplicating it', () => {
  queueSnapLocally('game3', { id: 'snap-a', resultType: 'run', yards: 5 });
  queueSnapLocally('game3', { id: 'snap-a', resultType: 'run', yards: 8 }); // corrected yardage, same id
  const snaps = loadLocalSnaps('game3');
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].yards, 8);
});

test('flushPendingSnaps calls the save function for every pending snap and clears them on success', async () => {
  queueSnapLocally('game4', { id: 'snap-x', resultType: 'run', yards: 3 });
  queueSnapLocally('game4', { id: 'snap-y', resultType: 'complete', yards: 7 });
  const saved = [];
  const result = await flushPendingSnaps('game4', async (snap) => { saved.push(snap.id); });
  assert.equal(result.synced, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(saved.sort(), ['snap-x', 'snap-y']);
  assert.equal(hasPendingSnaps('game4'), false);
});

test('flushPendingSnaps leaves a snap pending if its save fails, and never loses it', async () => {
  queueSnapLocally('game5', { id: 'snap-fail', resultType: 'run', yards: 3 });
  const result = await flushPendingSnaps('game5', async () => { throw new Error('offline'); });
  assert.equal(result.synced, 0);
  assert.equal(result.failed, 1);
  assert.equal(hasPendingSnaps('game5'), true);
});

test('flushPendingSnaps retried after a prior failure succeeds and does not resend already-synced snaps', async () => {
  queueSnapLocally('game6', { id: 'snap-1', resultType: 'run', yards: 1 });
  queueSnapLocally('game6', { id: 'snap-2', resultType: 'run', yards: 2 });
  let callCount = 0;
  let shouldFail = true;
  const saveFn = async (snap) => {
    callCount += 1;
    if (snap.id === 'snap-2' && shouldFail) throw new Error('offline');
  };
  const first = await flushPendingSnaps('game6', saveFn);
  assert.equal(first.synced, 1);
  assert.equal(first.failed, 1);
  assert.equal(hasPendingSnaps('game6'), true);

  shouldFail = false;
  const second = await flushPendingSnaps('game6', saveFn);
  assert.equal(second.synced, 1); // only the still-pending one retried
  assert.equal(hasPendingSnaps('game6'), false);
  assert.equal(callCount, 3); // 2 attempts first round (1 ok, 1 fail) + 1 retry
});

test('flushPendingSnaps with nothing pending is a safe no-op', async () => {
  let called = false;
  const result = await flushPendingSnaps('game-never-queued', async () => { called = true; });
  assert.equal(result.synced, 0);
  assert.equal(result.failed, 0);
  assert.equal(called, false);
});

test('hasPendingSnaps is false for a game that has never queued anything', () => {
  assert.equal(hasPendingSnaps('totally-untouched-game'), false);
});
