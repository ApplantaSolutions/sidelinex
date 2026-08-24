import test from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateWristbandCodes, computeWristbandLayout } from './wristbandLogic.js';

test('findDuplicateWristbandCodes flags a code used by two plays', () => {
  const entries = [{ playId: 'a' }, { playId: 'b' }, { playId: 'c' }];
  const playsById = {
    a: { id: 'a', name: 'Green Grass', wristbandCode: '12' },
    b: { id: 'b', name: 'Red Zone', wristbandCode: '12' },
    c: { id: 'c', name: 'Jet Right', wristbandCode: '13' },
  };
  const dupes = findDuplicateWristbandCodes(entries, playsById);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].code, '12');
  assert.deepEqual(dupes[0].playIds.sort(), ['a', 'b']);
});

test('findDuplicateWristbandCodes returns empty when all codes are distinct', () => {
  const entries = [{ playId: 'a' }, { playId: 'b' }];
  const playsById = {
    a: { id: 'a', name: 'A', wristbandCode: '1' },
    b: { id: 'b', name: 'B', wristbandCode: '2' },
  };
  assert.deepEqual(findDuplicateWristbandCodes(entries, playsById), []);
});

test('findDuplicateWristbandCodes ignores plays with no wristband code set', () => {
  const entries = [{ playId: 'a' }, { playId: 'b' }];
  const playsById = {
    a: { id: 'a', name: 'A', wristbandCode: '' },
    b: { id: 'b', name: 'B', wristbandCode: null },
  };
  assert.deepEqual(findDuplicateWristbandCodes(entries, playsById), []);
});

test('findDuplicateWristbandCodes trims whitespace before comparing', () => {
  const entries = [{ playId: 'a' }, { playId: 'b' }];
  const playsById = {
    a: { id: 'a', name: 'A', wristbandCode: '12 ' },
    b: { id: 'b', name: 'B', wristbandCode: ' 12' },
  };
  const dupes = findDuplicateWristbandCodes(entries, playsById);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].code, '12');
});

test('computeWristbandLayout groups plays into panels of the configured size', () => {
  const result = computeWristbandLayout({
    totalPlays: 7,
    playsPerPanel: 3,
    insertWidthIn: 2,
    insertHeightIn: 2.5,
    marginIn: 0.25,
  });
  assert.equal(result.panelsNeeded, 3); // ceil(7/3)
  assert.equal(result.panelGroups.length, 3);
  assert.deepEqual(result.panelGroups[0], [0, 1, 2]);
  assert.deepEqual(result.panelGroups[1], [3, 4, 5]);
  assert.deepEqual(result.panelGroups[2], [6]);
});

test('computeWristbandLayout handles zero plays without dividing by zero', () => {
  const result = computeWristbandLayout({
    totalPlays: 0,
    playsPerPanel: 3,
    insertWidthIn: 2,
    insertHeightIn: 2.5,
    marginIn: 0.25,
  });
  assert.equal(result.panelsNeeded, 0);
  assert.equal(result.pagesNeeded, 0);
  assert.deepEqual(result.panelGroups, []);
});

test('computeWristbandLayout fits multiple panels across a standard letter page', () => {
  // 4 panels of 2in wide with 0.25in margins should fit across an 8.5in page:
  // usableW = 8.5 - 0.5 = 8, (8+0.25)/(2+0.25) = 3.66 -> floor 3
  const result = computeWristbandLayout({
    totalPlays: 1,
    playsPerPanel: 1,
    insertWidthIn: 2,
    insertHeightIn: 2.5,
    marginIn: 0.25,
    pageWidthIn: 8.5,
    pageHeightIn: 11,
  });
  assert.equal(result.panelsAcrossPage, 3);
  assert.ok(result.panelsDownPage >= 1);
});

test('computeWristbandLayout computes multiple pages when panels exceed one page', () => {
  const result = computeWristbandLayout({
    totalPlays: 30,
    playsPerPanel: 1,
    insertWidthIn: 4,
    insertHeightIn: 5,
    marginIn: 0.25,
  });
  // Only 1-2 panels fit per page at 4x5in, so 30 single-play panels need multiple pages
  assert.ok(result.pagesNeeded > 1);
  assert.equal(result.panelsNeeded, 30);
});

test('computeWristbandLayout guards against a zero/invalid playsPerPanel', () => {
  const result = computeWristbandLayout({
    totalPlays: 5,
    playsPerPanel: 0,
    insertWidthIn: 2,
    insertHeightIn: 2.5,
    marginIn: 0.25,
  });
  assert.equal(result.panelsNeeded, 5); // falls back to 1 play per panel
});
