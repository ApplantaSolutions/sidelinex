import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFieldSvgMarkup } from './staticFieldSvg.js';

const SAMPLE_DESIGN = {
  positions: {
    QB: { x: 0.5, y: 0.75 },
    WR1: { x: 0.85, y: 0.72 },
  },
  routes: {
    WR1: { points: [{ x: 0.85, y: 0.72 }, { x: 0.85, y: 0.3 }], designation: 'primary' },
  },
};

test('returns a well-formed svg string', () => {
  const svg = buildFieldSvgMarkup(SAMPLE_DESIGN);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
});

test('renders one marker per position', () => {
  const svg = buildFieldSvgMarkup(SAMPLE_DESIGN);
  const markerCount = (svg.match(/<circle r="22"/g) || []).length;
  assert.equal(markerCount, 2);
});

test('renders a route polyline only for slots with 2+ points', () => {
  const svg = buildFieldSvgMarkup(SAMPLE_DESIGN);
  assert.equal((svg.match(/<polyline/g) || []).length, 1);
});

test('skips a route with fewer than 2 points (e.g. QB with no route)', () => {
  const design = { positions: { QB: { x: 0.5, y: 0.75 } }, routes: { QB: { points: null } } };
  const svg = buildFieldSvgMarkup(design);
  assert.equal((svg.match(/<polyline/g) || []).length, 0);
});

test('handles a completely empty design without throwing', () => {
  const svg = buildFieldSvgMarkup({ positions: {}, routes: {} });
  assert.match(svg, /<svg/);
});

test('handles missing positions/routes fields gracefully', () => {
  const svg = buildFieldSvgMarkup({});
  assert.match(svg, /<svg/);
});

test('compact mode omits the slot-label text elements', () => {
  const normal = buildFieldSvgMarkup(SAMPLE_DESIGN, { compact: false });
  const compact = buildFieldSvgMarkup(SAMPLE_DESIGN, { compact: true });
  assert.match(normal, /<text/);
  assert.doesNotMatch(compact, /<text/);
});

test('highlightSlot dims every other marker and route, not the highlighted one', () => {
  const svg = buildFieldSvgMarkup(SAMPLE_DESIGN, { highlightSlot: 'WR1' });
  // QB (not highlighted) should carry opacity 0.35
  assert.match(svg, /opacity="0\.35"/);
  // WR1's own group should carry full opacity 1
  assert.match(svg, /opacity="1"/);
  // WR1's marker gets the gold highlight ring only when it's the target
  assert.match(svg, /fill="#c9a227" opacity="0\.3"/);
});

test('with no highlightSlot, nothing is dimmed', () => {
  const svg = buildFieldSvgMarkup(SAMPLE_DESIGN);
  assert.doesNotMatch(svg, /opacity="0\.35"/);
});

test('escapes a slot label that contains XML-unsafe characters', () => {
  const design = { positions: { 'WR<1>&"\'': { x: 0.5, y: 0.5 } }, routes: {} };
  const svg = buildFieldSvgMarkup(design);
  assert.doesNotMatch(svg, /WR<1>/);
  assert.match(svg, /WR&lt;1&gt;&amp;&quot;&apos;/);
});

test('respects a custom viewW/viewH for scaling the coordinate space', () => {
  const design = { positions: { WR1: { x: 1, y: 1 } }, routes: {} };
  const svg = buildFieldSvgMarkup(design, { viewW: 200, viewH: 100 });
  assert.match(svg, /translate\(200, 100\)/);
});
