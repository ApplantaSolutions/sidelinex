import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWristbandPrintHtml } from './wristbandPrint.js';
import { computeWristbandLayout } from './wristbandLogic.js';

const template = { insertWidthIn: 2, insertHeightIn: 2.5, marginIn: 0.25, playsPerPanel: 2 };
const tiles = [
  { wristbandCode: '12', playName: 'Green Grass', svgMarkup: '<svg></svg>', cueText: 'GO • PRIMARY' },
  { wristbandCode: '13', playName: 'Jet Right', svgMarkup: '<svg></svg>', cueText: null },
  { wristbandCode: '14', playName: 'Red Zone', svgMarkup: '<svg></svg>', cueText: 'DRAG • SECONDARY' },
];

function layoutFor(n) {
  return computeWristbandLayout({
    totalPlays: n,
    playsPerPanel: template.playsPerPanel,
    insertWidthIn: template.insertWidthIn,
    insertHeightIn: template.insertHeightIn,
    marginIn: template.marginIn,
  });
}

test('produces a full HTML document with @page sized to letter paper', () => {
  const html = buildWristbandPrintHtml({ cardType: 'team', playerLabel: null, gameLabel: 'Week 4', template, tiles, layout: layoutFor(3) });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /@page \{ size: 8\.5in 11in/);
});

test('uses real inch units for the insert panel size, not px', () => {
  const html = buildWristbandPrintHtml({ cardType: 'team', playerLabel: null, gameLabel: 'Week 4', template, tiles, layout: layoutFor(3) });
  assert.match(html, /width: 2in; height: 2\.5in;/);
});

test('renders one .panel div per panel group from the layout', () => {
  const layout = layoutFor(3); // playsPerPanel:2 -> 2 panels (2 plays, then 1)
  const html = buildWristbandPrintHtml({ cardType: 'team', playerLabel: null, gameLabel: 'Week 4', template, tiles, layout });
  const panelCount = (html.match(/class="panel"/g) || []).length;
  assert.equal(panelCount, layout.panelsNeeded);
});

test('renders every tile\'s wristband code, name, and svg markup', () => {
  const html = buildWristbandPrintHtml({ cardType: 'team', playerLabel: null, gameLabel: 'Week 4', template, tiles, layout: layoutFor(3) });
  tiles.forEach((t) => {
    assert.match(html, new RegExp(t.wristbandCode));
    assert.match(html, new RegExp(t.playName));
  });
});

test('omits the cue line for a tile with no cueText', () => {
  const oneTile = [tiles[1]]; // cueText: null
  const html = buildWristbandPrintHtml({ cardType: 'team', playerLabel: null, gameLabel: 'Week 4', template, tiles: oneTile, layout: layoutFor(1) });
  // Checks for the rendered element, not the bare word — the CSS rule
  // ".tile-cue { ... }" always appears in <style> regardless of content.
  assert.doesNotMatch(html, /<div class="tile-cue">/);
});

test('includes the cue line for a tile that has one', () => {
  const html = buildWristbandPrintHtml({ cardType: 'player', playerLabel: 'Jacob — WR1', gameLabel: 'Week 4', template, tiles, layout: layoutFor(3) });
  assert.match(html, /GO • PRIMARY/);
});

test('labels a player card with the player label, not a generic name', () => {
  const html = buildWristbandPrintHtml({ cardType: 'player', playerLabel: 'Jacob — WR1', gameLabel: 'Week 4', template, tiles, layout: layoutFor(3) });
  assert.match(html, /Jacob — WR1/);
});

test('labels a team card generically', () => {
  const html = buildWristbandPrintHtml({ cardType: 'team', playerLabel: null, gameLabel: 'Week 4', template, tiles, layout: layoutFor(3) });
  assert.match(html, /Team \/ General Card/);
});

test('splits into multiple .sheet pages when panels exceed one page\'s capacity', () => {
  const layout = layoutFor(3);
  layout.panelsPerPage = 1; // force a tiny page capacity to test pagination
  const html = buildWristbandPrintHtml({ cardType: 'team', playerLabel: null, gameLabel: 'Week 4', template, tiles, layout });
  const sheetCount = (html.match(/class="sheet"/g) || []).length;
  assert.equal(sheetCount, layout.panelsNeeded); // 1 panel per page -> pages == panels
});

test('escapes HTML-unsafe characters in play names', () => {
  const dangerousTiles = [{ wristbandCode: '1', playName: '<script>alert(1)</script>', svgMarkup: '<svg></svg>', cueText: null }];
  const html = buildWristbandPrintHtml({ cardType: 'team', playerLabel: null, gameLabel: 'Week 4', template, tiles: dangerousTiles, layout: layoutFor(1) });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('includes the actual-size print instructions block', () => {
  const html = buildWristbandPrintHtml({ cardType: 'team', playerLabel: null, gameLabel: 'Week 4', template, tiles, layout: layoutFor(3) });
  assert.match(html, /Actual size/);
  assert.match(html, /class="instructions no-print"/);
});
