import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveUsedSlots,
  resolvePlayerForSlot,
  slotsForPlayer,
  findRoleConflicts,
  buildPlayerAssignments,
} from './roleResolution.js';

test('deriveUsedSlots unions slots per side across multiple plays', () => {
  const plays = [
    { side: 'offense', slots: ['QB', 'C', 'WR1'] },
    { side: 'offense', slots: ['QB', 'WR2'] },
    { side: 'defense', slots: ['RUSH', 'COVER1'] },
  ];
  const result = deriveUsedSlots(plays);
  assert.deepEqual(result.offense, ['C', 'QB', 'WR1', 'WR2']);
  assert.deepEqual(result.defense, ['COVER1', 'RUSH']);
});

test('deriveUsedSlots handles an empty play list', () => {
  assert.deepEqual(deriveUsedSlots([]), { offense: [], defense: [] });
});

test('deriveUsedSlots handles a play with no slots field', () => {
  assert.deepEqual(deriveUsedSlots([{ side: 'offense' }]), { offense: [], defense: [] });
});

test('resolvePlayerForSlot reads the correct side', () => {
  const roles = { offense: { WR1: 'p1', QB: 'p2' }, defense: { RUSH: 'p3' } };
  assert.equal(resolvePlayerForSlot(roles, 'offense', 'WR1'), 'p1');
  assert.equal(resolvePlayerForSlot(roles, 'defense', 'RUSH'), 'p3');
});

test('resolvePlayerForSlot returns null for an unassigned slot', () => {
  const roles = { offense: {}, defense: {} };
  assert.equal(resolvePlayerForSlot(roles, 'offense', 'WR1'), null);
});

test('resolvePlayerForSlot tolerates a completely missing weeklyRoles', () => {
  assert.equal(resolvePlayerForSlot(undefined, 'offense', 'WR1'), null);
});

test('slotsForPlayer finds every slot a player holds on one side', () => {
  const roles = { offense: { WR1: 'p1', WR2: 'p1', QB: 'p2' }, defense: {} };
  assert.deepEqual(slotsForPlayer(roles, 'offense', 'p1').sort(), ['WR1', 'WR2']);
  assert.deepEqual(slotsForPlayer(roles, 'offense', 'p2'), ['QB']);
  assert.deepEqual(slotsForPlayer(roles, 'offense', 'nobody'), []);
});

test('findRoleConflicts flags a player double-booked on the same side', () => {
  const roleMap = { WR1: 'p1', WR2: 'p1', QB: 'p2' };
  const conflicts = findRoleConflicts(roleMap);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].playerId, 'p1');
  assert.deepEqual(conflicts[0].slots.sort(), ['WR1', 'WR2']);
});

test('findRoleConflicts returns empty when every slot has a distinct player', () => {
  const roleMap = { WR1: 'p1', WR2: 'p2', QB: 'p3' };
  assert.deepEqual(findRoleConflicts(roleMap), []);
});

test('findRoleConflicts ignores unassigned (null) slots', () => {
  const roleMap = { WR1: 'p1', WR2: null, QB: undefined };
  assert.deepEqual(findRoleConflicts(roleMap), []);
});

test('buildPlayerAssignments returns only plays where the player actually has a slot', () => {
  const entries = [
    { playId: 'play1', order: 0, isCore: true },
    { playId: 'play2', order: 1, isCore: false },
  ];
  const playsById = {
    play1: {
      play: { id: 'play1', side: 'offense', name: 'Slant Right' },
      version: {
        fieldDesign: { positions: { WR1: { x: 0.8, y: 0.7 }, QB: { x: 0.5, y: 0.75 } }, routes: {} },
        assignments: { WR1: { route: 'Slant', job: 'Get open inside' } },
      },
    },
    play2: {
      play: { id: 'play2', side: 'offense', name: 'QB Keeper' },
      version: {
        fieldDesign: { positions: { QB: { x: 0.5, y: 0.75 } }, routes: {} },
        assignments: {},
      },
    },
  };
  const weeklyRoles = { offense: { WR1: 'jacob', QB: 'amani' }, defense: {} };

  const jacobPlays = buildPlayerAssignments(entries, playsById, weeklyRoles, 'jacob');
  assert.equal(jacobPlays.length, 1);
  assert.equal(jacobPlays[0].playId, 'play1');
  assert.equal(jacobPlays[0].slot, 'WR1');
  assert.equal(jacobPlays[0].assignment.route, 'Slant');
  assert.equal(jacobPlays[0].isCore, true);

  const amaniPlays = buildPlayerAssignments(entries, playsById, weeklyRoles, 'amani');
  assert.equal(amaniPlays.length, 2);
  assert.equal(amaniPlays[0].playId, 'play1'); // sorted by order
  assert.equal(amaniPlays[1].playId, 'play2');
});

test('buildPlayerAssignments respects explicit order over entry array order', () => {
  const entries = [
    { playId: 'playB', order: 5, isCore: false },
    { playId: 'playA', order: 1, isCore: false },
  ];
  const playsById = {
    playA: { play: { id: 'playA', side: 'offense', name: 'A' }, version: { fieldDesign: { positions: { QB: { x: 0.5, y: 0.75 } }, routes: {} }, assignments: {} } },
    playB: { play: { id: 'playB', side: 'offense', name: 'B' }, version: { fieldDesign: { positions: { QB: { x: 0.5, y: 0.75 } }, routes: {} }, assignments: {} } },
  };
  const weeklyRoles = { offense: { QB: 'amani' }, defense: {} };
  const result = buildPlayerAssignments(entries, playsById, weeklyRoles, 'amani');
  assert.deepEqual(result.map((r) => r.playId), ['playA', 'playB']);
});

test('buildPlayerAssignments skips an entry whose play was not found in playsById', () => {
  const entries = [{ playId: 'missing', order: 0, isCore: false }];
  const result = buildPlayerAssignments(entries, {}, { offense: {}, defense: {} }, 'anyone');
  assert.deepEqual(result, []);
});

test('buildPlayerAssignments defaults a missing fieldDesign/assignments gracefully', () => {
  const entries = [{ playId: 'play1', order: 0, isCore: false }];
  const playsById = { play1: { play: { id: 'play1', side: 'offense', name: 'Bare' }, version: null } };
  const weeklyRoles = { offense: { WR1: 'p1' }, defense: {} };
  const result = buildPlayerAssignments(entries, playsById, weeklyRoles, 'p1');
  assert.deepEqual(result, []); // no positions in design => player has no slot here
});
