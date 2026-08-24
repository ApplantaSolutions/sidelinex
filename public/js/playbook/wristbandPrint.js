// Builds the printable wristband HTML document as a plain string — no DOM
// side effects here, so the layout logic itself is testable without a
// browser. The view layer (wristbandBuilderView.js) is the only place
// that actually opens a window and writes this string into it.
//
// Physical accuracy: every sizeable element is set in real "in" units
// (insert width/height, margins, page size), not px — that's what lets
// browser print preserve true physical dimensions when the print dialog's
// scale is set to "Actual Size / 100%". This page cannot force that
// setting itself (no web page can), so it prints a plain-language
// reminder at the top of the on-screen preview (hidden when actually
// printing via .no-print) telling the coach to check it.

export function buildWristbandPrintHtml({ cardType, playerLabel, gameLabel, template, tiles, layout }) {
  const { insertWidthIn, insertHeightIn, marginIn, playsPerPanel } = template;
  const pageWidthIn = 8.5;
  const pageHeightIn = 11;

  const panels = layout.panelGroups.map((indices) => panelHtml(indices.map((i) => tiles[i]), insertWidthIn, insertHeightIn));

  // Chunk panels into pages using the same panelsPerPage the layout math
  // already computed, so the page count here always matches what was
  // previewed on screen.
  const pages = [];
  for (let i = 0; i < panels.length; i += layout.panelsPerPage) {
    pages.push(panels.slice(i, i + layout.panelsPerPage));
  }
  if (pages.length === 0) pages.push([]);

  const pagesHtml = pages
    .map(
      (pagePanels, pageIndex) => `
    <div class="sheet">
      <div class="sheet-header">${escapeHtml(cardLabel(cardType, playerLabel))} &middot; ${escapeHtml(gameLabel)} &middot; Page ${pageIndex + 1} of ${pages.length}</div>
      <div class="panel-grid" style="grid-template-columns: repeat(${layout.panelsAcrossPage}, ${insertWidthIn}in);">
        ${pagePanels.join('')}
      </div>
    </div>
  `
    )
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>SidelineX Wristbands &mdash; ${escapeHtml(cardLabel(cardType, playerLabel))}</title>
<style>
  @page { size: ${pageWidthIn}in ${pageHeightIn}in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Arial, sans-serif; background: #ddd; }
  .instructions {
    max-width: 700px; margin: 16px auto; padding: 16px 20px; background: #fff8e1;
    border: 2px solid #c9a227; border-radius: 8px; font-size: 15px; line-height: 1.5;
  }
  .instructions b { color: #7a5c00; }
  .sheet {
    width: ${pageWidthIn}in; height: ${pageHeightIn}in; margin: 16px auto; background: #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25); padding: ${marginIn}in; position: relative;
    page-break-after: always;
  }
  .sheet-header { font-size: 9px; color: #888; margin-bottom: 4px; }
  .panel-grid { display: grid; gap: ${marginIn}in; align-content: start; }
  .panel {
    width: ${insertWidthIn}in; height: ${insertHeightIn}in; border: 1px dashed #999;
    padding: 4px; display: flex; flex-direction: column; overflow: hidden;
  }
  .tile { flex: 1; display: flex; flex-direction: column; border-bottom: 1px dotted #ccc; min-height: 0; }
  .tile:last-child { border-bottom: none; }
  .tile-head { display: flex; align-items: baseline; gap: 4px; padding: 1px 2px; }
  .tile-code { font-weight: 900; font-size: 12px; color: #7a5c00; }
  .tile-name { font-weight: 700; font-size: 8px; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tile-diagram { flex: 1; min-height: 0; }
  .tile-diagram svg { width: 100%; height: 100%; display: block; }
  .tile-cue { font-size: 7px; font-weight: 700; color: #333; padding: 0 2px; text-align: center; }
  @media print {
    .instructions, .no-print { display: none !important; }
    body { background: #fff; }
    .sheet { margin: 0; box-shadow: none; }
  }
</style>
</head>
<body>
  <div class="instructions no-print">
    <b>Before printing:</b> in the print dialog, set <b>Scale</b> to <b>"Actual size"</b> or <b>100%</b> &mdash;
    NOT "Fit to page." Fit-to-page will resize these inserts and they will no longer match the printed
    wristband's real physical dimensions. Check this every time your printer's default changes.
  </div>
  ${pagesHtml}
</body>
</html>`;
}

function panelHtml(tiles, insertWidthIn, insertHeightIn) {
  return `
    <div class="panel">
      ${tiles.map(
        (t) => `
        <div class="tile">
          <div class="tile-head"><span class="tile-code">${escapeHtml(t.wristbandCode)}</span><span class="tile-name">${escapeHtml(t.playName)}</span></div>
          <div class="tile-diagram">${t.svgMarkup}</div>
          ${t.cueText ? `<div class="tile-cue">${escapeHtml(t.cueText)}</div>` : ''}
        </div>
      `
      ).join('')}
    </div>
  `;
}

function cardLabel(cardType, playerLabel) {
  if (cardType === 'team') return 'Team / General Card';
  if (cardType === 'qb') return 'QB Card';
  return playerLabel || 'Player Card';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
