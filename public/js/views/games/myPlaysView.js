import { listGames, getGame, getGamePlan, getWeeklyRoles, listPlays, getActiveVersion } from '../../data.js';
import { buildPlayerAssignments } from '../../playbook/roleResolution.js';
import { createPlayViewer } from '../../playbook/playViewer.js';
import { ROLE_CLASSIFICATIONS } from '../../constants/football.js';

const ROLE_LABELS = Object.fromEntries(ROLE_CLASSIFICATIONS.map((r) => [r.value, r.label]));
const DESIGNATION_LABELS = { primary: 'PRIMARY — Get the ball!', secondary: 'SECONDARY — Look here next', decoy: 'DECOY — Pull the defense away' };

// Player Mode's "My Plays": read-only, child-simple. Only ever calls read
// functions (listGames/getGame/getGamePlan/getWeeklyRoles/listPlays/
// getActiveVersion) — there is no write path anywhere in this file, which
// matches (and doesn't substitute for) firestore.rules already blocking
// any player write to games/gamePlan/weeklyRoles/plays.
export async function renderMyPlaysView(root, team, claims) {
  root.innerHTML = `<p class="hint">Loading your plays...</p>`;
  const games = await listGames(claims.teamId);

  if (games.length === 0) {
    root.innerHTML = `<div class="card"><p class="hint" style="margin:0;">No games set up yet — check back once your coach builds a Game Plan.</p></div>`;
    return;
  }

  let selectedGameId = games[0].id;
  await renderForGame(selectedGameId);

  async function renderForGame(gameId) {
    selectedGameId = gameId;
    root.innerHTML = `<p class="hint">Loading your assignments...</p>`;

    const [game, gamePlan, weeklyRoles, offensePlays, defensePlays] = await Promise.all([
      getGame(claims.teamId, gameId),
      getGamePlan(claims.teamId, gameId),
      getWeeklyRoles(claims.teamId, gameId),
      listPlays(claims.teamId, { side: 'offense' }),
      listPlays(claims.teamId, { side: 'defense' }),
    ]);

    const allPlays = [...offensePlays, ...defensePlays];
    const versions = await Promise.all(
      allPlays.map((p) => (p.activeVersionId ? getActiveVersion(claims.teamId, p.id, p.activeVersionId) : null))
    );
    const playsById = {};
    allPlays.forEach((p, i) => { playsById[p.id] = { play: p, version: versions[i] }; });

    const myAssignments = buildPlayerAssignments(gamePlan.entries, playsById, weeklyRoles, claims.playerId);

    renderShell(game, myAssignments);
  }

  function renderShell(game, myAssignments) {
    root.innerHTML = `
      ${games.length > 1 ? `
        <label class="field" style="margin-bottom: var(--space-2);">
          <span>Game</span>
          <select id="myp-game-select">
            ${games.map((g) => `<option value="${g.id}" ${g.id === selectedGameId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
          </select>
        </label>
      ` : ''}
      <div class="card card-gold" style="margin-bottom: var(--space-2);">
        <h2>${escapeHtml(game.name)}</h2>
        <p class="hint" style="margin-bottom:0;">${escapeHtml(formatDate(game.date))}${game.opponent ? ' vs. ' + escapeHtml(game.opponent) : ''}</p>
      </div>
      ${myAssignments.length === 0
        ? '<div class="card"><p class="hint" style="margin:0;">You\'re not in any plays for this game yet — check back once your coach finishes Weekly Roles.</p></div>'
        : myAssignments.map((a, i) => playCardHtml(a, i)).join('')}
    `;

    const select = root.querySelector('#myp-game-select');
    if (select) select.addEventListener('change', () => renderForGame(select.value));

    myAssignments.forEach((a, i) => wirePlayCard(a, i));
  }

  function playCardHtml(a, i) {
    const timing = a.assignment?.timing || a.design.routes?.[a.slot]?.timing;
    const designation = a.design.routes?.[a.slot]?.designation;
    return `
      <div class="card" style="margin-bottom: var(--space-2);">
        <div class="card-header-row">
          <h2 style="margin:0;">${escapeHtml(a.play.name)}</h2>
          <span class="code-display" style="font-size:16px;">${escapeHtml(a.play.wristbandCode || '--')}</span>
        </div>
        ${a.play.diagramUrl ? `<img src="${escapeAttr(a.play.diagramUrl)}" alt="Play diagram" style="max-width:100%; border-radius:8px; margin:8px 0;" />` : ''}
        <p style="font-size:20px; font-weight:800; color:var(--sx-gold); margin: var(--space-2) 0 4px 0;">You are: ${escapeHtml(a.slot)}</p>
        ${designation && DESIGNATION_LABELS[designation] ? `<p style="font-size:16px; font-weight:700; margin:0 0 8px 0;">${DESIGNATION_LABELS[designation]}</p>` : ''}
        ${timingText(timing) ? `<p class="hint" style="margin:0 0 8px 0;">${timingText(timing)}</p>` : ''}
        ${assignmentBlockHtml(a.assignment)}
        <div id="myp-viewer-${i}" style="margin-top:var(--space-2);"></div>
        <div class="row-wrap" style="margin-top:var(--space-2);">
          <button type="button" class="btn btn-primary btn-large" data-watch-play="${i}">&#9654; WATCH PLAY</button>
          <button type="button" class="btn btn-secondary btn-large" data-watch-job="${i}">&#9733; WATCH MY JOB</button>
        </div>
      </div>
    `;
  }

  function assignmentBlockHtml(assignment) {
    if (!assignment) return '';
    const rows = [
      ['WHAT', assignment.route],
      ['ROLE', ROLE_LABELS[assignment.roleClassification] || assignment.roleClassification],
      ['WHY', assignment.why],
      ['KEY', assignment.key],
    ].filter(([, v]) => v);
    if (rows.length === 0) return '';
    return `
      <div class="card" style="background:var(--sx-charcoal-2); margin:8px 0 0 0;">
        ${rows.map(([label, val]) => `
          <p style="margin:0 0 8px 0;"><span class="hint" style="display:block; margin:0;">${label}</span>${escapeHtml(val)}</p>
        `).join('')}
      </div>
    `;
  }

  function timingText(timing) {
    if (!timing) return '';
    if (timing.phase === 'presnap') return 'Starts moving BEFORE the snap.';
    if (timing.startDelaySeconds > 0) return `Waits ${timing.startDelaySeconds} sec after the snap, then runs.`;
    return '';
  }

  function wirePlayCard(a, i) {
    const mount = root.querySelector(`#myp-viewer-${i}`);
    let viewer = null;

    root.querySelector(`[data-watch-play="${i}"]`).addEventListener('click', () => {
      if (viewer) viewer.destroy();
      viewer = createPlayViewer(mount, { design: a.design });
    });
    root.querySelector(`[data-watch-job="${i}"]`).addEventListener('click', () => {
      if (viewer) viewer.destroy();
      viewer = createPlayViewer(mount, { design: a.design, highlightSlot: a.slot });
    });
  }
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str ?? '');
}
