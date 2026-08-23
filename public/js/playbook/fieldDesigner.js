import {
  ROUTE_TEMPLATES,
  defaultEndpoint,
  computeRoutePoints,
  approxYardsFromDelta,
  directionFromDelta,
  routeDescription,
  getTiming,
  DELAY_OPTIONS_SECONDS,
  DEPTH_OPTIONS_YARDS,
  hasDirectionChoice,
  endpointFromDepthAndDirection,
  currentDepthYards,
} from '../constants/routes.js';
import { SUGGESTED_SLOTS, slotDisplayLabel } from '../constants/football.js';
import { FORMATIONS } from '../constants/formations.js';
import { interpolateAlongPath, buildPlaySchedule, computeFrame, postsnapDurationFor } from './animation.js';

// SVG football-field workspace. Core rule, unchanged since the interaction
// rebuild and extended (not weakened) to cover animation: during any
// active gesture OR animation, only cached element references are
// mutated directly (transform/points attributes) — the DOM structure is
// never rebuilt until the gesture/animation ends. Full render() only runs
// between them. Animation additionally never writes to design.positions
// or design.routes while running — it reads from them, and always
// restores every marker to its true design position via a normal
// render() the moment it stops (Watch Play exit) or completes (Route
// Preview's return-to-start).
//
// Interaction model:
//  - Guided flow for a new player: pick them, tap the field to place
//    them, pick a route template, PREVIEW it (animate + return to start,
//    accept or try another), adjust the gold-dot handle, pick their job.
//  - Explicit, mutually exclusive "Move Player" / "Edit Route" modes for
//    adjusting existing players afterward.
//  - Watch Play replaces those two modes' controls (never coexists with
//    them) while it runs, and marker gestures no-op entirely during it.

const VIEW_W = 400;
const VIEW_H = 500;
const LOS_Y_NORM = 0.72;
const LOS_SNAP_THRESHOLD = 0.035;
const MARKER_R = 22;
const MARKER_HIT_R = 32; // invisible, larger — a real finger touch needs a bigger target than a mouse pointer does
const HANDLE_R = 16;
const PREVIEW_RETURN_MS = 400;

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

  const unplacedKnownSlots = knownSlots.filter((s) => !design.positions[s]);

  const nav = { screen: 'overview', activeSlot: null, mode: null, previewRoute: null };
  const elRefs = { markers: new Map(), routes: new Map(), handle: null, svg: null };
  const undoStack = [];
  const anim = { previewRafId: null, watchPlay: null };
  let helpOverlay = null;

  render();

  // A brand-new, completely empty play (not editing an existing one) gets
  // the how-to guide shown automatically once, so a first-time user never
  // has to already know the "?" button exists. Editing an existing play,
  // or reopening this same empty state later, never re-triggers it — only
  // this one moment, right after the Designer first mounts.
  if (!initialDesign && Object.keys(design.positions).length === 0) {
    showHelp();
  }

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

    if (nav.screen === 'route_preview' && nav.previewRoute) startRoutePreviewAnimation();
  }

  function renderBanner() {
    const banner = container.querySelector('#fd-banner');
    banner.innerHTML = `<p style="margin:0; font-size:17px; font-weight:700; color:var(--sx-white);">${bannerText()}</p>`;
  }

  function bannerText() {
    switch (nav.screen) {
      case 'formations':
        return 'Pick a formation to place your players fast — everything stays editable after.';
      case 'pick_player':
        return 'Pick a player to add.';
      case 'place_player':
        return `Now tap where <span style="color:var(--sx-gold)">${escapeHtml(nav.activeSlot)}</span> should stand.`;
      case 'qb_role':
        return `<span style="color:var(--sx-gold)">QUARTERBACK</span><br>Is this a standard drop-back pass, or does the QB run the ball?`;
      case 'pick_route':
        return `<span style="color:var(--sx-gold)">YOU'RE EDITING: ${escapeHtml(nav.activeSlot)}</span><br>Now pick their route.`;
      case 'route_preview': {
        const desc = routeDescription(nav.previewRoute?.routeType);
        return `<span style="color:var(--sx-gold)">${escapeHtml((nav.previewRoute?.routeType || '').toUpperCase())}</span> &mdash; ${escapeHtml(desc)}`;
      }
      case 'draw_custom':
        return `<span style="color:var(--sx-gold)">YOU'RE EDITING: ${escapeHtml(nav.activeSlot)}</span><br>Drag from ${escapeHtml(nav.activeSlot)} to draw where they go.`;
      case 'adjust_route':
        return `<span style="color:var(--sx-gold)">YOU'RE EDITING: ${escapeHtml(nav.activeSlot)}</span><br>Drag ${escapeHtml(nav.activeSlot)} to reposition them, or the gold dot to change the route.`;
      case 'pick_job':
        return `<span style="color:var(--sx-gold)">YOU'RE EDITING: ${escapeHtml(nav.activeSlot)}</span><br>What is this player's job?`;
      case 'done_slot':
        return `Nice! <span style="color:var(--sx-gold)">${escapeHtml(nav.activeSlot)}</span> is all set.`;
      default: // overview
        if (anim.watchPlay) return 'id="fd-watch-banner-placeholder"'; // replaced by watch banner below
        if (Object.keys(design.positions).length === 0) return "Tap '+ Add Player' to start building this play.";
        if (nav.mode === 'move') return 'Drag any player to move them.';
        if (nav.mode === 'route') return 'Tap a player to change or adjust their route.';
        return 'Tap a player below to adjust them, or add a new one.';
    }
  }

  function renderControls() {
    const el = container.querySelector('#fd-controls');
    if (nav.screen === 'overview') return renderOverviewControls(el);
    if (nav.screen === 'formations') return renderFormationsControls(el);
    if (nav.screen === 'pick_player') return renderPickPlayerControls(el);
    if (nav.screen === 'qb_role') return renderQbRoleControls(el);
    if (nav.screen === 'pick_route') return renderPickRouteControls(el);
    if (nav.screen === 'route_preview') return renderRoutePreviewControls(el);
    if (nav.screen === 'adjust_route') return renderAdjustRouteControls(el);
    if (nav.screen === 'pick_job') return renderPickJobControls(el);
    if (nav.screen === 'done_slot') return renderDoneSlotControls(el);
    if (nav.screen === 'draw_custom') return renderDrawCustomControls(el);
    el.innerHTML = '';
  }

  // ---------- OVERVIEW ----------

  function renderOverviewControls(el) {
    if (anim.watchPlay) return renderWatchPlayControls(el);

    const slots = Object.keys(design.positions);
    const hasAnyRoute = Object.values(design.routes).some((r) => r?.points && r.points.length >= 2);
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
      ${hasAnyRoute ? '<button type="button" class="btn btn-primary btn-large" id="fd-watch-play" style="width:100%; margin-bottom:var(--space-2);">&#9654; WATCH PLAY</button>' : ''}
      <div class="row-wrap" style="margin-bottom: var(--space-2);">
        <button type="button" class="btn btn-primary" id="fd-add-player">+ Add Player</button>
        <button type="button" class="btn btn-secondary" id="fd-formations">&#128209; Use a Formation</button>
      </div>
      <div class="row-wrap">
        <button type="button" class="btn btn-secondary" id="fd-undo">Undo</button>
        <button type="button" class="btn btn-link" id="fd-clear">Clear Design</button>
        <button type="button" class="btn btn-link" id="fd-help">? How do I draw a play?</button>
      </div>
    `;

    el.querySelector('#fd-add-player').addEventListener('click', () => goTo('pick_player'));
    el.querySelector('#fd-formations').addEventListener('click', () => goTo('formations'));
    el.querySelector('#fd-undo').addEventListener('click', undo);
    el.querySelector('#fd-clear').addEventListener('click', clearDesign);
    el.querySelector('#fd-help').addEventListener('click', showHelp);
    if (hasAnyRoute) el.querySelector('#fd-watch-play').addEventListener('click', startWatchPlay);

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
      if (design.routes[slot]?.points) {
        goTo('adjust_route');
      } else {
        goTo('pick_route');
      }
    }
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
    if (helpOverlay) return; // already open — never stack a second one
    const overlay = document.createElement('div');
    helpOverlay = overlay;
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:100; display:flex; align-items:center; justify-content:center; padding:var(--space-2);';
    overlay.innerHTML = `
      <div class="card card-gold" style="max-width:440px; max-height:85vh; overflow-y:auto;">
        <h2>How To Design A Play</h2>
        <ol style="padding-left:20px; margin:0; font-size:16px; line-height:1.75;">
          <li><b>Start fast (optional):</b> Tap "📐 Use a Formation" to place a whole group of players at once — like Shotgun or Trips Right. You can still move or change every one of them after.</li>
          <li><b>Or add one at a time:</b> Tap "+ Add Player," then pick who's up (like WR1) or type a name.</li>
          <li><b>Place them:</b> Tap anywhere on the field where they line up.</li>
          <li><b>Pick their route:</b> Tap a route (Slant, Out, Go...) and watch it run before deciding.</li>
          <li><b>Keep it or try another:</b> Tap "USE THIS ROUTE" if it looks right, or "TRY ANOTHER" to pick a different route.</li>
          <li><b>Set the exact depth:</b> Tap a yard chip (5 yd, 10 yd...) or type an exact number, like 8 or 9. Set which way they break — "← Left" or "Right →."</li>
          <li><b>Fine-tune (optional):</b> Not lined up quite right? Just drag the player themselves — their route moves with them. Want a different angle on the route? Drag the gold dot.</li>
          <li><b>Timing (optional):</b> Going in motion before the snap, or waiting a beat after it? Tap "Timing (optional)." Skip it if you don't need it — every route defaults to running right at the snap.</li>
          <li><b>Give them a job:</b> Tap "Looks Good," then pick Primary, Secondary, Decoy, or Other.</li>
          <li><b>Move on:</b> Tap "+ Do Next Player" for the next one — you choose exactly who's next — or "I'm Done For Now" when the play's set.</li>
          <li><b>Watch it come together:</b> Tap "▶ WATCH PLAY" any time to see the snap and every route run together.</li>
          <li><b>Save:</b> When it looks right, save the play with the button at the bottom of the form.</li>
        </ol>
        <button type="button" class="btn btn-primary btn-large" id="fd-help-close" style="margin-top:var(--space-2); width:100%;">Got It</button>
      </div>
    `;
    document.body.appendChild(overlay);
    const closeHelp = () => { overlay.remove(); if (helpOverlay === overlay) helpOverlay = null; };
    overlay.querySelector('#fd-help-close').addEventListener('click', closeHelp);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeHelp(); });
  }

  // ---------- FORMATIONS (bulk-place a preset, then keep editing normally) ----------

  function renderFormationsControls(el) {
    el.innerHTML = `
      <div class="stack">
        ${FORMATIONS.map(
          (f) => `
          <button type="button" class="btn btn-secondary btn-large" data-formation="${f.key}" style="text-align:left; height:auto; padding:14px 18px;">
            <div style="font-weight:800;">${escapeHtml(f.label)}</div>
            <div style="font-weight:400; font-size:14px; opacity:0.85;">${escapeHtml(f.desc)}</div>
          </button>`
        ).join('')}
      </div>
      <button type="button" class="btn btn-link" id="fd-formations-cancel" style="margin-top:var(--space-2);">Cancel</button>
    `;
    el.querySelectorAll('[data-formation]').forEach((btn) => {
      btn.addEventListener('click', () => applyFormation(btn.dataset.formation));
    });
    el.querySelector('#fd-formations-cancel').addEventListener('click', () => goTo('overview'));
  }

  /**
   * Bulk-places a formation's players. A preset is only ever a fast
   * starting point: every position, route, and job it creates is exactly
   * as editable afterward as if placed by hand, one at a time — nothing
   * here is a locked or special state. If a slot the formation wants to
   * place already exists and already has a route, that route travels
   * with the reposition (same delta-translate the drag gesture already
   * uses), so applying a formation never silently discards work.
   */
  function applyFormation(key) {
    const formation = FORMATIONS.find((f) => f.key === key);
    if (!formation) return;

    const hasExisting = Object.keys(design.positions).length > 0;
    if (hasExisting) {
      const proceed = confirm(`Apply ${formation.label}? This repositions any players it names (${Object.keys(formation.positions).join(', ')}) — their routes move with them. Nothing is deleted, and everything stays editable after.`);
      if (!proceed) return;
    }

    Object.entries(formation.positions).forEach(([slot, pos]) => {
      const existed = !!design.positions[slot];
      const route = design.routes[slot];
      if (existed && route?.points) {
        const dx = pos.x - design.positions[slot].x;
        const dy = pos.y - design.positions[slot].y;
        route.points = route.points.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }));
        if (route.endPoint) route.endPoint = { x: clamp01(route.endPoint.x + dx), y: clamp01(route.endPoint.y + dy) };
      }
      design.positions[slot] = { ...pos };
      if (!existed && onSlotAdded) onSlotAdded(slot);
    });

    undoStack.length = 0; // a bulk reposition isn't a single-route action Undo's model can represent
    emitChange();
    goTo('overview');
  }

  // ---------- PICK PLAYER ----------

  function renderPickPlayerControls(el) {
    const available = [...SUGGESTED_SLOTS, ...unplacedKnownSlots].filter(
      (s, i, arr) => arr.indexOf(s) === i && !design.positions[s]
    );
    el.innerHTML = `
      <div class="row-wrap" style="margin-bottom: var(--space-2);">
        ${available.map((s) => `<button type="button" class="btn btn-secondary btn-large" data-pick="${escapeAttr(s)}">${escapeHtml(slotDisplayLabel(s))}</button>`).join('')}
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

  function placePlayer(point) {
    let pos = { x: point.x, y: point.y };
    if (Math.abs(pos.y - LOS_Y_NORM) < LOS_SNAP_THRESHOLD) pos.y = LOS_Y_NORM;
    pos.y = applyCenterQbConstraint(nav.activeSlot, pos.y);
    design.positions[nav.activeSlot] = pos;
    if (onSlotAdded) onSlotAdded(nav.activeSlot);
    emitChange();
    // A quarterback dropping back to throw doesn't run a route — asking
    // "pick their route" the same way as a receiver doesn't make sense
    // for a standard play. This gate only applies to a brand-new QB;
    // it's not forced on every player.
    goTo(nav.activeSlot === 'QB' ? 'qb_role' : 'pick_route');
  }

  // ---------- QB ROLE (standard dropback vs. run/RPO) ----------

  function renderQbRoleControls(el) {
    el.innerHTML = `
      <div class="stack">
        <button type="button" class="btn btn-primary btn-large" id="fd-qb-standard" style="text-align:left; height:auto; padding:14px 18px;">
          <div style="font-weight:800;">Standard — Stays Back to Throw</div>
          <div style="font-weight:400; font-size:14px; opacity:0.85;">No route to draw. QB drops back and reads the field.</div>
        </button>
        <button type="button" class="btn btn-secondary btn-large" id="fd-qb-run" style="text-align:left; height:auto; padding:14px 18px;">
          <div style="font-weight:800;">QB Run / RPO</div>
          <div style="font-weight:400; font-size:14px; opacity:0.85;">Give the QB a running path — a keeper, scramble, or run-pass option.</div>
        </button>
      </div>
    `;
    el.querySelector('#fd-qb-standard').addEventListener('click', () => {
      // No route, no job prompt (Primary/Secondary/Decoy don't apply to
      // a passer who isn't running anywhere) — straight to done.
      design.routes.QB = {
        points: null,
        routeType: null,
        endPoint: null,
        direction: null,
        timing: { phase: 'postsnap', startDelaySeconds: 0 },
        designation: null,
      };
      emitChange();
      goTo('done_slot');
    });
    el.querySelector('#fd-qb-run').addEventListener('click', () => goTo('pick_route'));
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
      goTo('draw_custom');
      return;
    }
    // Deliberately does NOT touch design.routes yet — this is a proposal
    // only, shown via Route Preview, and only becomes real play data if
    // "USE THIS ROUTE" is pressed. Nothing here is saved play data.
    const start = design.positions[nav.activeSlot];
    // flipped=true mirrors the route to break toward the LEFT — so it must
    // be true when the player is lined up on the left half of the field.
    // (Previously inverted: an "out" route defaulted to breaking toward
    // midfield instead of the player's own sideline, regardless of which
    // side they were on — confirmed both directions were backward before
    // this fix. The explicit Depth/Direction chips in Adjust Route always
    // let a coach override this regardless, but the initial preview should
    // start from a sensible default.)
    const flipped = start.x <= 0.5;
    const end = defaultEndpoint(routeType, start, flipped);
    const points = computeRoutePoints(routeType, start, end);
    nav.previewRoute = { points, routeType, endPoint: end, direction: directionFromDelta(start, end) };
    goTo('route_preview');
  }

  // ---------- ROUTE PREVIEW (temporary, not saved until accepted) ----------

  function renderRoutePreviewControls(el) {
    el.innerHTML = `
      <div class="row-wrap">
        <button type="button" class="btn btn-primary btn-large" id="fd-use-route">&check; USE THIS ROUTE</button>
        <button type="button" class="btn btn-secondary btn-large" id="fd-try-another">&#8635; TRY ANOTHER</button>
      </div>
      <button type="button" class="btn btn-link" id="fd-watch-again">&#9654; Watch Again</button>
    `;
    el.querySelector('#fd-use-route').addEventListener('click', acceptPreviewRoute);
    el.querySelector('#fd-try-another').addEventListener('click', () => {
      nav.previewRoute = null;
      goTo('pick_route');
    });
    el.querySelector('#fd-watch-again').addEventListener('click', () => startRoutePreviewAnimation());
  }

  function acceptPreviewRoute() {
    cancelPreviewAnimation();
    design.routes[nav.activeSlot] = {
      points: nav.previewRoute.points,
      routeType: nav.previewRoute.routeType,
      endPoint: nav.previewRoute.endPoint,
      direction: nav.previewRoute.direction,
      timing: { phase: 'postsnap', startDelaySeconds: 0 },
      designation: design.routes[nav.activeSlot]?.designation || null,
    };
    undoStack.push({ type: 'route', slot: nav.activeSlot });
    nav.previewRoute = null;
    emitChange();
    goTo('adjust_route');
  }

  function startRoutePreviewAnimation() {
    cancelPreviewAnimation();
    const markerEl = elRefs.markers.get(nav.activeSlot);
    const start = design.positions[nav.activeSlot];
    if (!markerEl || !nav.previewRoute || !start) return;
    const points = nav.previewRoute.points;
    // Same distance-based pace Watch Play uses — a deeper route visibly
    // takes longer to run in the preview too, not just a fixed 1 second
    // regardless of yardage.
    const runMs = postsnapDurationFor(points) * 1000;

    anim.previewRafId = animateAlongPath(markerEl, points, runMs, () => {
      const last = points[points.length - 1];
      anim.previewRafId = animateAlongPath(markerEl, [last, start], PREVIEW_RETURN_MS, () => {
        markerEl.setAttribute('transform', `translate(${start.x * VIEW_W}, ${start.y * VIEW_H})`);
        anim.previewRafId = null;
      });
    });
  }

  function cancelPreviewAnimation() {
    if (anim.previewRafId) {
      cancelAnimationFrame(anim.previewRafId);
      anim.previewRafId = null;
    }
  }

  // ---------- DRAW CUSTOM ----------

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
      timing: { phase: 'postsnap', startDelaySeconds: 0 },
      designation: design.routes[nav.activeSlot]?.designation || null,
    };
    undoStack.push({ type: 'route', slot: nav.activeSlot });
    emitChange();
    goTo('adjust_route');
  }

  // ---------- ADJUST ROUTE (gold dot + timing) ----------

  function renderAdjustRouteControls(el) {
    const route = design.routes[nav.activeSlot];
    const start = design.positions[nav.activeSlot];
    const isCustom = route?.routeType === 'custom';
    const yards = route?.points ? currentDepthYards(route.routeType, start, route.points) : null;
    const showDirectionChips = !isCustom && hasDirectionChoice(route?.routeType);
    const timing = getTiming(route);
    const timingIsNonDefault = timing.phase === 'presnap' || timing.startDelaySeconds > 0;

    el.innerHTML = `
      ${yards != null ? `<p class="hint">About ${yards} yards deep${route.direction && route.direction !== 'straight' ? ' &middot; breaks ' + escapeHtml(route.direction) : ''}</p>` : ''}
      ${!isCustom ? `
        <p class="hint" style="margin-bottom:2px;">DEPTH &mdash; how many yards do they run before they turn?</p>
        <div class="row-wrap" style="margin-bottom:8px; margin-top:6px;">
          ${DEPTH_OPTIONS_YARDS.map((y) => `<button type="button" class="chip ${yards === y ? 'selected' : ''}" data-depth="${y}">${y} yd</button>`).join('')}
        </div>
        <div class="row" style="margin-bottom:var(--space-2); align-items:center; flex-wrap:wrap;">
          <span class="hint" style="margin:0;">Or type an exact number:</span>
          <input type="number" id="fd-depth-exact" min="1" max="30" step="1" value="${yards ?? ''}" placeholder="yards" style="width:80px;" />
          <span class="hint" style="margin:0;">yd</span>
        </div>
      ` : ''}
      ${showDirectionChips ? `
        <p class="hint" style="margin-bottom:2px;">DIRECTION &mdash; which way do they break?</p>
        <div class="row-wrap" style="margin-bottom:var(--space-2); margin-top:6px;">
          <button type="button" class="chip ${route.direction === 'left' ? 'selected' : ''}" data-direction="left">&larr; Left</button>
          <button type="button" class="chip ${route.direction === 'right' ? 'selected' : ''}" data-direction="right">Right &rarr;</button>
        </div>
      ` : ''}
      <div class="row-wrap">
        <button type="button" class="btn btn-primary btn-large" id="fd-route-good">Looks Good &rarr;</button>
      </div>
      <div class="row-wrap" style="margin-top:var(--space-1);">
        <button type="button" class="btn btn-link" id="fd-change-route">Change Route Type</button>
        <button type="button" class="btn btn-link" id="fd-delete-route">Delete This Route</button>
        <button type="button" class="btn btn-link" id="fd-timing-toggle">
          ${timingIsNonDefault ? `Timing: ${timing.phase === 'presnap' ? 'Before Snap' : 'Delay ' + timing.startDelaySeconds + 's'}` : 'Timing (optional)'}
        </button>
      </div>
      <div id="fd-timing-panel" class="card" style="background:var(--sx-charcoal-2); margin-top:var(--space-2);" ${timingIsNonDefault ? '' : 'hidden'}>
        <p class="hint" style="margin-bottom:8px;">START</p>
        <div class="row-wrap" style="margin-bottom:var(--space-2);">
          <button type="button" class="chip ${timing.phase === 'postsnap' ? 'selected' : ''}" data-start="postsnap">At Snap</button>
          <button type="button" class="chip ${timing.phase === 'presnap' ? 'selected' : ''}" data-start="presnap">Before Snap</button>
        </div>
        <div id="fd-delay-section" ${timing.phase === 'presnap' ? 'hidden' : ''}>
          <p class="hint" style="margin-bottom:8px;">DELAY</p>
          <div class="row-wrap">
            ${DELAY_OPTIONS_SECONDS.map((d) => `<button type="button" class="chip ${timing.startDelaySeconds === d ? 'selected' : ''}" data-delay="${d}">${d === 0 ? 'None' : d + ' sec'}</button>`).join('')}
          </div>
        </div>
      </div>
    `;
    el.querySelector('#fd-route-good').addEventListener('click', () => goTo('pick_job'));
    el.querySelector('#fd-change-route').addEventListener('click', () => goTo('pick_route'));
    el.querySelector('#fd-delete-route').addEventListener('click', () => {
      delete design.routes[nav.activeSlot];
      emitChange();
      goTo('pick_job');
    });
    el.querySelector('#fd-timing-toggle').addEventListener('click', () => {
      const panel = el.querySelector('#fd-timing-panel');
      panel.hidden = !panel.hidden;
    });
    if (!isCustom) {
      const currentFallbackDirection = () => (showDirectionChips ? (route.direction === 'left' ? 'left' : 'right') : 'straight');
      el.querySelectorAll('[data-depth]').forEach((btn) => {
        btn.addEventListener('click', () => {
          applyDepthDirection(Number(btn.dataset.depth), currentFallbackDirection());
          renderAdjustRouteControls(el);
        });
      });
      const exactInput = el.querySelector('#fd-depth-exact');
      const applyExact = () => {
        const val = Number(exactInput.value);
        if (val > 0) {
          applyDepthDirection(val, currentFallbackDirection());
          renderAdjustRouteControls(el);
        }
      };
      exactInput.addEventListener('change', applyExact);
      exactInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyExact(); }
      });
    }
    if (showDirectionChips) {
      el.querySelectorAll('[data-direction]').forEach((btn) => {
        btn.addEventListener('click', () => {
          applyDepthDirection(yards ?? 8, btn.dataset.direction);
          renderAdjustRouteControls(el);
        });
      });
    }
    el.querySelectorAll('[data-start]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const phase = btn.dataset.start;
        route.timing = { phase, startDelaySeconds: phase === 'presnap' ? 0 : (route.timing?.startDelaySeconds || 0) };
        emitChange();
        renderAdjustRouteControls(el);
      });
    });
    el.querySelectorAll('[data-delay]').forEach((btn) => {
      btn.addEventListener('click', () => {
        route.timing = { phase: route.timing?.phase || 'postsnap', startDelaySeconds: Number(btn.dataset.delay) };
        emitChange();
        renderAdjustRouteControls(el);
      });
    });
  }

  /**
   * Sets a route's shape from an explicit depth (yards) + direction chip
   * tap, instead of a freeform drag. Writes the exact same
   * points/endPoint/direction fields the gold-dot drag handle writes, so
   * nothing downstream needs to know which method set them — and the
   * handle remains available afterward to fine-tune on top of this.
   */
  function applyDepthDirection(depthYards, direction) {
    const route = design.routes[nav.activeSlot];
    const start = design.positions[nav.activeSlot];
    const end = endpointFromDepthAndDirection(route.routeType, start, depthYards, direction);
    const points = computeRoutePoints(route.routeType, start, end);
    route.points = points;
    route.endPoint = end;
    route.direction = directionFromDelta(start, end);

    const routeEl = elRefs.routes.get(nav.activeSlot);
    if (routeEl) routeEl.setAttribute('points', pointsToAttr(points));
    if (elRefs.handle) elRefs.handle.setAttribute('transform', `translate(${end.x * VIEW_W}, ${end.y * VIEW_H})`);

    emitChange();
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
      design.routes[nav.activeSlot] = {
        points: null,
        routeType: null,
        endPoint: null,
        direction: null,
        timing: { phase: 'postsnap', startDelaySeconds: 0 },
        designation: job || null,
      };
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

  // ---------- WATCH PLAY ----------

  function startWatchPlay() {
    const schedule = buildPlaySchedule(design);
    anim.watchPlay = { schedule, startTs: performance.now(), pausedElapsed: 0, isPaused: false, lastPhase: null, rafId: null };
    nav.mode = null;
    render(); // one clean rebuild: swaps Overview controls to Play/Pause/Restart/Exit
    runWatchPlayFrame();
  }

  function renderWatchPlayControls(el) {
    el.innerHTML = `
      <div id="fd-watch-banner" style="margin-bottom: var(--space-2); text-align:center;"></div>
      <div class="row-wrap">
        <button type="button" class="btn btn-primary btn-large" id="fd-play-pause"></button>
        <button type="button" class="btn btn-secondary btn-large" id="fd-restart">&#8635; Restart / Replay</button>
        <button type="button" class="btn btn-link" id="fd-exit-watch">Exit</button>
      </div>
    `;
    updatePlayPauseButtonLabel();
    el.querySelector('#fd-play-pause').addEventListener('click', toggleWatchPause);
    el.querySelector('#fd-restart').addEventListener('click', restartWatchPlay);
    el.querySelector('#fd-exit-watch').addEventListener('click', exitWatchPlay);
    updateWatchBanner(anim.watchPlay.lastPhase || (anim.watchPlay.schedule.hasPresnap ? 'presnap' : 'postsnap'));
  }

  function runWatchPlayFrame() {
    const wp = anim.watchPlay;
    if (!wp || wp.isPaused) return;
    const elapsedS = (performance.now() - wp.startTs) / 1000 + wp.pausedElapsed;
    const frame = computeFrame(design, wp.schedule, elapsedS);

    Object.entries(frame.positions).forEach(([slot, pos]) => {
      const markerEl = elRefs.markers.get(slot);
      if (markerEl) markerEl.setAttribute('transform', `translate(${pos.x * VIEW_W}, ${pos.y * VIEW_H})`);
    });

    if (frame.phaseLabel !== wp.lastPhase) {
      wp.lastPhase = frame.phaseLabel;
      updateWatchBanner(frame.phaseLabel);
    }

    if (frame.phaseLabel === 'done') {
      wp.isPaused = true;
      updatePlayPauseButtonLabel();
      return;
    }
    wp.rafId = requestAnimationFrame(runWatchPlayFrame);
  }

  function updateWatchBanner(phaseLabel) {
    const bannerEl = container.querySelector('#fd-watch-banner');
    if (!bannerEl) return;
    const isSnap = phaseLabel === 'snap';
    const text = phaseLabel === 'presnap' ? 'Pre-snap motion&hellip;' : isSnap ? 'SNAP!' : phaseLabel === 'done' ? 'Play finished.' : 'Watching the play&hellip;';
    bannerEl.innerHTML = `<span style="font-size:${isSnap ? '30px' : '18px'}; font-weight:800; color:${isSnap ? 'var(--sx-gold)' : 'var(--sx-white)'};">${text}</span>`;
  }

  function updatePlayPauseButtonLabel() {
    const btn = container.querySelector('#fd-play-pause');
    if (btn) btn.textContent = anim.watchPlay?.isPaused ? '▶ Play' : '⏸ Pause';
  }

  function toggleWatchPause() {
    const wp = anim.watchPlay;
    if (!wp) return;
    if (wp.isPaused) {
      wp.isPaused = false;
      wp.startTs = performance.now();
      updatePlayPauseButtonLabel();
      runWatchPlayFrame();
    } else {
      wp.pausedElapsed += (performance.now() - wp.startTs) / 1000;
      wp.isPaused = true;
      if (wp.rafId) cancelAnimationFrame(wp.rafId);
      updatePlayPauseButtonLabel();
    }
  }

  function restartWatchPlay() {
    const wp = anim.watchPlay;
    if (!wp) return;
    if (wp.rafId) cancelAnimationFrame(wp.rafId);
    wp.startTs = performance.now();
    wp.pausedElapsed = 0;
    wp.isPaused = false;
    wp.lastPhase = null;
    updatePlayPauseButtonLabel();
    runWatchPlayFrame();
  }

  function exitWatchPlay() {
    const wp = anim.watchPlay;
    if (wp?.rafId) cancelAnimationFrame(wp.rafId);
    anim.watchPlay = null;
    // Full rebuild — the guarantee that every marker returns exactly to
    // its true design position, regardless of any float drift during
    // animation, comes from reading design.positions fresh here.
    render();
  }

  // ---------- navigation ----------

  function goTo(screen) {
    cancelPreviewAnimation();
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
    const isPlaceable = nav.screen === 'place_player';
    const g = svgEl('g', { transform: `translate(${pos.x * VIEW_W}, ${pos.y * VIEW_H})`, style: 'cursor:pointer;' });
    // Invisible larger hit target — a real finger's contact area is much
    // bigger than a mouse pointer, and the visible dot alone (44px on a
    // real phone) falls short of this app's own 52px minimum tap target.
    // fill="transparent" (not "none") is what makes SVG count this area
    // as touchable at all, while staying completely invisible.
    g.appendChild(svgEl('circle', { r: MARKER_HIT_R, fill: 'transparent' }));
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
    let route = design.routes[slot];
    // During Route Preview, the proposed route isn't saved data yet — it
    // lives in nav.previewRoute and is drawn for the active slot only.
    if (nav.screen === 'route_preview' && slot === nav.activeSlot && nav.previewRoute) {
      route = { points: nav.previewRoute.points, designation: null };
    }
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
      // Isolation rule: while Watch Play is running, no marker gesture is
      // ever live — the mode buttons aren't even shown, but this guards
      // the handler itself too, defensively.
      if (anim.watchPlay) return;
      // On Adjust Route, the player being edited is directly draggable —
      // no separate "Move Player" mode needed, since there's only one
      // player in play at that point. Their route (already set) travels
      // with them, exactly like Overview's Move Player mode.
      const isActiveInAdjust = nav.screen === 'adjust_route' && slot === nav.activeSlot;
      if ((nav.screen === 'overview' && nav.mode === 'move') || isActiveInAdjust) {
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

  /**
   * The Center snaps the ball directly TO the QB — they can never end up
   * positioned behind (deeper into the backfield than) the QB, and the
   * QB can never end up in front of (shallower than) the Center. Applies
   * during any drag of either player, using whichever position the OTHER
   * one currently holds. Every other player (WRs) is intentionally left
   * fully free to cross the line of scrimmage in either direction.
   */
  function applyCenterQbConstraint(slot, ny) {
    if (slot === 'C' && design.positions.QB) return Math.min(ny, design.positions.QB.y);
    if (slot === 'QB' && design.positions.C) return Math.max(ny, design.positions.C.y);
    return ny;
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
      ny = applyCenterQbConstraint(slot, ny);

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

  // ---------- shared animation helper ----------

  /**
   * Animates a marker element along `points` over `durationMs`, updating
   * only its transform attribute (never touching DOM structure). Returns
   * the current rAF id so the caller can cancel it. Calls `onDone` once,
   * after which the marker is guaranteed to be exactly at the last point.
   */
  function animateAlongPath(markerEl, points, durationMs, onDone) {
    const startTime = performance.now();
    let rafId;
    function frame(now) {
      const t = Math.min(1, (now - startTime) / durationMs);
      const pos = interpolateAlongPath(points, t);
      markerEl.setAttribute('transform', `translate(${pos.x * VIEW_W}, ${pos.y * VIEW_H})`);
      if (t < 1) {
        rafId = requestAnimationFrame(frame);
      } else if (onDone) {
        onDone();
      }
    }
    rafId = requestAnimationFrame(frame);
    return rafId;
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
    cancelPreviewAnimation();
    if (anim.watchPlay?.rafId) cancelAnimationFrame(anim.watchPlay.rafId);
    // The Help overlay is deliberately appended to document.body (so it
    // can cover the whole screen), which means it lives OUTSIDE this
    // container and would otherwise survive navigating away — orphaned,
    // permanently blocking the screen underneath it.
    if (helpOverlay) { helpOverlay.remove(); helpOverlay = null; }
    container.innerHTML = '';
  }

  function removeSlot(label) {
    delete design.positions[label];
    delete design.routes[label];
    if (nav.activeSlot === label) nav.activeSlot = null;
    render();
    emitChange();
  }

  return { getDesign, removeSlot, destroy };

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
