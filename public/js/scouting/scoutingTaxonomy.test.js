import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFENSIVE_LOOKS, TENDENCY_TAGS, RUSHER_TAGS, PLAYMAKER_STRENGTH_TAGS, SITUATIONS, SOURCE_TYPES, ALIGNMENT_MODES, labelFor,
} from './scoutingTaxonomy.js';

const LISTS = { DEFENSIVE_LOOKS, TENDENCY_TAGS, RUSHER_TAGS, PLAYMAKER_STRENGTH_TAGS, SITUATIONS, ALIGNMENT_MODES };

test('every taxonomy list has unique, non-empty values and labels', () => {
  Object.entries(LISTS).forEach(([name, list]) => {
    assert.ok(list.length > 0, `${name} should not be empty`);
    const values = list.map((item) => item.value);
    assert.equal(new Set(values).size, values.length, `${name} has duplicate values`);
    list.forEach((item) => {
      assert.ok(item.value, `${name} entry missing a value`);
      assert.ok(item.label, `${name} entry missing a label`);
    });
  });
});

test('DEFENSIVE_LOOKS reuses the exact MAN/ZONE/PRESSURE strings already stored on snaps', () => {
  const values = DEFENSIVE_LOOKS.map((d) => d.value);
  assert.ok(values.includes('MAN'));
  assert.ok(values.includes('ZONE'));
  assert.ok(values.includes('PRESSURE'));
});

test('ALIGNMENT_MODES reuses the exact lowercase mode vocabulary from Play Designer defense.mode', () => {
  const values = ALIGNMENT_MODES.map((m) => m.value);
  assert.deepEqual(values, ['man', 'zone', 'pressure', 'custom']);
});

test('SOURCE_TYPES has the 3 distinct provenance labels required for honest scouting statements', () => {
  assert.deepEqual(Object.keys(SOURCE_TYPES), ['COACH_SCOUTING', 'OBSERVED_TODAY', 'HISTORICAL_DATA']);
});

test('labelFor returns the real label for a known value', () => {
  assert.equal(labelFor(DEFENSIVE_LOOKS, 'MAN'), 'Man');
});

test('labelFor falls back to the raw value for an unknown one, rather than throwing', () => {
  assert.equal(labelFor(DEFENSIVE_LOOKS, 'NOT_REAL'), 'NOT_REAL');
});
