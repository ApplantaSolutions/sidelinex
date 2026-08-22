import { ROUTE_TEMPLATES, generateTemplateRoute } from '../constants/routes.js';

// SVG-based football field workspace. No canvas library — native SVG +
// Pointer Events, which is exactly enough for V1 (positions + polyline
// routes) and keeps this dependency-free.
//
// Interaction model:
//  - Dragging FROM a player marker draws a route (matches how a coach
//    naturally draws on a whiteboard — start at the player, drag to where
//    they go).
//  - "Adjust Positions" toggles a separate mode where dragging a marker
//    repositions it instead.
//  - Tapping a marker (no drag) selects it; the panel below the field
//    shows that slot's route controls (template picker, depth, flip,
//    designation, clear).
//  - Coordinates are stored normalized (0-1), offense driving toward y=0,
//    line of scrimmage at LOS_Y — resolution-independent, not tied to any
//    specific pixel size.

const VIEW_W = 400;
const VIEW_H = 500;
const LOS_Y_NORM = 0.72;
const MARKER_R = 20;

export function createFieldDesigner(container, { initialDesign, onChange } = {}) {
  const design = initialDesign
    ? structuredClone(initialDesign)
    : { positions: {}, routes: {} };

  let selectedSlot = null;
  let mode = 'draw'; // 'draw' | 'position'
  const undoStack = [];

  let drawingSlot = null;
  let drawingPoints = [];
  let lastSampledPoint = null;

  // Coalesce re-renders during an active drag to one per animation frame
  // instead of one per pointermove event — a bare `render()` on every move
  // rebuilds the whole SVG and visibly stutters on a real phone.
  let rafPending = false;
  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      render();
    });
  }

  render();

  function render() {
    container.innerHTML = `
      <div class="row-wrap" style="margin-bottom: var(--space-1);">
        <button type="button" class="chip ${mode === 'position' ? 'selected' : ''}" id="fd-mode-toggle">
          ${mode === 'position' ? '&#10003; Adjusting Positions' : 'Adjust Positions'}
        </button>
        <button type="button" class="chip" id="fd-undo">&#8630; Undo</button>
      </div>
      <div style="border-radius: var(--radius); overflow: hidden; border: 1px solid var(--sx-border); touch-action: none;">
        <svg id="fd-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" style="width:100%; display:block; background: #0f1a13;"></svg>
      </div>
      <div id="fd-slot-panel" style="margin-top: var(--space-2);"></div>
    `;

    const svg = container.querySelector('#fd-svg');
    drawField(svg);
    Object.keys(design.positions).forEach((slot) => drawRoute(svg, slot));
    Object.keys(design.positions).forEach((slot) => drawMarker(svg, slot));

    container.querySelector('#fd-mode-toggle').addEventListener('click', () => {
      mode = mode === 'draw' ? 'position' : 'draw';
      render();
    });
    container.querySelector('#fd-undo').addEventListener('click', undo);

    renderSlotPanel();
  }

  function drawField(svg) {
    const bg = svgEl('rect', { x: 0, y: 0, width: VIEW_W, height: VIEW_H, fill: '#0f1a13' });
    svg.appendChild(bg);
    for (let y = 0; y <= VIEW_H; y += VIEW_H / 10) {
      svg.appendChild(
        svgEl('line', { x1: 0, y1: y, x2: VIEW_W, y2: y, stroke: '#1f2e24', 'stroke-width': 1 })
      );
    }
    const losY = LOS_Y_NORM * VIEW_H;
    svg.appendChild(
      svgEl('line', { x1: 0, y1: losY, x2: VIEW_W, y2: losY, stroke: 'var(--sx-gold)', 'stroke-width': 2, 'stroke-dasharray': '6,4', opacity: 0.7 })
    );
  }

  function drawMarker(svg, slot) {
    const pos = design.positions[slot];
    const g = svgEl('g', { transform: `translate(${pos.x * VIEW_W}, ${pos.y * VIEW_H})`, style: 'cursor:pointer;' });
    const isSelected = slot === selectedSlot;
    g.appendChild(
      svgEl('circle', {
        r: MARKER_R,
        fill: isSelected ? 'var(--sx-gold)' : '#1f1f23',
        stroke: isSelected ? 'var(--sx-gold)' : '#5a5a62',
        'stroke-width': 2,
      })
    );
    const label = svgEl('text', {
      x: 0,
      y: 5,
      'text-anchor': 'middle',
      'font-size': 13,
      'font-weight': 800,
      fill: isSelected ? '#0a0a0b' : '#f7f7f5',
    });
    label.textContent = slot;
    g.appendChild(label);

    g.addEventListener('pointerdown', (e) => onMarkerPointerDown(e, svg, slot));
    svg.appendChild(g);
  }

  function drawRoute(svg, slot) {
    const route = design.routes[slot];
    if (!route || !route.points || route.points.length < 2) return;
    const isPrimary = route.designation === 'primary';
    const isSecondary = route.designation === 'secondary';
    const color = isPrimary ? 'var(--sx-gold)' : isSecondary ? '#d6d6da' : '#7a7a82';
    const dash = route.designation === 'decoy' ? '4,4' : null;
    const pts = route.points.map((p) => `${p.x * VIEW_W},${p.y * VIEW_H}`).join(' ');
    const attrs = {
      points: pts,
      fill: 'none',
      stroke: color,
      'stroke-width': isPrimary ? 3.5 : 2.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    };
    if (dash) attrs['stroke-dasharray'] = dash;
    svg.appendChild(svgEl('polyline', attrs));

    // Arrowhead at the end of the route
    const last = route.points[route.points.length - 1];
    const prev = route.points[route.points.length - 2];
    if (last && prev) {
      const angle = Math.atan2((last.y - prev.y) * VIEW_H, (last.x - prev.x) * VIEW_W);
      const ax = last.x * VIEW_W;
      const ay = last.y * VIEW_H;
      const size = 8;
      const p1 = `${ax},${ay}`;
      const p2 = `${ax - size * Math.cos(angle - 0.4)},${ay - size * Math.sin(angle - 0.4)}`;
      const p3 = `${ax - size * Math.cos(angle + 0.4)},${ay - size * Math.sin(angle + 0.4)}`;
      svg.appendChild(svgEl('polygon', { points: `${p1} ${p2} ${p3}`, fill: color }));
    }
  }

  function onMarkerPointerDown(e, svg, slot) {
    e.preventDefault();
    e.stopPropagation();
    const startPoint = clientToSvgPoint(svg, e.clientX, e.clientY);
    let moved = false;

    if (mode === 'position') {
      const onMove = (ev) => {
        moved = true;
        const pt = clientToSvgPoint(svg, ev.clientX, ev.clientY);
        const newPos = { x: clamp01(pt.x / VIEW_W), y: clamp01(pt.y / VIEW_H) };
        // If this slot has a route, shift it by the same delta so it stays
        // anchored to the marker rather than being left floating in space.
        const route = design.routes[slot];
        if (route) {
          const dx = newPos.x - design.positions[slot].x;
          const dy = newPos.y - design.positions[slot].y;
          route.points = route.points.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }));
        }
        design.positions[slot] = newPos;
        selectedSlot = slot;
        scheduleRender();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (!moved) selectSlot(slot);
        render();
        emitChange();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    // draw mode
    drawingSlot = slot;
    const startPos = design.positions[slot];
    drawingPoints = [{ x: startPos.x, y: startPos.y }];
    lastSampledPoint = startPoint;

    const onMove = (ev) => {
      moved = true;
      const pt = clientToSvgPoint(svg, ev.clientX, ev.clientY);
      const dist = Math.hypot(pt.x - lastSampledPoint.x, pt.y - lastSampledPoint.y);
      if (dist > 8) {
        drawingPoints.push({ x: clamp01(pt.x / VIEW_W), y: clamp01(pt.y / VIEW_H) });
        lastSampledPoint = pt;
        design.routes[slot] = { points: [...drawingPoints], routeType: 'custom', approxDepthYards: null, direction: null, designation: design.routes[slot]?.designation || null };
        scheduleRender();
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved && drawingPoints.length > 1) {
        design.routes[slot] = {
          points: drawingPoints,
          routeType: 'custom',
          approxDepthYards: null,
          direction: null,
          designation: design.routes[slot]?.designation || null,
        };
        undoStack.push({ type: 'route', slot });
        emitChange();
      }
      selectSlot(slot);
      drawingSlot = null;
      render();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function selectSlot(slot) {
    selectedSlot = slot;
    render();
  }

  function renderSlotPanel() {
    const panel = container.querySelector('#fd-slot-panel');
    if (!selectedSlot) {
      panel.innerHTML = `<p class="hint">Tap a player to select them, then drag from the marker to draw a route, or pick a template below.</p>`;
      return;
    }
    const route = design.routes[selectedSlot];
    panel.innerHTML = `
      <div class="card" style="background:var(--sx-charcoal-2);">
        <h2>${escapeHtml(selectedSlot)}</h2>
        <p class="hint" style="margin-bottom:8px;">Route Template</p>
        <div class="row-wrap" id="fd-templates">
          ${ROUTE_TEMPLATES.filter((t) => t.value !== 'custom')
            .map((t) => `<button type="button" class="chip" data-template="${t.value}">${t.label}</button>`)
            .join('')}
        </div>
        ${route ? `
          <div class="row" style="margin-top: var(--space-2); gap: var(--space-2);">
            <label class="field" style="flex:1;">
              <span>Depth (yards)</span>
              <input type="number" id="fd-depth" value="${route.approxDepthYards ?? ''}" />
            </label>
            <button type="button" id="fd-flip" class="btn btn-secondary">Flip</button>
          </div>
          <p class="hint" style="margin: var(--space-2) 0 8px 0;">Designation</p>
          <div class="row-wrap">
            ${chip('primary', 'Primary', route.designation === 'primary')}
            ${chip('secondary', 'Secondary', route.designation === 'secondary')}
            ${chip('decoy', 'Decoy / Clear-Out', route.designation === 'decoy')}
            ${chip('', 'None', !route.designation)}
          </div>
          <button type="button" id="fd-clear-route" class="btn btn-link" style="padding-left:0; margin-top:var(--space-1);">Clear this route</button>
        ` : '<p class="hint" style="margin-top:8px;">No route yet.</p>'}
      </div>
    `;

    panel.querySelectorAll('[data-template]').forEach((btn) => {
      btn.addEventListener('click', () => applyTemplate(selectedSlot, btn.dataset.template));
    });
    if (route) {
      panel.querySelector('#fd-depth').addEventListener('change', (e) => {
        design.routes[selectedSlot].approxDepthYards = e.target.value ? Number(e.target.value) : null;
        emitChange();
      });
      panel.querySelector('#fd-flip').addEventListener('click', () => flipRoute(selectedSlot));
      panel.querySelectorAll('[data-designation]').forEach((chipEl) => {
        chipEl.addEventListener('click', () => {
          design.routes[selectedSlot].designation = chipEl.dataset.designation || null;
          render();
          emitChange();
        });
      });
      panel.querySelector('#fd-clear-route').addEventListener('click', () => {
        delete design.routes[selectedSlot];
        render();
        emitChange();
      });
    }
  }

  function applyTemplate(slot, routeType) {
    const pos = design.positions[slot];
    const flipped = design.routes[slot]?._flipped || pos.x > 0.5;
    const { points, approxDepthYards } = generateTemplateRoute(routeType, pos.x, pos.y, flipped);
    design.routes[slot] = {
      points,
      routeType,
      approxDepthYards,
      direction: flipped ? 'left' : 'right',
      designation: design.routes[slot]?.designation || null,
      _flipped: flipped,
    };
    undoStack.push({ type: 'route', slot });
    render();
    emitChange();
  }

  function flipRoute(slot) {
    const route = design.routes[slot];
    if (!route || route.routeType === 'custom') return;
    const pos = design.positions[slot];
    const flipped = !route._flipped;
    const { points, approxDepthYards } = generateTemplateRoute(route.routeType, pos.x, pos.y, flipped);
    design.routes[slot] = { ...route, points, approxDepthYards, direction: flipped ? 'left' : 'right', _flipped: flipped };
    render();
    emitChange();
  }

  function undo() {
    const last = undoStack.pop();
    if (!last) return;
    delete design.routes[last.slot];
    if (selectedSlot === last.slot) selectedSlot = last.slot; // keep selection, just clear its route
    render();
    emitChange();
  }

  function emitChange() {
    if (onChange) onChange(getDesign());
  }

  function addSlot(label) {
    if (design.positions[label]) return;
    // Reasonable default spread near the LOS; coach can drag to adjust.
    const existingCount = Object.keys(design.positions).length;
    const x = 0.15 + (existingCount % 6) * 0.14;
    design.positions[label] = { x: clamp01(x), y: LOS_Y_NORM };
    selectedSlot = label;
    render();
    emitChange();
  }

  function removeSlot(label) {
    delete design.positions[label];
    delete design.routes[label];
    if (selectedSlot === label) selectedSlot = null;
    render();
    emitChange();
  }

  function getDesign() {
    // Strip internal-only fields (_flipped) before returning for storage.
    const clean = { positions: { ...design.positions }, routes: {} };
    Object.entries(design.routes).forEach(([slot, route]) => {
      const { _flipped, ...rest } = route;
      clean.routes[slot] = rest;
    });
    return clean;
  }

  return { addSlot, removeSlot, getDesign, undo };
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function clientToSvgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function chip(value, label, selected) {
  return `<button type="button" class="chip ${selected ? 'selected' : ''}" data-designation="${value}">${label}</button>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
