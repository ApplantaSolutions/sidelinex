import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sumBlockDuration, deriveDurationSummary, reorderBlocks, resolveAssignmentPlayerIds,
  isPlayerInBlock, deriveChecklistSummary,
} from './practiceLogic.js';

test('sumBlockDuration sums real block durations, treating a missing duration as 0', () => {
  const blocks = [{ durationMinutes: 10 }, { durationMinutes: 15 }, {}];
  assert.equal(sumBlockDuration(blocks), 25);
});

test('sumBlockDuration on an empty agenda is 0, never fabricated', () => {
  assert.equal(sumBlockDuration([]), 0);
});

test('deriveDurationSummary computes scheduled vs. planned honestly, including a negative remainder when over-scheduled', () => {
  const blocks = [{ durationMinutes: 60 }, { durationMinutes: 40 }];
  const summary = deriveDurationSummary(blocks, 90);
  assert.equal(summary.scheduled, 100);
  assert.equal(summary.planned, 90);
  assert.equal(summary.remaining, -10);
});

test('reorderBlocks moves a block and reassigns a clean, gapless order sequence', () => {
  const blocks = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }, { id: 'c', order: 2 }];
  const reordered = reorderBlocks(blocks, 2, 0); // move 'c' to the front
  assert.deepEqual(reordered.map((b) => b.id), ['c', 'a', 'b']);
  assert.deepEqual(reordered.map((b) => b.order), [0, 1, 2]);
});

test('reorderBlocks with an out-of-range index is a safe no-op, never throws or corrupts the list', () => {
  const blocks = [{ id: 'a', order: 0 }];
  assert.deepEqual(reorderBlocks(blocks, 5, 0), blocks);
});

test('resolveAssignmentPlayerIds for "team" returns every active player', () => {
  const players = [{ id: 'p1' }, { id: 'p2' }];
  const ids = resolveAssignmentPlayerIds({ assignmentType: 'team' }, players, {});
  assert.deepEqual(ids, ['p1', 'p2']);
});

test('resolveAssignmentPlayerIds for "players" returns exactly the chosen ids, no more no less', () => {
  const ids = resolveAssignmentPlayerIds({ assignmentType: 'players', assignedPlayerIds: ['p3'] }, [{ id: 'p1' }, { id: 'p3' }], {});
  assert.deepEqual(ids, ['p3']);
});

test('resolveAssignmentPlayerIds for "role" resolves via real Weekly Roles data, never asking the coach to re-type a name', () => {
  const weeklyRoles = { offense: { WR1: 'jacob' }, defense: {} };
  const ids = resolveAssignmentPlayerIds({ assignmentType: 'role', assignedRole: 'WR1' }, [], weeklyRoles);
  assert.deepEqual(ids, ['jacob']);
});

test('resolveAssignmentPlayerIds for "role" checks both offense and defense role maps', () => {
  const weeklyRoles = { offense: {}, defense: { Rusher: 'amani' } };
  const ids = resolveAssignmentPlayerIds({ assignmentType: 'role', assignedRole: 'Rusher' }, [], weeklyRoles);
  assert.deepEqual(ids, ['amani']);
});

test('resolveAssignmentPlayerIds for an unassigned role or malformed block returns an empty array, never a guess', () => {
  assert.deepEqual(resolveAssignmentPlayerIds({ assignmentType: 'role', assignedRole: null }, [], {}), []);
  assert.deepEqual(resolveAssignmentPlayerIds(null, [], {}), []);
  assert.deepEqual(resolveAssignmentPlayerIds({ assignmentType: 'unknown' }, [], {}), []);
});

test('isPlayerInBlock correctly reflects whether a specific player is really part of this block', () => {
  const weeklyRoles = { offense: { WR1: 'jacob' }, defense: {} };
  assert.equal(isPlayerInBlock({ assignmentType: 'role', assignedRole: 'WR1' }, 'jacob', weeklyRoles, []), true);
  assert.equal(isPlayerInBlock({ assignmentType: 'role', assignedRole: 'WR1' }, 'wr2', weeklyRoles, []), false);
});

test('deriveChecklistSummary counts only real completed items, out of a fixed real total', () => {
  const checklist = { reviewedMyPlays: { done: true }, watchedMyJob: { done: true }, reviewedAssignments: { done: false } };
  const summary = deriveChecklistSummary(checklist);
  assert.equal(summary.done, 2);
  assert.equal(summary.total, 4);
});

test('deriveChecklistSummary on a completely empty/missing checklist is 0 done, never a crash', () => {
  assert.deepEqual(deriveChecklistSummary(null), { done: 0, total: 4 });
  assert.deepEqual(deriveChecklistSummary({}), { done: 0, total: 4 });
});
