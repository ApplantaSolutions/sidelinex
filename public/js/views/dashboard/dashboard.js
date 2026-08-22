import { getTeam, getSeason, getRuleConfig, listActivePlayers, getPlayer } from '../../data.js';
import { addPlayer, signOut } from '../../auth.js';
import { isDevMode } from '../../data.js';
import { renderPlaybookList } from '../playbook/playbookList.js';

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'roster', label: 'Roster' },
  { id: 'playbook', label: 'Playbook' },
];

export async function renderDashboardView(root, claims, onSignOut) {
  root.innerHTML = `<section class="screen"><p class="hint">Loading...</p></section>`;

  const team = await getTeam(claims.teamId);
  if (!team) {
    root.innerHTML = `<section class="screen"><p class="error">Team not found.</p></section>`;
    return;
  }

  if (claims.role === 'coach') {
    return renderCoachShell(root, team, claims, onSignOut);
  }
  return renderPlayerDashboard(root, team, claims, onSignOut);
}

async function renderCoachShell(root, team, claims, onSignOut, activeTab = 'home') {
  root.innerHTML = `
    <header class="app-header">
      <div class="sx-mark">SX</div>
      <div class="sx-wordmark">Sideline<span class="x">X</span></div>
      ${isDevMode ? '<span class="chip" style="margin-left:auto;">DEV PREVIEW</span>' : ''}
    </header>
    <section class="screen">
      <div class="dash-header">
        <div>
          <h1>${escapeHtml(team.name)}</h1>
          <p class="hint" style="margin-bottom:0;">${team.format}</p>
        </div>
        <button id="sign-out" class="btn btn-link">Sign Out</button>
      </div>
      <nav class="nav-tabs" id="nav-tabs">
        ${TABS.map((t) => `<button class="nav-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </nav>
      <div id="tab-content"></div>
    </section>
  `;

  root.querySelector('#sign-out').addEventListener('click', async () => {
    if (!isDevMode) await signOut();
    onSignOut();
  });

  root.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderCoachShell(root, team, claims, onSignOut, btn.dataset.tab);
    });
  });

  const tabContent = root.querySelector('#tab-content');
  if (activeTab === 'home') return renderHomeTab(tabContent, team, claims);
  if (activeTab === 'roster') return renderRosterTab(tabContent, team, claims);
  if (activeTab === 'playbook') return renderPlaybookList(tabContent, team, claims);
}

async function renderHomeTab(root, team, claims) {
  const [season, ruleConfig] = await Promise.all([
    getSeason(claims.teamId, team.activeSeasonId),
    getRuleConfig(claims.teamId),
  ]);

  root.innerHTML = `
    <div class="card card-gold">
      <h2>Team Code</h2>
      <p class="code-display">${escapeHtml(team.teamCode)}</p>
      <p class="hint" style="margin-bottom:0;">Share this with players and assistant coaches so they can log in.</p>
    </div>

    <div class="card">
      <h2>Season</h2>
      <p style="margin:0;">${escapeHtml(season?.label || '')}</p>
    </div>

    <div class="card">
      <h2>League Rules (Provisional)</h2>
      <p style="margin:0;">${ruleConfig?.downsToMidfield ?? '?'} downs to midfield, then ${ruleConfig?.downsAfterMidfieldToScore ?? '?'} more to score.</p>
      ${ruleConfig?.provisional ? '<p class="hint" style="margin:8px 0 0 0;">Default values — update once the official rulebook is uploaded.</p>' : ''}
    </div>
  `;
}

async function renderRosterTab(root, team, claims) {
  const players = await listActivePlayers(claims.teamId);
  root.innerHTML = `
    <div class="card">
      <div class="card-header-row">
        <h2>Roster (${players.length})</h2>
        <button id="add-player-btn" class="btn btn-primary">+ Add Player</button>
      </div>
      <ul class="roster-list" id="roster-list">
        ${players.map((p) => `<li>#${p.jerseyNumber ?? '--'} ${escapeHtml(p.firstName)} ${escapeHtml(p.lastInitial || '')}</li>`).join('') || '<li class="hint">No players yet.</li>'}
      </ul>
    </div>
    <div id="add-player-panel" hidden></div>
  `;

  root.querySelector('#add-player-btn').addEventListener('click', () => {
    renderAddPlayerForm(root.querySelector('#add-player-panel'), async () => {
      await renderRosterTab(root, team, claims);
    });
  });
}

function renderAddPlayerForm(panel, onAdded) {
  panel.hidden = false;
  panel.innerHTML = `
    <div class="card">
      <h2>Add Player</h2>
      <form id="add-player-form" class="stack">
        <label class="field">
          <span>First Name</span>
          <input type="text" name="firstName" required autocomplete="off" />
        </label>
        <label class="field">
          <span>Last Initial</span>
          <input type="text" name="lastInitial" maxlength="1" autocomplete="off" />
        </label>
        <label class="field">
          <span>Jersey Number</span>
          <input type="number" name="jerseyNumber" min="0" max="99" />
        </label>
        <button type="submit" class="btn btn-primary btn-large">Add Player</button>
      </form>
      <div id="new-player-result" hidden></div>
    </div>
  `;

  const form = panel.querySelector('#add-player-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding...';

    const { accessCode } = await addPlayer({
      firstName: formData.get('firstName'),
      lastInitial: formData.get('lastInitial'),
      jerseyNumber: formData.get('jerseyNumber') || null,
    });

    const resultEl = panel.querySelector('#new-player-result');
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <p class="success">Player added. Their access code is:</p>
      <p class="code-display">${escapeHtml(accessCode)}</p>
      <p class="hint">Write this down now — it cannot be shown again.</p>
    `;
    form.reset();
    submitBtn.disabled = false;
    submitBtn.textContent = 'Add Player';
    await onAdded();
    panel.hidden = false;
    panel.appendChild(resultEl);
  });
}

async function renderPlayerDashboard(root, team, claims, onSignOut) {
  const player = await getPlayer(claims.teamId, claims.playerId);
  root.innerHTML = `
    <header class="app-header">
      <div class="sx-mark">SX</div>
      <div class="sx-wordmark">Sideline<span class="x">X</span></div>
    </header>
    <section class="screen">
      <div class="dash-header">
        <div>
          <h1>${escapeHtml(team.name)}</h1>
          <p class="hint" style="margin-bottom:0;">Hi, ${escapeHtml(player?.firstName || '')}!</p>
        </div>
        <button id="sign-out" class="btn btn-link">Sign Out</button>
      </div>
      <div class="card">
        <p style="margin:0;">You're logged in. My Plays and My Assignments will show up here once the coach builds the playbook.</p>
      </div>
    </section>
  `;
  root.querySelector('#sign-out').addEventListener('click', async () => {
    await signOut();
    onSignOut();
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
