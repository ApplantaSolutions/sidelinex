import { buildPlaySchedule, computeFrame } from './animation.js';
import { computeDefensePositions, MAN_REACTION_LAG_S } from './defenseAnimation.js';

// Read-only companion to fieldDesigner.js's Watch Play — same field
// rendering, same animation engine (buildPlaySchedule/computeFrame, the
// exact functions the coach's Designer uses), but with zero editing
// surface. Deliberately a separate, small module rather than a
// "readOnly" flag threaded through the Designer: that component's
// gesture handling (drag-to-move, drag-to-draw, formations, undo) is
// large and delicate, and none of it should ever be reachable by a
// player viewing a play the coach already finished.

const VIEW_W = 400;
const VIEW_H = 500;
const LOS_Y_NORM = 0.72;
const MARKER_R = 22;
const DEFENDER_R = 20;
const DEFENSE_MODE_LABELS = { man: 'MAN', zone: 'ZONE', pressure: 'PRESSURE', custom: 'CUSTOM' };

export function createPlayViewer(container, { design, highlightSlot = null }) {
  const elRefs = { markers: new Map(), defenderMarkers: new Map() };
  let watchPlay = null; // { schedule, startTs, pausedElapsed, isPaused, lastPhase, rafId }
  const defense = design.defense || { mode: null, defenders: {}, looks: {} };
  if (!defense.looks) defense.looks = {};

  render();

  function availableDefenseLooks() {
    return Object.keys(DEFENSE_MODE_LABELS).filter((mode) => {
      if (mode === defense.mode) return Object.keys(defense.defenders || {}).length > 0;
      return !!defense.looks[mode]?.defenders && Object.keys(defense.looks[mode].defenders).length > 0;
    });
  }

  function switchDefenseLook(newMode) {
    if (newMode === defense.mode) return;
    if (defense.mode) defense.looks[defense.mode] = { defenders: defense.defenders };
    defense.mode = newMode;
    defense.defenders = defense.looks[newMode]?.defenders ? { ...defense.looks[newMode].defenders } : {};
    const wasWatching = !!watchPlay;
    if (watchPlay?.rafId) cancelAnimationFrame(watchPlay.rafId);
    watchPlay = null;
    // Full render() rebuilds the SVG's defender markers to match the new
    // mode's defender IDs — reusing the old marker elements would leave
    // them tracking a mode that no longer exists (their ids wouldn't
    // match anything computeDefensePositions returns for the new look).
    render();
    if (wasWatching) start();
  }

  function render() {
    const hasAnyRoute = Object.values(design.routes || {}).some((r) => r?.points && r.points.length >= 2);
    const looks = availableDefenseLooks();
    container.innerHTML = `
      <div style="border-radius: var(--radius); overflow: hidden; border: 1px solid var(--sx-border);">
        <svg id="pv-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" style="width:100%; display:block; background:#0f1a13;"></svg>
      </div>
      <div id="pv-banner" style="margin: var(--space-2) 0; text-align:center; min-height:24px;"></div>
      ${looks.length > 1 ? `
        <div class="row-wrap" id="pv-defense-switch" style="justify-content:center; margin-bottom:var(--space-2);">
          ${looks.map((m) => `<button type="button" class="chip ${m === defense.mode ? 'selected' : ''}" data-defense-look="${m}">${DEFENSE_MODE_LABELS[m]}</button>`).join('')}
        </div>
      ` : ''}
      ${defense.mode ? `<p class="hint" style="text-align:center; margin-bottom:var(--space-2);">Defenders (red) show a <b>modeled teaching look</b> against ${DEFENSE_MODE_LABELS[defense.mode]} &mdash; not a guarantee of a real defense.</p>` : ''}
      <div id="pv-controls"></div>
    `;
    elRefs.markers.clear();
    elRefs.defenderMarkers.clear();
    const svg = container.querySelector('#pv-svg');
    drawFieldBackground(svg);
    Object.keys(design.positions || {}).forEach((slot) => drawRoute(svg, slot));
    Object.keys(design.positions || {}).forEach((slot) => drawMarker(svg, slot));
    Object.entries(defense.defenders || {}).forEach(([id, d]) => drawDefenderMarker(svg, id, d));
    container.querySelectorAll('[data-defense-look]').forEach((chip) => {
      chip.addEventListener('click', () => switchDefenseLook(chip.dataset.defenseLook));
    });

    const controls = container.querySelector('#pv-controls');
    if (!hasAnyRoute) {
      controls.innerHTML = '<p class="hint">This play has no routes drawn — nothing to watch yet.</p>';
      return;
    }
    renderControls(controls);
  }

  function renderControls(el) {
    if (watchPlay) {
      el.innerHTML = `
        <div class="row-wrap">
          <button type="button" class="btn btn-primary btn-large" id="pv-play-pause"></button>
          <button type="button" class="btn btn-secondary btn-large" id="pv-restart">&#8635; Restart</button>
        </div>
      `;
      updatePlayPauseLabel();
      el.querySelector('#pv-play-pause').addEventListener('click', togglePause);
      el.querySelector('#pv-restart').addEventListener('click', restart);
    } else {
      el.innerHTML = `<button type="button" class="btn btn-primary btn-large" id="pv-watch" style="width:100%;">&#9654; WATCH PLAY</button>`;
      el.querySelector('#pv-watch').addEventListener('click', start);
    }
  }

  function start() {
    const schedule = buildPlaySchedule(design);
    watchPlay = { schedule, startTs: performance.now(), pausedElapsed: 0, isPaused: false, lastPhase: null, rafId: null };
    renderControls(container.querySelector('#pv-controls'));
    runFrame();
  }

  function runFrame() {
    if (!watchPlay || watchPlay.isPaused) return;
    const elapsedS = (performance.now() - watchPlay.startTs) / 1000 + watchPlay.pausedElapsed;
    const frame = computeFrame(design, watchPlay.schedule, elapsedS);

    Object.entries(frame.positions).forEach(([slot, pos]) => {
      const markerEl = elRefs.markers.get(slot);
      if (markerEl) markerEl.setAttribute('transform', `translate(${pos.x * VIEW_W}, ${pos.y * VIEW_H})`);
    });

    if (defense.mode) {
      const fullOffensePositions = { ...design.positions, ...frame.positions };
      const laggedFrame = computeFrame(design, watchPlay.schedule, Math.max(0, elapsedS - MAN_REACTION_LAG_S));
      const laggedOffensePositions = { ...design.positions, ...laggedFrame.positions };
      const elapsedSinceSnapS = elapsedS - watchPlay.schedule.postsnapPhaseStart;
      const postsnapDurationS = watchPlay.schedule.totalDuration - watchPlay.schedule.postsnapPhaseStart;
      const defPositions = computeDefensePositions(defense, fullOffensePositions, laggedOffensePositions, elapsedSinceSnapS, postsnapDurationS);
      Object.entries(defPositions).forEach(([id, pos]) => {
        const markerEl = elRefs.defenderMarkers.get(id);
        if (markerEl) markerEl.setAttribute('transform', `translate(${pos.x * VIEW_W}, ${pos.y * VIEW_H}) rotate(45)`);
      });
    }

    if (frame.phaseLabel !== watchPlay.lastPhase) {
      watchPlay.lastPhase = frame.phaseLabel;
      updateBanner(frame.phaseLabel);
    }

    if (frame.phaseLabel === 'done') {
      watchPlay.isPaused = true;
      updatePlayPauseLabel();
      return;
    }
    watchPlay.rafId = requestAnimationFrame(runFrame);
  }

  function updateBanner(phaseLabel) {
    const bannerEl = container.querySelector('#pv-banner');
    if (!bannerEl) return;
    const isSnap = phaseLabel === 'snap';
    const text = phaseLabel === 'presnap' ? 'Pre-snap motion&hellip;' : isSnap ? 'SNAP!' : phaseLabel === 'done' ? 'Play finished.' : 'Watching the play&hellip;';
    bannerEl.innerHTML = `<span style="font-size:${isSnap ? '28px' : '17px'}; font-weight:800; color:${isSnap ? 'var(--sx-gold)' : 'var(--sx-white)'};">${text}</span>`;
  }

  function updatePlayPauseLabel() {
    const btn = container.querySelector('#pv-play-pause');
    if (btn) btn.textContent = watchPlay?.isPaused ? '▶ Play' : '⏸ Pause';
  }

  function togglePause() {
    if (!watchPlay) return;
    if (watchPlay.isPaused) {
      watchPlay.isPaused = false;
      watchPlay.startTs = performance.now();
      updatePlayPauseLabel();
      runFrame();
    } else {
      watchPlay.pausedElapsed += (performance.now() - watchPlay.startTs) / 1000;
      watchPlay.isPaused = true;
      if (watchPlay.rafId) cancelAnimationFrame(watchPlay.rafId);
      updatePlayPauseLabel();
    }
  }

  function restart() {
    if (!watchPlay) return;
    if (watchPlay.rafId) cancelAnimationFrame(watchPlay.rafId);
    watchPlay.startTs = performance.now();
    watchPlay.pausedElapsed = 0;
    watchPlay.isPaused = false;
    watchPlay.lastPhase = null;
    updatePlayPauseLabel();
    runFrame();
  }

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
    const isMe = highlightSlot && slot === highlightSlot;
    // "Watch My Job" never hides teammates — it dims them, so a player
    // still sees the whole play's shape and where they fit in it, not
    // just an isolated dot on an empty field.
    const dimmed = highlightSlot && !isMe;
    const g = svgEl('g', { transform: `translate(${pos.x * VIEW_W}, ${pos.y * VIEW_H})`, opacity: dimmed ? 0.35 : 1 });
    if (isMe) {
      g.appendChild(svgEl('circle', { r: MARKER_R + 7, fill: '#c9a227', opacity: 0.3 }));
    }
    g.appendChild(svgEl('circle', {
      r: MARKER_R,
      fill: isMe ? '#c9a227' : '#1f1f23',
      stroke: isMe ? '#e6c34a' : '#5a5a62',
      'stroke-width': isMe ? 3.5 : 2.5,
    }));
    const label = svgEl('text', { x: 0, y: 5, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800, fill: isMe ? '#0a0a0b' : '#f7f7f5' });
    label.textContent = slot;
    g.appendChild(label);
    if (isMe) {
      const youLabel = svgEl('text', { x: 0, y: -MARKER_R - 10, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800, fill: '#e6c34a' });
      youLabel.textContent = 'YOU';
      g.appendChild(youLabel);
    }
    svg.appendChild(g);
    elRefs.markers.set(slot, g);
  }

  function drawDefenderMarker(svg, id, defender) {
    const pos = defender.position;
    const g = svgEl('g', { transform: `translate(${pos.x * VIEW_W}, ${pos.y * VIEW_H}) rotate(45)` });
    g.appendChild(svgEl('rect', { x: -DEFENDER_R * 0.75, y: -DEFENDER_R * 0.75, width: DEFENDER_R * 1.5, height: DEFENDER_R * 1.5, fill: '#7a1f22', stroke: '#e0433f', 'stroke-width': 2.5 }));
    const label = svgEl('text', { x: 0, y: 5, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 800, fill: '#fff', transform: 'rotate(-45)' });
    label.textContent = defender.label;
    g.appendChild(label);
    svg.appendChild(g);
    elRefs.defenderMarkers.set(id, g);
  }

  function drawRoute(svg, slot) {
    const route = design.routes[slot];
    if (!route || !route.points || route.points.length < 2) return;
    const isMe = highlightSlot && slot === highlightSlot;
    const dimmed = highlightSlot && !isMe;
    const isPrimary = route.designation === 'primary';
    const isSecondary = route.designation === 'secondary';
    const color = isMe ? '#e6c34a' : isPrimary ? '#c9a227' : isSecondary ? '#d6d6da' : '#7a7a82';
    svg.appendChild(
      svgEl('polyline', {
        points: route.points.map((p) => `${p.x * VIEW_W},${p.y * VIEW_H}`).join(' '),
        fill: 'none',
        stroke: color,
        'stroke-width': isMe ? 5 : isPrimary ? 4 : 2.5,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-dasharray': !isMe && route.designation === 'decoy' ? '4,4' : '',
        opacity: dimmed ? 0.35 : 1,
      })
    );
  }

  function destroy() {
    if (watchPlay?.rafId) cancelAnimationFrame(watchPlay.rafId);
    container.innerHTML = '';
  }

  return { destroy };
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}
