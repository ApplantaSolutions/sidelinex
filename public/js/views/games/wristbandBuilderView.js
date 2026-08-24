import { getGame, getGamePlan, getWeeklyRoles, listPlays, getActiveVersion, listActivePlayers } from '../../data.js';
import { resolvePlayerForSlot, slotsForPlayer } from '../../playbook/roleResolution.js';
import { buildFieldSvgMarkup } from '../../playbook/staticFieldSvg.js';
import { findDuplicateWristbandCodes, computeWristbandLayout } from '../../playbook/wristbandLogic.js';
import { buildWristbandPrintHtml } from '../../playbook/wristbandPrint.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

const TEMPLATE_STORAGE_KEY = 'sx_wristband_template';
const DEFAULT_TEMPLATE = { insertWidthIn: 2, insertHeightIn: 2.5, marginIn: 0.25, playsPerPanel: 3 };

function loadTemplate() {
  try {
    const saved = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || 'null');
    return saved ? { ...DEFAULT_TEMPLATE, ...saved } : { ...DEFAULT_TEMPLATE };
  } catch {
    return { ...DEFAULT_TEMPLATE };
  }
}

function saveTemplate(template) {
  try { localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(template)); } catch { /* ignore quota/private-mode errors — non-critical convenience only */ }
}

export async function renderWristbandBuilderView(root, team, claims, gameId) {
  let cardType = 'team'; // 'team' | 'qb' | 'player'
  let selectedPlayerId = null;
  let template = loadTemplate();

  root.innerHTML = `<p class="hint">Loading Game Plan...</p>`;
  const [game, gamePlan, weeklyRoles, players, allOffense, allDefense] = await Promise.all([
    getGame(claims.teamId, gameId),
    getGamePlan(claims.teamId, gameId),
    getWeeklyRoles(claims.teamId, gameId),
    listActivePlayers(claims.teamId),
    listPlays(claims.teamId, { side: 'offense' }),
    listPlays(claims.teamId, { side: 'defense' }),
  ]);
  const allPlays = [...allOffense, ...allDefense];
  const playsById = {};
  allPlays.forEach((p) => { playsById[p.id] = p; });

  const entries = gamePlan.entries.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const versions = await Promise.all(
    entries.map((e) => {
      const p = playsById[e.playId];
      return p?.activeVersionId ? getActiveVersion(claims.teamId, p.id, p.activeVersionId) : null;
    })
  );
  const versionByPlayId = {};
  entries.forEach((e, i) => { versionByPlayId[e.playId] = versions[i]; });

  const duplicates = findDuplicateWristbandCodes(entries, playsById);

  render();

  function render() {
    if (entries.length === 0) {
      root.innerHTML = `<div class="card"><p class="hint" style="margin:0;">Add plays to the Game Plan first — Wristband Builder generates cards from whatever's in the plan.</p></div>`;
      return;
    }

    const qbSlotExists = allPlays.some((p) => p.side === 'offense'); // QB card applies to offense; gate softly below per-play
    root.innerHTML = `
      <div class="card">
        <div class="card-header-row">
          <h2>Card Type</h2>
          ${helpButtonHtml('wristbands')}
        </div>
        <div class="row-wrap" style="margin-bottom: var(--space-2);">
          <button type="button" class="chip ${cardType === 'team' ? 'selected' : ''}" data-card-type="team">Team / General</button>
          <button type="button" class="chip ${cardType === 'qb' ? 'selected' : ''}" data-card-type="qb">QB</button>
          <button type="button" class="chip ${cardType === 'player' ? 'selected' : ''}" data-card-type="player">Player-Specific</button>
        </div>
        ${cardType === 'player' ? `
          <p class="hint" style="margin-bottom:6px;">Which player?</p>
          <div class="row-wrap">
            ${players.map((p) => `<button type="button" class="chip ${selectedPlayerId === p.id ? 'selected' : ''}" data-select-player="${p.id}">${escapeHtml(p.firstName)}</button>`).join('')}
          </div>
        ` : ''}
      </div>

      ${duplicates.length > 0 ? `
        <div class="card" style="border-color:var(--sx-error); background:var(--sx-error-dim, rgba(224,67,63,0.1));">
          <h2 style="color:var(--sx-error);">&#128683; CAN'T PRINT &mdash; DUPLICATE CALL NUMBER</h2>
          ${duplicates.map((d) => `<p style="margin:0 0 6px 0;">Code <b>${escapeHtml(d.code)}</b> is used by more than one play: <b>${escapeHtml(d.names.join(', '))}</b></p>`).join('')}
          <p class="hint" style="margin:8px 0 0 0;">Two plays can't share a call number on the field — go to the Playbook and give one of these a different Wristband Code. Printing stays blocked until they're unique.</p>
        </div>
      ` : ''}

      <div class="card">
        <h2>Insert Template</h2>
        <p class="hint" style="margin-bottom:var(--space-2);">Custom for now — enter your wristband insert's real measurements. We'll add saved manufacturer sizes later.</p>
        <div class="row" style="gap: var(--space-2); flex-wrap:wrap;">
          <label class="field" style="flex:1; min-width:120px;">
            <span>Width (in)</span>
            <input type="number" id="wb-width" min="0.5" step="0.25" value="${template.insertWidthIn}" />
          </label>
          <label class="field" style="flex:1; min-width:120px;">
            <span>Height (in)</span>
            <input type="number" id="wb-height" min="0.5" step="0.25" value="${template.insertHeightIn}" />
          </label>
        </div>
        <div class="row" style="gap: var(--space-2); flex-wrap:wrap; margin-top: var(--space-2);">
          <label class="field" style="flex:1; min-width:120px;">
            <span>Margin (in)</span>
            <input type="number" id="wb-margin" min="0" step="0.05" value="${template.marginIn}" />
          </label>
          <label class="field" style="flex:1; min-width:120px;">
            <span>Plays per Panel</span>
            <input type="number" id="wb-per-panel" min="1" step="1" value="${template.playsPerPanel}" />
          </label>
        </div>
      </div>

      ${previewSectionHtml()}

      <button type="button" id="wb-print" class="btn btn-primary btn-large" style="width:100%; margin-top: var(--space-2);" ${printDisabled() ? 'disabled' : ''}>
        &#128424; Print / Open Print Preview
      </button>
      ${cardType === 'player' && !selectedPlayerId ? '<p class="hint" style="text-align:center;">Pick a player above first.</p>' : ''}
    `;

    wireEvents();
  }

  function printDisabled() {
    if (cardType === 'player' && !selectedPlayerId) return true;
    // Hard block, no override: two plays sharing a wristband code is a
    // real, game-day-dangerous conflict (the coach calls "12" and two
    // different plays could run) — there is no confirmation checkbox that
    // makes that safe to print.
    if (duplicates.length > 0) return true;
    return false;
  }

  function currentTiles() {
    const tiles = [];
    entries.forEach((e) => {
      const play = playsById[e.playId];
      if (!play) return;
      const version = versionByPlayId[e.playId];
      const design = version?.fieldDesign || { positions: {}, routes: {} };

      if (cardType === 'team') {
        tiles.push({
          wristbandCode: play.wristbandCode || '--',
          playName: play.name,
          svgMarkup: buildFieldSvgMarkup(design, { compact: true }),
          cueText: null,
        });
      } else if (cardType === 'qb') {
        if (play.side !== 'offense') return; // QB card only makes sense for offensive calls
        const primary = play.intent?.primaryTargetSlot;
        const secondary = play.intent?.secondaryTargetSlot;
        const cueParts = [];
        if (primary) cueParts.push(`P: ${primary}${design.routes?.[primary]?.routeType ? ` (${cap(design.routes[primary].routeType)})` : ''}`);
        if (secondary) cueParts.push(`S: ${secondary}${design.routes?.[secondary]?.routeType ? ` (${cap(design.routes[secondary].routeType)})` : ''}`);
        tiles.push({
          wristbandCode: play.wristbandCode || '--',
          playName: play.name,
          svgMarkup: buildFieldSvgMarkup(design, { compact: true }),
          cueText: cueParts.join(' / ') || null,
        });
      } else if (cardType === 'player' && selectedPlayerId) {
        const mySlot = slotsForPlayer(weeklyRoles, play.side, selectedPlayerId)[0];
        if (!mySlot || !design.positions[mySlot]) return; // this player isn't in this play
        const route = design.routes?.[mySlot];
        const cueParts = [];
        if (route?.routeType) cueParts.push(cap(route.routeType).toUpperCase());
        if (route?.designation) cueParts.push(route.designation.toUpperCase());
        tiles.push({
          wristbandCode: play.wristbandCode || '--',
          playName: play.name,
          svgMarkup: buildFieldSvgMarkup(design, { compact: true, highlightSlot: mySlot }),
          cueText: cueParts.join(' • ') || null,
        });
      }
    });
    return tiles;
  }

  function previewSectionHtml() {
    if (cardType === 'player' && !selectedPlayerId) return '';
    const tiles = currentTiles();
    if (tiles.length === 0) {
      return `<div class="card"><p class="hint" style="margin:0;">No plays to show for this card type${cardType === 'player' ? ' — this player has no assignment in this Game Plan yet' : ''}.</p></div>`;
    }
    const layout = computeWristbandLayout({
      totalPlays: tiles.length,
      playsPerPanel: template.playsPerPanel,
      insertWidthIn: template.insertWidthIn,
      insertHeightIn: template.insertHeightIn,
      marginIn: template.marginIn,
    });
    return `
      <div class="card">
        <h2>Preview</h2>
        <p class="hint" style="margin-bottom:var(--space-2);">${tiles.length} plays &middot; ${layout.panelsNeeded} panel${layout.panelsNeeded === 1 ? '' : 's'} &middot; ${layout.panelsPerPage} per page &middot; ${layout.pagesNeeded} page${layout.pagesNeeded === 1 ? '' : 's'}</p>
        <div class="row-wrap">
          ${tiles.slice(0, 6).map((t) => `
            <div style="width:110px; background:#0f1a13; border-radius:8px; padding:6px; border:1px solid var(--sx-border);">
              <div style="font-size:11px; font-weight:800; color:var(--sx-gold);">${escapeHtml(t.wristbandCode)} &middot; ${escapeHtml(t.playName)}</div>
              <div style="width:100%; aspect-ratio:4/5; margin-top:4px;">${t.svgMarkup}</div>
              ${t.cueText ? `<div style="font-size:9px; text-align:center; margin-top:2px;">${escapeHtml(t.cueText)}</div>` : ''}
            </div>
          `).join('')}
          ${tiles.length > 6 ? `<div class="hint" style="align-self:center;">+${tiles.length - 6} more</div>` : ''}
        </div>
      </div>
    `;
  }

  function wireEvents() {
    wireCoachHelpButtons(root);

    root.querySelectorAll('[data-card-type]').forEach((btn) => {
      btn.addEventListener('click', () => { cardType = btn.dataset.cardType; render(); });
    });
    root.querySelectorAll('[data-select-player]').forEach((btn) => {
      btn.addEventListener('click', () => { selectedPlayerId = btn.dataset.selectPlayer; render(); });
    });
    ['wb-width', 'wb-height', 'wb-margin', 'wb-per-panel'].forEach((id) => {
      const el = root.querySelector(`#${id}`);
      if (!el) return;
      el.addEventListener('change', () => {
        template = {
          insertWidthIn: Number(root.querySelector('#wb-width').value) || DEFAULT_TEMPLATE.insertWidthIn,
          insertHeightIn: Number(root.querySelector('#wb-height').value) || DEFAULT_TEMPLATE.insertHeightIn,
          marginIn: Number(root.querySelector('#wb-margin').value) || 0,
          playsPerPanel: Number(root.querySelector('#wb-per-panel').value) || 1,
        };
        saveTemplate(template);
        render();
      });
    });

    const printBtn = root.querySelector('#wb-print');
    if (printBtn) printBtn.addEventListener('click', doPrint);
  }

  function doPrint() {
    const tiles = currentTiles();
    const layout = computeWristbandLayout({
      totalPlays: tiles.length,
      playsPerPanel: template.playsPerPanel,
      insertWidthIn: template.insertWidthIn,
      insertHeightIn: template.insertHeightIn,
      marginIn: template.marginIn,
    });
    const playerLabel = cardType === 'player' && selectedPlayerId
      ? `${players.find((p) => p.id === selectedPlayerId)?.firstName || ''} — ${slotsForPlayer(weeklyRoles, 'offense', selectedPlayerId)[0] || slotsForPlayer(weeklyRoles, 'defense', selectedPlayerId)[0] || ''}`
      : null;
    const html = buildWristbandPrintHtml({
      cardType,
      playerLabel,
      gameLabel: `${game.name}${game.opponent ? ' vs. ' + game.opponent : ''}`,
      template,
      tiles,
      layout,
    });
    const win = window.open('', '_blank');
    if (!win) {
      alert('Your browser blocked the print window pop-up — allow pop-ups for this site and try again.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}

function cap(str) {
  const s = String(str ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
