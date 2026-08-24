// Pure, string-returning SVG renderer for a play's fieldDesign — no DOM,
// no animation, no live element references. This exists specifically so
// print output (Wristband Builder) and any other "just show me a picture
// of this play" use case reads directly from the same design.positions/
// design.routes structure the Play Designer produces, never a separate,
// manually-maintained wristband diagram. Visual language (colors, marker
// style, highlight treatment) intentionally matches playViewer.js, which
// covers the interactive/animated case — this covers the static case.

const DEFAULT_VIEW_W = 400;
const DEFAULT_VIEW_H = 500;
const LOS_Y_NORM = 0.72;
const MARKER_R = 22;

/**
 * @param {{positions: object, routes: object}} design
 * @param {{highlightSlot?: string|null, viewW?: number, viewH?: number, compact?: boolean}} opts
 * @returns {string} a complete <svg>...</svg> markup string
 */
export function buildFieldSvgMarkup(design, opts = {}) {
  const viewW = opts.viewW || DEFAULT_VIEW_W;
  const viewH = opts.viewH || DEFAULT_VIEW_H;
  const highlightSlot = opts.highlightSlot || null;
  // Compact mode (small print tiles) drops player-slot text labels inside
  // markers — at wristband size the letters would be illegible smudges —
  // keeping only the marker shapes, route lines, and the highlight
  // treatment, which stay readable much smaller.
  const compact = !!opts.compact;

  const positions = design?.positions || {};
  const routes = design?.routes || {};

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${viewW} ${viewH}" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:100%; display:block; background:#0f1a13;">`);
  parts.push(fieldBackground(viewW, viewH));
  Object.keys(positions).forEach((slot) => {
    const route = routes[slot];
    if (route?.points?.length >= 2) parts.push(routePolyline(route, viewW, viewH, slot === highlightSlot, highlightSlot != null));
  });
  Object.keys(positions).forEach((slot) => {
    parts.push(marker(positions[slot], slot, viewW, viewH, slot === highlightSlot, highlightSlot != null, compact));
  });
  parts.push('</svg>');
  return parts.join('');
}

function fieldBackground(viewW, viewH) {
  const rows = [];
  rows.push(`<rect x="0" y="0" width="${viewW}" height="${viewH}" fill="#0f1a13" />`);
  for (let y = 0; y <= viewH; y += viewH / 10) {
    rows.push(`<line x1="0" y1="${y}" x2="${viewW}" y2="${y}" stroke="#1f2e24" stroke-width="1" />`);
  }
  const losY = LOS_Y_NORM * viewH;
  rows.push(`<line x1="0" y1="${losY}" x2="${viewW}" y2="${losY}" stroke="#c9a227" stroke-width="2.5" stroke-dasharray="7,5" opacity="0.85" />`);
  return rows.join('');
}

function marker(pos, slot, viewW, viewH, isMe, hasHighlight, compact) {
  const dimmed = hasHighlight && !isMe;
  const cx = pos.x * viewW;
  const cy = pos.y * viewH;
  const opacity = dimmed ? 0.35 : 1;
  const fill = isMe ? '#c9a227' : '#1f1f23';
  const stroke = isMe ? '#e6c34a' : '#5a5a62';
  const strokeWidth = isMe ? 3.5 : 2.5;
  const parts = [`<g transform="translate(${cx}, ${cy})" opacity="${opacity}">`];
  if (isMe) parts.push(`<circle r="${MARKER_R + 7}" fill="#c9a227" opacity="0.3" />`);
  parts.push(`<circle r="${MARKER_R}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`);
  if (!compact) {
    parts.push(`<text x="0" y="5" text-anchor="middle" font-size="13" font-weight="800" fill="${isMe ? '#0a0a0b' : '#f7f7f5'}">${escapeXml(slot)}</text>`);
  }
  parts.push('</g>');
  return parts.join('');
}

function routePolyline(route, viewW, viewH, isMe, hasHighlight) {
  const dimmed = hasHighlight && !isMe;
  const isPrimary = route.designation === 'primary';
  const isSecondary = route.designation === 'secondary';
  const color = isMe ? '#e6c34a' : isPrimary ? '#c9a227' : isSecondary ? '#d6d6da' : '#7a7a82';
  const strokeWidth = isMe ? 5 : isPrimary ? 4 : 2.5;
  const dash = !isMe && route.designation === 'decoy' ? '4,4' : '';
  const points = route.points.map((p) => `${p.x * viewW},${p.y * viewH}`).join(' ');
  return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ${dash ? `stroke-dasharray="${dash}"` : ''} opacity="${dimmed ? 0.35 : 1}" />`;
}

function escapeXml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
