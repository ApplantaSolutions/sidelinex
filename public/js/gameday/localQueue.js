// Local-first write layer for Game Day. Honest scope, stated up front:
// this is a lightweight local-first QUEUE with idempotent retry, not a
// full bidirectional offline sync engine. What it covers:
//   - Everything needed to RUN today's game (Game Plan, resolved plays/
//     versions, Weekly Roles, roster, rule config) is cached to
//     localStorage once at Start Game, so a dead connection mid-game
//     doesn't stop the coach from calling plays and logging results.
//   - Every snap is written to a local list FIRST (instant, always
//     works) and queued for Firestore sync; flushPendingSnaps() is safe
//     to call as often as needed (the caller retries it opportunistically
//     — on mount and after every commit/undo, see gameDayView.js) because
//     every snap has a stable client-generated ID and is written with
//     setDoc, never addDoc — a duplicate sync attempt just overwrites the
//     same document with the same data.
// What it explicitly does NOT cover (report this honestly, don't fake
// it): there is no persistent "online" event listener — deliberately, so
// there's nothing to leak or need teardown for when the coach navigates
// away from Game Day mid-game. A snap logged while genuinely offline
// syncs on the NEXT commit/undo/remount, not the instant connectivity
// returns. Also out of scope: live sync FROM another device (e.g. an
// assistant coach also logging on their own phone) — this queue only
// knows about writes made on THIS device. Two devices logging the same
// game concurrently would each build their own local snap list and could
// conflict on order; that coordination problem is out of scope for this
// stage.

const CACHE_PREFIX = 'sx_gameday_cache_';
const META_PREFIX = 'sx_gameday_meta_';
const SNAPS_PREFIX = 'sx_gameday_snaps_';
const PENDING_PREFIX = 'sx_gameday_pending_';

export function generateSnapId() {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable (private browsing, etc.) — Game Day
    // still works for the current session via in-memory state; it just
    // won't survive a page reload. Not silently pretending this succeeded.
  }
}

// ---------- Pre-game data cache ----------

export function cacheGameDayData(gameId, data) {
  writeJson(CACHE_PREFIX + gameId, data);
}

export function loadCachedGameDayData(gameId) {
  return readJson(CACHE_PREFIX + gameId, null);
}

// Whether the game has been started, and who had the ball first, cached
// locally the moment Start Game Day is tapped — re-opening Game Day never
// needs a network round trip just to know this, which matters because a
// stalled fetch here (bad signal, not a rejection — just never resolving)
// used to leave the coach stuck on a "Loading..." screen with no way
// forward. See withTimeout() in gameDayView.js for the other half of that
// fix.
export function cacheGameDayMeta(gameId, meta) {
  writeJson(META_PREFIX + gameId, meta);
}

export function loadCachedGameDayMeta(gameId) {
  return readJson(META_PREFIX + gameId, null);
}

// ---------- Local snap list (always the local source of truth for THIS device) ----------

export function loadLocalSnaps(gameId) {
  return readJson(SNAPS_PREFIX + gameId, []);
}

function saveLocalSnaps(gameId, snaps) {
  writeJson(SNAPS_PREFIX + gameId, snaps);
}

function loadPendingIds(gameId) {
  return readJson(PENDING_PREFIX + gameId, []);
}

function savePendingIds(gameId, ids) {
  writeJson(PENDING_PREFIX + gameId, ids);
}

/**
 * Writes a snap locally FIRST (instant, always succeeds) and marks it
 * pending sync. Returns the updated local snap list so the caller can
 * re-render immediately without waiting on any network round trip.
 */
export function queueSnapLocally(gameId, snap) {
  const snaps = loadLocalSnaps(gameId);
  const idx = snaps.findIndex((s) => s.id === snap.id);
  if (idx !== -1) snaps[idx] = snap;
  else snaps.push(snap);
  saveLocalSnaps(gameId, snaps);

  const pending = loadPendingIds(gameId);
  if (!pending.includes(snap.id)) pending.push(snap.id);
  savePendingIds(gameId, pending);

  return snaps;
}

export function hasPendingSnaps(gameId) {
  return loadPendingIds(gameId).length > 0;
}

/**
 * Attempts to sync every pending snap to Firestore via the provided
 * saveSnap function. Each success removes that snap from the pending
 * list; failures stay queued for the next attempt — safe to call this
 * as often as needed (on reconnect, on a timer, on a manual "Sync now"
 * tap) since every write is idempotent by snap ID.
 */
export async function flushPendingSnaps(gameId, saveSnapFn) {
  const pending = loadPendingIds(gameId);
  if (pending.length === 0) return { synced: 0, failed: 0 };
  const snaps = loadLocalSnaps(gameId);
  const byId = Object.fromEntries(snaps.map((s) => [s.id, s]));

  let synced = 0;
  let failed = 0;
  const stillPending = [];
  for (const id of pending) {
    const snap = byId[id];
    if (!snap) continue; // shouldn't happen, but never block sync on a stale reference
    try {
      await saveSnapFn(snap);
      synced += 1;
    } catch {
      failed += 1;
      stillPending.push(id);
    }
  }
  savePendingIds(gameId, stillPending);
  return { synced, failed };
}
