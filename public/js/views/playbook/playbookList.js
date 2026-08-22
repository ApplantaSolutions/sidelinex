import { listPlays } from '../../data.js';
import { renderPlayForm } from './playForm.js';

export async function renderPlaybookList(root, team, claims, side = 'offense') {
  root.innerHTML = `<p class="hint">Loading plays...</p>`;
  const plays = await listPlays(claims.teamId, { side });

  root.innerHTML = `
    <div class="row" style="margin-bottom: var(--space-2);">
      <button class="nav-tab ${side === 'offense' ? 'active' : ''}" data-side="offense">Offense</button>
      <button class="nav-tab ${side === 'defense' ? 'active' : ''}" data-side="defense">Defense</button>
      <button id="add-play-btn" class="btn btn-primary" style="margin-left:auto;">+ Add Play</button>
    </div>
    <div id="play-list">
      ${plays.length === 0 ? '<p class="hint">No plays yet. Add your first one above.</p>' : plays.map(playCardHtml).join('')}
    </div>
  `;

  root.querySelectorAll('[data-side]').forEach((btn) => {
    btn.addEventListener('click', () => renderPlaybookList(root, team, claims, btn.dataset.side));
  });

  root.querySelector('#add-play-btn').addEventListener('click', () => {
    renderPlayForm(root, team, claims, side, () => renderPlaybookList(root, team, claims, side));
  });

  root.querySelectorAll('.play-card').forEach((card) => {
    card.addEventListener('click', () => {
      renderPlayForm(root, team, claims, side, () => renderPlaybookList(root, team, claims, side), card.dataset.playId, plays.find(p => p.id === card.dataset.playId));
    });
  });
}

function playCardHtml(play) {
  const depth = play.tags?.yardageDepth ? play.tags.yardageDepth[0].toUpperCase() + play.tags.yardageDepth.slice(1) : '';
  const catLabel = (play.category || '').replace(/_/g, ' ');
  return `
    <div class="play-card" data-play-id="${play.id}">
      <div class="play-card-code">${escapeHtml(play.wristbandCode || '--')}</div>
      <div class="play-card-main">
        <div class="play-card-name">
          ${play.favorite ? '<span style="color:var(--sx-gold)">&#9733; </span>' : ''}${escapeHtml(play.name)}
        </div>
        <div class="play-card-meta">
          <span class="badge ${play.side === 'defense' ? 'badge-defense' : 'badge-offense'}">${play.side}</span>
          &nbsp;${escapeHtml(catLabel)}${depth ? ' · ' + depth : ''}${play.formation ? ' · ' + escapeHtml(play.formation) : ''}
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
