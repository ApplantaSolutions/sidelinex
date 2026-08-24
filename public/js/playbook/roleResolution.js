// Pure slot <-> player resolution logic. No Firestore, no DOM — this is
// the "critical groundwork" piece from the roadmap: once Weekly Roles
// says "WR1 = Jacob" for a game, everything downstream (My Plays, Watch
// My Job, eventually personalized wristbands) is built on these few
// functions, kept intentionally small and independently testable.

/**
 * Given the set of plays actually in a Game Plan (each with its side and
 * the slot labels used in its fieldDesign), returns the union of distinct
 * slots per side. This is what makes Weekly Roles format-agnostic: it
 * never hardcodes "QB/C/WR1/WR2/WR3" — it just reflects whatever slots
 * the coach's own plays actually use, so a 6v6 or 7v7 team's extra
 * receiver slots show up automatically, and an unused suggested slot
 * never clutters the roles screen.
 *
 * @param {Array<{side: 'offense'|'defense', slots: string[]}>} plays
 * @returns {{offense: string[], defense: string[]}}
 */
export function deriveUsedSlots(plays) {
  const offense = new Set();
  const defense = new Set();
  (plays || []).forEach((p) => {
    const target = p.side === 'defense' ? defense : offense;
    (p.slots || []).forEach((s) => target.add(s));
  });
  return {
    offense: [...offense].sort(),
    defense: [...defense].sort(),
  };
}

/**
 * Resolves a single slot to the playerId assigned to it this week, or
 * null if unassigned. weeklyRoles is the {offense, defense} shape stored
 * by setWeeklyRoles.
 */
export function resolvePlayerForSlot(weeklyRoles, side, slot) {
  const map = side === 'defense' ? weeklyRoles?.defense : weeklyRoles?.offense;
  return map?.[slot] || null;
}

/**
 * The inverse: given a playerId, which slot(s) do they hold this week on
 * a given side? Usually exactly one (that's the "no obvious conflicts"
 * case), but this returns all matches so a conflict can be surfaced
 * rather than silently picking one.
 */
export function slotsForPlayer(weeklyRoles, side, playerId) {
  const map = side === 'defense' ? weeklyRoles?.defense : weeklyRoles?.offense;
  if (!map) return [];
  return Object.entries(map)
    .filter(([, pid]) => pid === playerId)
    .map(([slot]) => slot);
}

/**
 * Flags any player holding more than one slot on the SAME side this
 * week — an "obvious conflict" per the roadmap (a player can't physically
 * line up at both WR1 and WR2 on the same play). Deliberately does NOT
 * block saving — the roadmap says "don't over-restrict the coach" — this
 * is surfaced as a warning for the coach to see and decide about, e.g. a
 * two-way player who's genuinely fine playing multiple spots across
 * different plays.
 */
export function findRoleConflicts(roleMap) {
  const byPlayer = {};
  Object.entries(roleMap || {}).forEach(([slot, playerId]) => {
    if (!playerId) return;
    (byPlayer[playerId] ||= []).push(slot);
  });
  return Object.entries(byPlayer)
    .filter(([, slots]) => slots.length > 1)
    .map(([playerId, slots]) => ({ playerId, slots }));
}

/**
 * For one specific player, builds their full set of assignments across
 * every play in a Game Plan: which plays they're actually in, which slot
 * they hold in each, and that slot's assignment data (route/job/why/key,
 * designation). This is exactly the data My Plays / Watch My Job need —
 * kept as one pure function so the UI layer only has to loop and render,
 * never re-derive the resolution logic itself.
 *
 * @param {Array<{playId, order, isCore}>} entries - the Game Plan's stored entries
 * @param {Object.<string, {play: object, version: object}>} playsById - playId -> {play, version}, pre-fetched
 * @param {{offense: object, defense: object}} weeklyRoles
 * @param {string} playerId
 * @returns {Array<{playId, order, isCore, play, slot, assignment, design}>}
 */
export function buildPlayerAssignments(entries, playsById, weeklyRoles, playerId) {
  const results = [];
  (entries || [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((entry) => {
      const found = playsById[entry.playId];
      if (!found || !found.play) return;
      const { play, version } = found;
      const design = version?.fieldDesign || { positions: {}, routes: {} };
      const mySlots = slotsForPlayer(weeklyRoles, play.side, playerId).filter((s) => design.positions[s]);
      if (mySlots.length === 0) return;
      // A player can only physically hold one slot in a given play's
      // design (Weekly Roles conflicts aside) — take the first match.
      const slot = mySlots[0];
      results.push({
        playId: entry.playId,
        order: entry.order,
        isCore: !!entry.isCore,
        play,
        slot,
        assignment: version?.assignments?.[slot] || null,
        design,
      });
    });
  return results;
}
