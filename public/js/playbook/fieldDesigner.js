import { ROUTE_TEMPLATES, defaultEndpoint, computeRoutePoints, approxYardsFromDelta, directionFromDelta } from '../constants/routes.js';
import { SUGGESTED_SLOTS } from '../constants/football.js';

// SVG football-field workspace, rebuilt to fix a real bug: the previous
// version called a full re-render on every pointermove during a drag,
// which destroyed and recreated the SVG element the drag handler was
// still holding a reference to — causing exactly the "jumping / offset /
// jitter" behavior reported. This version enforces one rule everywhere:
// during an active gesture, only cached element references are mutated
// directly (transform/points attributes) — the DOM structure is never
// rebuilt until the gesture ends. Full render() only runs between
// gestures.
//
// Interaction model, redesigned to remove all gesture ambiguity:
//  - A guided step-by-step flow adds each new player: pick them, tap the
//    field to place them, pick a route template (or draw a custom one),
//    adjust the single gold-dot endpoint handle, pick their job.
//  - Once players exist, two EXPLICIT, mutually exclusive modes handle
//    adjustments: "Move Player" (drag repositions) and "Edit Route" (tap
//    jumps into route adjustment). Only one is ever active, always shown.
//  - Nothing is ever both "the move gesture" and "the draw gesture" at
//    the same time — which screen/mode you're in determines what a touch
//    on a marker means, never an ambiguous default.

const VIEW_W = 400;
const VIEW_H = 500;
const LOS_Y_NORM = 0.72;
const LOS_SNAP_THRESHOLD = 0.035;
const MARKER_R = 22;
const HANDLE_R = 16;

const JOBS = [
  { value: 'primary', label: 'PRIMARY', desc: "We want to get them the ball." },
  { value: 'secondary', label: 'SECONDARY', desc: "Look here if the first option isn't open." },
  { value: 'decoy', label: 'DECOY', desc: 'Helps pull defenders away from where we want to go.' },
  { value: '', label: 'OTHER', desc: 'No special job — blocking or a different role.' },
];

export function createFieldDesigner(container, { initialDesign, knownSlots = [], onSlotAdded, onSlotRemoved, onChange } = {}) {
  const design = initialDesign
    ? structuredClone(initialDesign)
    : { positions: {}, routes: {} };

  // Seed placeholder entries (no position yet) for slots that exist in the
  // parent form's assignments but have no drawn design yet (e.g. a legacy
  // play created before the Designer existed).
  const unplacedKnownSlots = knownSlots.filter((s) => !design.positions[s]);

  const nav = { screen: 'overview', activeSlot: null, mode: null, customDrawPoints: null };
  const elRefs = { markers: new Map(), routes: new Map(), handle: null, svg: null, ctm: null };
  const undoStack = [];

  render();

  // ---------- top-level render dispatch ----------

  function render() {
    elRefs.markers.clear();
    elRefs.routes.clear();
    elRefs.handle = null;

    container.innerHTML = `
      <div id="fd-banner" class="card card-gold" style="margin-bottom:var(--space-2); padding:14px 16px;"></div>
      <div style="border-radius: var(--radius); overflow: hidden; border: 1px solid var(--sx-border); touch-action: none;">
        <svg id="fd-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" style="width:100%; display:block; background:#0f1a13;"></svg>
      </div>
      <div id="fd-controls" style="margin-top: var(--space-2);"></div>
    `;

    const svg = container.querySelector('#fd-svg');
    elRefs.svg = svg;
    drawFieldBackground(svg);
    Object.keys(design.positions).forEach((slot) => drawRoute(svg, slot));
    Object.keys(design.positions).forEach((slot) => drawMarker(svg, slot));
    if (nav.screen === 'adjust_route' && nav.activeSlot) drawHandle(svg, nav.activeSlot);
    attachFieldTapHandler(svg);

    renderBanner();
    renderControls();
  }

  function renderBanner() {
    const banner = container.querySelector('#fd-banner');
    const text = bannerText();
    banner.innerHTML = `<p style="margin:0; font-size:17px; font-weight:700; color:var(--sx-white);">${text}</p>`;
  }

  function bannerText() {
    switch (nav.screen) {
      case 'pick_player':
        return 'Pick a player to add.';
      case 'place_player':
        return `Now tap where <span style="color:var(--sx-gold)">${escapeHtml(nav.activeSlot)}</span> should stand.`;
      case 'pick_route':
        return `<span style="color:var(--sx-gold)">YOU'RE EDITING: ${escapeHtml(nav.activeSlot)}</span><br>Now pick their route.`;
      case 'draw_custom':
        return `<span style="color:var(--sx-gold)">YOU'RE EDITING: ${escapeHtml(nav.activeSlot)}</span><br>Drag from ${escapeHtml(nav.activeSlot)} to draw where they go.`;
      case 'adjust_route':
        return `<span style="color:var(--sx-gold)">YOU'RE EDITING: ${escapeHtml(nav.activeSlot)}</span><br>Move the gold dot to change the route.`;
      case 'pick_job':
        return `<span style="color:var(--sx-gold)">YOU'RE EDITING: ${escapeHtml(nav.activeSlot)}</span><br>What is this player's job?`;
      case 'done_slot':
        return `Nice! <span style="color:var(--sx-gold)">${escapeHtml(nav.activeSlot)}</span> is all set.`;
      default: // overview
        if (Object.keys(design.positions).length === 0) return "Tap '+ Add Player' to start building this play.";
        if (nav.mode === 'move') return 'Drag any player to move them.';
        if (nav.mode === 'route') return 'Tap a player to change or adjust their route.';
        return 'Tap a player below to adjust them, or add a new one.';
    }
  }

  function renderControls() {
    const el = container.querySelector('#fd-controls');
    if (nav.screen === 'overview') return renderOverviewControls(el);
    if (nav.screen === 'pick_player') return renderPickPlayerControls(el);
    if (nav.screen === 'pick_route') return renderPickRouteControls(el);
    if (nav.screen === 'adjust_route') return renderAdjustRouteControls(el);
    if (nav.screen === 'pick_job') return renderPickJobControls(el);
    if (nav.screen === 'done_slot') return renderDoneSlotControls(el);
    if (nav.screen === 'draw_custom') return renderDrawCustomControls(el);
    el.innerHTML = '';
  }

  // ---------- OVERVIEW ----------

  function renderOverviewControls(el) {
    const slots = Object.keys(design.positions);
    el.innerHTML = `
      <div class="row-wrap" style="margin-bottom: var(--space-2);">
        <button type="button" class="btn ${nav.mode === 'move' ? 'btn-primary' : 'btn-secondary'}" id="fd-mode-move" ${slots.length === 0 ? 'disabled' : ''}>Move Player</button>
        <button type="button" class="btn ${nav.mode === 'route' ? 'btn-primary' : 'btn-secondary'}" id="fd-mode-route" ${slots.length === 0 ? 'disabled' : ''}>Edit Route</button>
      </div>
      ${slots.length > 0 ? `
        <div class="row-wrap" id="fd-player-chips" style="margin-bottom: var(--space-2);">
          ${slots.map((s) => `<button type="button" class="chip ${nav.mode ? 'selected' : ''}" data-chip="${escapeAttr(s)}">${escapeHtml(s)}${design.routes[s]?.designation ? ' &middot; ' + design.routes[s].designation[0].toUpperCase() : ''}</button>`).join('')}
        </div>
      ` : ''}
      <div class="row-wrap">
        <button type="button" class="btn btn-primary" id="fd-add-player">+ Add Player</button>
        <button type="button" class="btn btn-secondary" id="fd-undo">Undo</button>
        <button type="button" class="btn btn-link" id="fd-clear">Clear Design</button>
        <button type="button" class="btn btn-link" id="fd-help">? How do I draw a play?</button>
      </div>
    `;

    el.querySelector('#fd-add-player').addEventListener('click', () => goTo('pick_player'));
    el.querySelector('#fd-undo').addEventListener('click', undo);
    el.querySelector('#fd-clear').addEventListener('click', clearDesign);
    el.querySelector('#fd-help').addEventListener('click', showHelp);

    if (slots.length > 0) {
      el.querySelector('#fd-mode-move').addEventListener('click', () => {
        nav.mode = nav.mode === 'move' ? null : 'move';
        render();
      });
      el.querySelector('#fd-mode-route').addEventListener('click', () => {
        nav.mode = nav.mode === 'route' ? null : 'route';
        render();
      });
      el.querySelectorAll('[data-chip]').forEach((chip) => {
        chip.addEventListener('click', () => handleSlotTap(chip.dataset.chip));
      });
    }
  }

  function handleSlotTap(slot) {
    if (nav.mode === 'route') {
      nav.activeSlot = slot;
      // Only jump straight to adjustment if a real drawn route exists —
      // a route object can exist with no points (e.g. a job was picked
      // after deleting the route), and that must go back to picking a
      // route type, not into adjusting a route that isn't there.
      if (design.routes[slot]?.points) {
        goTo('adjust_route');
      } else {
        goTo('pick_route');
      }
    }
    // In 'move' mode, selection happens via direct drag on the marker
    // itself (see attachMarkerHandlers) — tapping a chip alone doesn't
    // move anything, since a chip has no "where to move it to."
  }

  function clearDesign() {
    if (!confirm('Clear the whole design? This removes every player and route from this play (nothing else on the form is affected).')) return;
    Object.keys(design.positions).forEach((slot) => onSlotRemoved && onSlotRemoved(slot));
    design.positions = {};
    design.routes = {};
    undoStack.length = 0;
    nav.mode = null;
    render();
    emitChange();
  }

  function showHelp() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:100; display:flex; align-items:center; justify-content:center; padding:var(--space-2);';
    overlay.innerHTML = `
      <div class="card card-gold" style="max-width:420px; max-height:80vh; overflow-y:auto;">
        <h2>How Do I Draw A Play?</h2>
        <ol style="padding-left:20px; margin:0; font-size:17px; line-height:1.8;">
          <li>Pick a player.</li>
          <li>Put them on the field.</li>
          <li>Pick their route.</li>
          <li>Move the gold dot if needed.</li>
          <li>Pick their job.</li>
          <li>Do the next player.</li>
          <li>Save your play.</li>
        </ol>
        <button type="button" class="btn btn-primary btn-large" id="fd-help-close" style="margin-top:var(--space-2); width:100%;">Got It</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#fd-help-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  // ---------- PICK PLAYER ----------

  function renderPickPlayerControls(el) {
    const available = [...SUGGESTED_SLOTS, ...unplacedKnownSlots].filter(
      (s, i, arr) => arr.indexOf(s) === i && !design.positions[s]
    );
    el.innerHTML = `
      <div class="row-wrap" style="margin-bottom: var(--space-2);">
        ${available.map((s) => `<button type="button" class="btn btn-secondary btn-large" data-pick="${escapeAttr(s)}">${escapeHtml(s)}</button>`).join('')}
      </div>
      <div class="row" style="margin-bottom: var(--space-2);">
        <input type="text" id="fd-custom-name" placeholder="Or type a name" style="flex:1;" />
        <button type="button" class="btn btn-secondary" id="fd-custom-add">+ Player</button>
      </div>
      ${Object.keys(design.positions).length > 0 ? '<button type="button" class="btn btn-link" id="fd-cancel">Cancel</button>' : ''}
    `;
    el.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => startPlacing(btn.dataset.pick));
    });
    el.querySelector('#fd-custom-add').addEventListener('click', () => {
      const input = el.querySelector('#fd-custom-name');
      const label = input.value.trim();
      if (label && !design.positions[label]) startPlacing(label);
    });
    const cancelBtn = el.querySelector('#fd-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => goTo('overview'));
  }

  function startPlacing(slot) {
    nav.activeSlot = slot;
    goTo('place_player');
  }

  // ---------- PLACE PLAYER (tap the field) ----------
  // Handled via a pointerup listener attached to the SVG background in
  // attachFieldTapHandler(), active only while screen === 'place_player'.

  function placePlayer(point) {
    let pos = { x: point.x, y: point.y };
    if (Math.abs(pos.y - LOS_Y_NORM) < LOS_SNAP_THRESHOLD) pos.y = LOS_Y_NORM;
    design.positions[nav.activeSlot] = pos;
    if (onSlotAdded) onSlotAdded(nav.activeSlot);
    emitChange();
    goTo('pick_route');
  }

  // ---------- PICK ROUTE ----------

  function renderPickRouteControls(el) {
    el.innerHTML = `
      <div class="row-wrap">
        ${ROUTE_TEMPLATES.map((t) => `<button type="button" class="btn btn-secondary btn-large" data-template="${t.value}">${t.label}</button>`).join('')}
      </div>
    `;
    el.querySelectorAll('[data-template]').forEach((btn) => {
      btn.addEventListener('click', () => pickRouteTemplate(btn.dataset.template));
    });
  }

  function pickRouteTemplate(routeType) {
    if (routeType === 'custom') {
      nav.customDrawPoints = null;
      goTo('draw_custom');
      return;
    }
    const start = design.positions[nav.activeSlot];
    const flipped = start.x > 0.5;
    const end = defaultEndpoint(routeType, start, flipped);
    const points = computeRoutePoints(routeType, start, end);
    design.routes[nav.activeSlot] = {
      points,
      routeType,
      endPoint: end,
      direction: directionFromDelta(start, end),
      designation: design.routes[nav.activeSlot]?.designation || null,
    };
    undoStack.push({ type: 'route', slot: nav.activeSlot });
    emitChange();
    goTo('adjust_route');
  }

  // ---------- DRAW CUSTOM ----------
  // Drag capture attached in attachFieldTapHandler() while screen === 'draw_custom'.

  function renderDrawCustomControls(el) {
    el.innerHTML = `<button type="button" class="btn btn-link" id="fd-back-to-templates">&larr; Choose a route instead</button>`;
    el.querySelector('#fd-back-to-templates').addEventListener('click', () => goTo('pick_route'));
  }

  function finishCustomDraw(points) {
    if (!points || points.length < 2) return;
    const start = design.positions[nav.activeSlot];
    const end = points[points.length - 1];
    design.routes[nav.activeSlot] = {
      points,
      routeType: 'custom',
      endPoint: end,
      direction: directionFromDelta(start, end),
      designation: design.routes[nav.activeSlot]?.designation || null,
    };
    undoStack.push({ type: 'route', slot: nav.activeSlot });
    emitChange();
    goTo('adjust_route');
  }

  // ---------- ADJUST ROUTE (gold dot) ----------

  function renderAdjustRouteControls(el) {
    const route = design.routes[nav.activeSlot];
    const start = design.positions[nav.activeSlot];
    const yards = route && route.endPoint ? approxYardsFromDelta(start, route.endPoint) : null;
    el.innerHTML = `
      ${yards != null ? `<p class="hint">About ${yards} yards &middot; breaks ${route.direction}</p>` : ''}
      <div class="row-wrap">
        <button type="button" class="btn btn-primary btn-large" id="fd-route-good">Looks Good &rarr;</button>
      </div>
      <div class="row-wrap" style="margin-top:var(--space-1);">
        <button type="button" class="btn btn-link" id="fd-change-route">Change Route Type</button>
        <button type="button" class="btn btn-link" id="fd-delete-route">Delete This Route</button>
      </div>
    `;
    el.querySelector('#fd-route-good').addEventListener('click', () => goTo('pick_job'));
    el.querySelector('#fd-change-route').addEventListener('click', () => goTo('pick_route'));
    el.querySelector('#fd-delete-route').addEventListener('click', () => {
      delete design.routes[nav.activeSlot];
      emitChange();
      goTo('pick_job');
    });
  }

  // ---------- PICK JOB ----------

  function renderPickJobControls(el) {
    const current = design.routes[nav.activeSlot]?.designation || '';
    el.innerHTML = `
      <div class="stack">
        ${JOBS.map(
          (j) => `
          <button type="button" class="btn btn-large ${current === j.value ? 'btn-primary' : 'btn-secondary'}" data-job="${j.value}" style="text-align:left; height:auto; padding:14px 18px;">
            <div style="font-weight:800;">${j.label}</div>
            <div style="font-weight:400; font-size:14px; opacity:0.85;">${j.desc}</div>
          </button>`
        ).join('')}
      </div>
    `;
    el.querySelectorAll('[data-job]').forEach((btn) => {
      btn.addEventListener('click', () => pickJob(btn.dataset.job));
    });
  }

  function pickJob(job) {
    if (!design.routes[nav.activeSlot]) {
      design.routes[nav.activeSlot] = { points: null, routeType: null, endPoint: null, direction: null, designation: job || null };
    } else {
      design.routes[nav.activeSlot].designation = job || null;
    }
    emitChange();
    goTo('done_slot');
  }

  // ---------- DONE SLOT ----------

  function renderDoneSlotControls(el) {
    el.innerHTML = `
      <div class="stack">
        <button type="button" class="btn btn-primary btn-large" id="fd-next-player">+ Do Next Player</button>
        <button type="button" class="btn btn-secondary btn-large" id="fd-done">I'm Done For Now</button>
      </div>
    `;
    el.querySelector('#fd-next-player').addEventListener('click', () => goTo('pick_player'));
    el.querySelector('#fd-done').addEventListener('click', () => goTo('overview'));
  }

  // ---------- navigation ----------

  function goTo(screen) {
    nav.screen = screen;
    if (screen === 'overview') nav.activeSlot = null;
    render();
  }

  // ---------- field drawing (structural — only called from render()) ----------

  function drawFieldBackground(svg) {
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: VIEW_W, height: VIEW_H, fill: '#0f1a13' }));
    for (let y = 0; y <= VIEW_H; y += VIEW_H / 10) {
      svg.appendChild(svgEl('line', { x1: 0, y1: y, x2: VIEW_W, y2: y, stroke: '#1f2e24', 'stroke-width': 1 }));
    }
    const losY = LOS_Y_NORM * VIEW_H;
    svg.appendChild(
      svgEl('line', { x1: 0, y1: losY, x2: VIEW_W, y2: losY, stroke: '#c9a227', 'stroke-width': 2.5, 'stroke-dasharray': '7,5', opacity: 0.85 })
    );
  }

  function drawMarker(svg, slot) {
    const pos = design.positions[slot];
    const isActive = slot === nav.activeSlot && nav.screen !== 'overview';
    const isPlaceable = nav.screen === 'place_player'; // not-yet-placed slot being set up separately
    const g = svgEl('g', { transform: `translate(${pos.x * VIEW_W}, ${pos.y * VIEW_H})`, style: 'cursor:pointer;' });
    g.appendChild(
      svgEl('circle', {
        r: MARKER_R,
        fill: isActive ? '#c9a227' : '#1f1f23',
        stroke: isActive ? '#c9a227' : '#5a5a62',
        'stroke-width': 2.5,
        opacity: isPlaceable ? 0.4 : 1,
      })
    );
    const label = svgEl('text', { x: 0, y: 5, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800, fill: isActive ? '#0a0a0b' : '#f7f7f5' });
    label.textContent = slot;
    g.appendChild(label);
    svg.appendChild(g);
    elRefs.markers.set(slot, g);
    attachMarkerHandlers(g, slot);
  }

  function drawRoute(svg, slot) {
    const route = design.routes[slot];
    if (!route || !route.points || route.points.length < 2) return;
    const isPrimary = route.designation === 'primary';
    const isSecondary = route.designation === 'secondary';
    const color = isPrimary ? '#c9a227' : isSecondary ? '#d6d6da' : '#7a7a82';
    const el = svgEl('polyline', {
      points: pointsToAttr(route.points),
      fill: 'none',
      stroke: color,
      'stroke-width': isPrimary ? 4 : 2.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-dasharray': route.designation === 'decoy' ? '4,4' : '',
    });
    svg.appendChild(el);
    elRefs.routes.set(slot, el);
  }

  function drawHandle(svg, slot) {
    const route = design.routes[slot];
    if (!route || !route.endPoint) return;
    const g = svgEl('g', { transform: `translate(${route.endPoint.x * VIEW_W}, ${route.endPoint.y * VIEW_H})`, style: 'cursor:grab;' });
    g.appendChild(svgEl('circle', { r: HANDLE_R + 6, fill: '#c9a227', opacity: 0.25 }));
    g.appendChild(svgEl('circle', { r: HANDLE_R, fill: '#c9a227', stroke: '#0a0a0b', 'stroke-width': 2 }));
    svg.appendChild(g);
    elRefs.handle = g;
    attachHandleHandlers(g, slot);
  }

  // ---------- gesture handling (NEVER calls render() mid-gesture) ----------

  function attachMarkerHandlers(markerEl, slot) {
    markerEl.addEventListener('pointerdown', (e) => {
      if (nav.screen === 'overview' && nav.mode === 'move') {
        e.preventDefault();
        e.stopPropagation();
        startMoveGesture(e, slot, markerEl);
      } else if (nav.screen === 'overview' && nav.mode === 'route') {
        e.preventDefault();
        e.stopPropagation();
        handleSlotTap(slot);
      }
      // Any other screen (draw_custom, place_player, neutral overview):
      // deliberately do NOT stop propagation, so the event bubbles up to
      // the SVG-level handler — e.g. dragging from the marker itself to
      // start a custom route depends on this.
    });
  }

  function startMoveGesture(e, slot, markerEl) {
    const svg = elRefs.svg;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const inv = ctm.inverse();
    const startPos = { ...design.positions[slot] };
    const routeEl = elRefs.routes.get(slot);
    const route = design.routes[slot];
    const originalRoutePoints = route && route.points ? route.points.map((p) => ({ ...p })) : null;
    const originalEndPoint = route && route.endPoint ? { ...route.endPoint } : null;

    const onMove = (ev) => {
      const pt = svgPointFromClient(svg, inv, ev.clientX, ev.clientY);
      let nx = clamp01(pt.x / VIEW_W);
      let ny = clamp01(pt.y / VIEW_H);
      if (Math.abs(ny - LOS_Y_NORM) < LOS_SNAP_THRESHOLD) ny = LOS_Y_NORM;

      markerEl.setAttribute('transform', `translate(${nx * VIEW_W}, ${ny * VIEW_H})`);

      if (route && originalRoutePoints) {
        const dx = nx - startPos.x;
        const dy = ny - startPos.y;
        const newPoints = originalRoutePoints.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }));
        if (routeEl) routeEl.setAttribute('points', pointsToAttr(newPoints));
        route._liveNewPoints = newPoints;
        route._liveEndPoint = { x: clamp01(originalEndPoint.x + dx), y: clamp01(originalEndPoint.y + dy) };
      }
      design.positions[slot] = { x: nx, y: ny };
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (route && route._liveNewPoints) {
        route.points = route._liveNewPoints;
        route.endPoint = route._liveEndPoint;
        delete route._liveNewPoints;
        delete route._liveEndPoint;
      }
      emitChange();
      render();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function attachHandleHandlers(handleEl, slot) {
    handleEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const svg = elRefs.svg;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const inv = ctm.inverse();
      const start = design.positions[slot];
      const route = design.routes[slot];
      const routeEl = elRefs.routes.get(slot);

      const onMove = (ev) => {
        const pt = svgPointFromClient(svg, inv, ev.clientX, ev.clientY);
        const end = { x: clamp01(pt.x / VIEW_W), y: clamp01(pt.y / VIEW_H) };
        handleEl.setAttribute('transform', `translate(${end.x * VIEW_W}, ${end.y * VIEW_H})`);
        const newPoints = route.routeType === 'custom'
          ? [...route.points.slice(0, -1), end]
          : computeRoutePoints(route.routeType, start, end);
        if (routeEl) routeEl.setAttribute('points', pointsToAttr(newPoints));
        route._liveEnd = end;
        route._livePoints = newPoints;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (route._liveEnd) {
          route.endPoint = route._liveEnd;
          route.points = route._livePoints;
          route.direction = directionFromDelta(start, route.endPoint);
          delete route._liveEnd;
          delete route._livePoints;
        }
        emitChange();
        render();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  // Field-background tap/drag — behavior depends entirely on the current
  // screen, attached fresh each render() so it always matches nav.screen.
  function attachFieldTapHandler(svg) {
    if (nav.screen === 'place_player') {
      svg.addEventListener('pointerdown', function onDown(e) {
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const pt = svgPointFromClient(svg, ctm.inverse(), e.clientX, e.clientY);
        placePlayer({ x: clamp01(pt.x / VIEW_W), y: clamp01(pt.y / VIEW_H) });
      }, { once: true });
    }

    if (nav.screen === 'draw_custom') {
      const start = design.positions[nav.activeSlot];
      let drawn = [{ ...start }];
      let last = null;
      const tempPolyline = svgEl('polyline', { points: pointsToAttr(drawn), fill: 'none', stroke: '#c9a227', 'stroke-width': 3, 'stroke-linecap': 'round' });

      svg.addEventListener('pointerdown', function onDown(e) {
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const inv = ctm.inverse();
        svg.appendChild(tempPolyline);
        last = svgPointFromClient(svg, inv, e.clientX, e.clientY);

        const onMove = (ev) => {
          const pt = svgPointFromClient(svg, inv, ev.clientX, ev.clientY);
          const dist = Math.hypot(pt.x - last.x, pt.y - last.y);
          if (dist > 8) {
            drawn.push({ x: clamp01(pt.x / VIEW_W), y: clamp01(pt.y / VIEW_H) });
            last = pt;
            tempPolyline.setAttribute('points', pointsToAttr(drawn));
          }
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (drawn.length < 2) {
            // Too short to count as a real drag (a tap, not a draw) — the
            // {once:true} listener below has already fired, so re-render
            // to attach a fresh one rather than leaving the field dead.
            render();
          } else {
            finishCustomDraw(drawn);
          }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }, { once: true });
    }
  }

  // ---------- helpers ----------

  function undo() {
    const last = undoStack.pop();
    if (!last) return;
    delete design.routes[last.slot];
    render();
    emitChange();
  }

  function emitChange() {
    if (onChange) onChange(getDesign());
  }

  function getDesign() {
    const clean = { positions: { ...design.positions }, routes: {} };
    Object.entries(design.routes).forEach(([slot, route]) => {
      const { _liveNewPoints, _liveEndPoint, _liveEnd, _livePoints, ...rest } = route;
      clean.routes[slot] = rest;
    });
    return clean;
  }

  function destroy() {
    container.innerHTML = '';
  }

  /**
   * External removal — used when a slot is removed from the parent form's
   * Assignments card (outside any Designer gesture), so its position/
   * route are cleaned up here too. Safe to call anytime since it always
   * follows with a full render(), never mid-gesture.
   */
  function removeSlot(label) {
    delete design.positions[label];
    delete design.routes[label];
    if (nav.activeSlot === label) nav.activeSlot = null;
    render();
    emitChange();
  }

  return { getDesign, removeSlot, destroy };

  // ---- small local utilities kept at the bottom for readability ----
  function svgPointFromClient(svg, inv, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(inv);
  }
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function pointsToAttr(points) {
  return points.map((p) => `${p.x * VIEW_W},${p.y * VIEW_H}`).join(' ');
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str ?? '');
}
