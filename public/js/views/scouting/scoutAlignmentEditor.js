// Simple visual defensive-alignment editor for Opponent Scouting. Reuses
// the SAME {mode, defenders: {id: {label, position:{x,y}}}} shape as the
// Play Designer's design.defense.looks — deliberately, so a saved
// scouting alignment can be dropped straight into that same
// defenseAnimation.js-compatible structure later for teaching/analysis
// without a schema change.
//
// Deliberately NOT another Play Designer: no offense, no routes, no
// Watch Play animation, no zone/pressure assignment sub-screens. Choose a
// look -> tap the field to place defenders -> drag to adjust -> Save.
// That's the whole interaction.

const VIEW_W = 400;
const VIEW_H = 500;
const LOS_Y_NORM = 0.72;
const DEFENDER_R = 20;

const ALIGNMENT_MODES = [
  { value: 'man', label: 'MAN' },
  { value: 'zone', label: 'ZONE' },
  { value: 'pressure', label: 'PRESSURE' },
  { value: 'custom', label: 'MIXED / CUSTOM' },
];

export function renderScoutAlignmentEditor(root, existingAlignment, { onSave, onCancel }) {
  const working = {
    id: existingAlignment?.id || `align-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: existingAlignment?.name || '',
    mode: existingAlignment?.mode || 'man',
    defenders: existingAlignment ? structuredClone(existingAlignment.defenders || {}) : {},
  };
  let removeMode = false;

  render();

  function render() {
    root.innerHTML = `
      <button type="button" class="btn btn-link" id="align-back" style="padding-left:0;">&larr; Back</button>
      <div class="card">
        <h2>Defensive Alignment</h2>
        <input type="text" id="align-name" placeholder="e.g. Falcons Base Man" value="${escapeAttr(working.name)}" style="margin-bottom:10px;" />
        <div class="row-wrap" style="margin-bottom:10px;">
          ${ALIGNMENT_MODES.map((m) => `<button type="button" class="chip ${working.mode === m.value ? 'selected' : ''}" data-align-mode="${m.value}">${m.label}</button>`).join('')}
        </div>
        <p class="hint" style="margin:0 0 8px 0;">Tap the field to place a defender approximately where they line up. Drag to adjust.</p>
        <div id="align-field" style="width:100%; max-width:320px; margin:0 auto 10px auto;"></div>
        <div class="row-wrap" style="margin-bottom:var(--space-2);">
          <button type="button" class="btn ${removeMode ? 'btn-primary' : 'btn-secondary'}" id="align-remove-toggle">${removeMode ? 'Tap a defender to remove' : '&minus; Remove Defender'}</button>
          <button type="button" class="btn btn-secondary" id="align-clear">Clear All</button>
        </div>
        <div class="row-wrap">
          <button type="button" class="btn btn-secondary" id="align-cancel" style="flex:1;">Cancel</button>
          <button type="button" class="btn btn-primary btn-large" id="align-save" style="flex:2;">Save Look</button>
        </div>
      </div>
    `;

    root.querySelector('#align-back').addEventListener('click', onCancel);
    root.querySelector('#align-cancel').addEventListener('click', onCancel);
    root.querySelector('#align-name').addEventListener('input', (e) => { working.name = e.target.value; });
    root.querySelectorAll('[data-align-mode]').forEach((chip) => {
      chip.addEventListener('click', () => { working.mode = chip.dataset.alignMode; render(); });
    });
    root.querySelector('#align-remove-toggle').addEventListener('click', () => { removeMode = !removeMode; render(); });
    root.querySelector('#align-clear').addEventListener('click', () => { working.defenders = {}; render(); });
    root.querySelector('#align-save').addEventListener('click', () => {
      if (!working.name.trim()) {
        root.querySelector('#align-name').focus();
        return;
      }
      onSave(working);
    });

    buildField(root.querySelector('#align-field'));
  }

  function buildField(container) {
    const svg = svgEl('svg', { viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, style: 'width:100%; height:auto; aspect-ratio:4/5; display:block; background:#0f1a13; border-radius:8px;' });
    svg.appendChild(fieldBackground());
    Object.entries(working.defenders).forEach(([id, d]) => svg.appendChild(defenderMarker(id, d)));
    container.innerHTML = '';
    container.appendChild(svg);

    svg.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-defender-id]')) return; // marker's own handler deals with this
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const pt = svgPointFromClient(svg, ctm.inverse(), e.clientX, e.clientY);
      const id = `def-${Date.now()}-${Math.round(Math.random() * 1000)}`;
      working.defenders[id] = { label: `D${Object.keys(working.defenders).length + 1}`, position: { x: clamp01(pt.x / VIEW_W), y: clamp01(pt.y / VIEW_H) } };
      render();
    });
  }

  function defenderMarker(id, d) {
    const g = svgEl('g', { transform: `translate(${d.position.x * VIEW_W}, ${d.position.y * VIEW_H})`, 'data-defender-id': id, style: 'cursor:grab;' });
    g.appendChild(svgEl('circle', { r: DEFENDER_R, fill: '#7f1d1d', stroke: '#ef4444', 'stroke-width': 2.5 }));
    const text = svgEl('text', { x: 0, y: 5, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 800, fill: '#f7f7f5' });
    text.textContent = d.label || '';
    g.appendChild(text);

    g.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (removeMode) {
        delete working.defenders[id];
        render();
        return;
      }
      const svg = g.closest('svg');
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const inv = ctm.inverse();
      const onMove = (moveEvt) => {
        const pt = svgPointFromClient(svg, inv, moveEvt.clientX, moveEvt.clientY);
        const nx = clamp01(pt.x / VIEW_W);
        const ny = clamp01(pt.y / VIEW_H);
        g.setAttribute('transform', `translate(${nx * VIEW_W}, ${ny * VIEW_H})`);
        working.defenders[id].position = { x: nx, y: ny };
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    return g;
  }

  function fieldBackground() {
    const g = svgEl('g', {});
    g.appendChild(svgEl('rect', { x: 0, y: 0, width: VIEW_W, height: VIEW_H, fill: '#0f1a13' }));
    for (let y = 0; y <= VIEW_H; y += VIEW_H / 10) {
      g.appendChild(svgEl('line', { x1: 0, y1: y, x2: VIEW_W, y2: y, stroke: '#1f2e24', 'stroke-width': 1 }));
    }
    const losY = LOS_Y_NORM * VIEW_H;
    g.appendChild(svgEl('line', { x1: 0, y1: losY, x2: VIEW_W, y2: losY, stroke: '#c9a227', 'stroke-width': 2.5, 'stroke-dasharray': '7,5', opacity: 0.85 }));
    return g;
  }
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function svgPointFromClient(svg, inv, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(inv);
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function escapeAttr(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
