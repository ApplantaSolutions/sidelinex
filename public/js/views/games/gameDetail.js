import { renderWeeklyRolesView } from './weeklyRolesView.js';
import { renderGamePlanBuilderView } from './gamePlanBuilderView.js';
import { renderWristbandBuilderView } from './wristbandBuilderView.js';
import { renderGameDayView } from './gameDayView.js';
import { renderScoutTabView } from '../scouting/scoutTabView.js';
import { renderPostgameReportView } from './postgameReportView.js';

const SUB_TABS = [
  { id: 'roles', label: 'Weekly Roles' },
  { id: 'plan', label: 'Game Plan' },
  { id: 'scout', label: '🔍 Scout' },
  { id: 'wristbands', label: 'Wristbands' },
  { id: 'gameday', label: '▶ Game Day' },
  { id: 'postgame', label: '📊 Postgame' },
];

export async function renderGameDetail(root, team, claims, game, onBack, activeSubTab = 'roles') {
  root.innerHTML = `
    <button id="gd-back" class="btn btn-link" style="padding-left:0;">&larr; Back to Games</button>
    <h1 style="font-size:22px; margin: 4px 0 2px 0;">${escapeHtml(game.name)}</h1>
    <p class="hint" style="margin-bottom:var(--space-2);">${escapeHtml(formatDate(game.date))}${game.opponent ? ' vs. ' + escapeHtml(game.opponent) : ''}</p>
    <div class="nav-tabs" style="margin-bottom: var(--space-2);">
      ${SUB_TABS.map((t) => `<button class="nav-tab ${t.id === activeSubTab ? 'active' : ''}" data-subtab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div id="gd-content"></div>
  `;

  root.querySelector('#gd-back').addEventListener('click', onBack);
  root.querySelectorAll('[data-subtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderGameDetail(root, team, claims, game, onBack, btn.dataset.subtab);
    });
  });

  const content = root.querySelector('#gd-content');
  if (activeSubTab === 'plan') return renderGamePlanBuilderView(content, team, claims, game.id);
  if (activeSubTab === 'scout') return renderScoutTabView(content, team, claims, game.id);
  if (activeSubTab === 'wristbands') return renderWristbandBuilderView(content, team, claims, game.id);
  if (activeSubTab === 'gameday') return renderGameDayView(content, team, claims, game.id);
  if (activeSubTab === 'postgame') return renderPostgameReportView(content, team, claims, game.id);
  return renderWeeklyRolesView(content, team, claims, game.id);
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
