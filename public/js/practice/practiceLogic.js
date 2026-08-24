// Practice Planner V1's pure, testable core. No DOM, no Firestore — just
// the few genuinely computed behaviors in an otherwise CRUD-heavy
// feature: duration math, block reordering, and resolving an assignment
// (team/players/role) down to real player ids using data SidelineX
// already has (Weekly Roles), never asking the coach to re-type names.

/**
 * @param {Array<{durationMinutes:number}>} blocks
 * @returns total scheduled minutes across every block — never fabricated,
 * always a real sum of what's actually on the agenda.
 */
export function sumBlockDuration(blocks) {
  return (blocks || []).reduce((sum, b) => sum + (Number(b.durationMinutes) || 0), 0);
}

/**
 * @returns {{scheduled: number, planned: number, remaining: number}}
 * remaining can go negative — that's a real, useful signal (over-scheduled),
 * never hidden or clamped to zero.
 */
export function deriveDurationSummary(blocks, plannedDurationMinutes) {
  const scheduled = sumBlockDuration(blocks);
  const planned = Number(plannedDurationMinutes) || 0;
  return { scheduled, planned, remaining: planned - scheduled };
}

/**
 * Moves the block at fromIndex to toIndex and reassigns `order` for every
 * block 0..n-1 in the new sequence — order is always a clean, gapless
 * integer sequence after any reorder, never inherited stale values.
 */
export function reorderBlocks(blocks, fromIndex, toIndex) {
  const list = [...(blocks || [])];
  if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return list;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  return list.map((b, i) => ({ ...b, order: i }));
}

/**
 * Resolves a block's assignment down to real player ids using data
 * SidelineX already has:
 *  - 'team': every active player.
 *  - 'players': exactly the explicitly chosen ids.
 *  - 'role': whoever currently holds that slot in Weekly Roles (offense
 *    or defense, whichever has it) — never asks the coach to pick the
 *    player by name again once a role is chosen.
 */
export function resolveAssignmentPlayerIds(block, players, weeklyRoles) {
  if (!block) return [];
  if (block.assignmentType === 'team') return (players || []).map((p) => p.id);
  if (block.assignmentType === 'players') return block.assignedPlayerIds || [];
  if (block.assignmentType === 'role') {
    const role = block.assignedRole;
    if (!role) return [];
    const offenseMatch = weeklyRoles?.offense?.[role];
    const defenseMatch = weeklyRoles?.defense?.[role];
    return [offenseMatch, defenseMatch].filter(Boolean);
  }
  return [];
}

/**
 * Whether a given player is part of this block at all — the exact check
 * Player Mode's "My Practice" uses to decide what's relevant to show a
 * specific player, never exposing every block to every player.
 */
export function isPlayerInBlock(block, playerId, weeklyRoles, players) {
  return resolveAssignmentPlayerIds(block, players, weeklyRoles).includes(playerId);
}

const CHECKLIST_ITEMS = ['reviewedMyPlays', 'watchedMyJob', 'reviewedAssignments', 'practiceAssignmentComplete'];

/**
 * @param {Object.<string, {done: boolean}>} checklist
 * @returns {{done: number, total: number}} — a real count, never a
 * fabricated "you're X% ready" claim.
 */
export function deriveChecklistSummary(checklist) {
  const done = CHECKLIST_ITEMS.filter((key) => checklist?.[key]?.done).length;
  return { done, total: CHECKLIST_ITEMS.length };
}

export { CHECKLIST_ITEMS };
