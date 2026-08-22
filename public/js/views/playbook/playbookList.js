import { listPlays } from '../../data.js';
import { renderPlayForm } from './playForm.js';

const QUICK_FILTERS = [
  { key: 'favorite', label: '&#9733; Favorites', test: (p) => !!p.favorite },
  { key: 'beatsMan', label: 'Beats Man', test: (p) => !!p.tags?.beatsMan },
  { key: 'beatsZone', label: 'Beats Zone', test: (p) => !!p.tags?.beatsZone },
  { key: 'beatsPressure', label: 'Beats Pressure', test: (p) => !!p.tags?.beatsPressure },
  { key: 'short', label: 'Short', test: (p) => p.tags?.yardageDepth === 'short' },
  { key: 'medium', label: 'Medium', test: (p) => p.tags?.yardageDepth === 'medium' },
  { key: 'deep', label: 'Deep', test: (p) => p.tags?.yardageDepth === 'deep' },
  { key: 'goalLine', label: 'Goal Line', test: (p) => !!p.tags?.goalLine },
  { key: 'conversion', label: 'Conversion', test: (p) => !!p.tags?.conversion },
  { key: 'explosive', label: 'Explosive', test: (p) => !!p.tags?.explosive },
  { key: 'safe', label: 'Safe Call', test: (p) => !!p.tags?.safe },
];

export async function renderPlaybookList(root, team, claims, side = 'offense') {
  const uiState = { search: '', activeFilters: new Set(), showArchived: false };
  root.innerHTML = `<p class="hint">Loading plays...</p>`;
  let allPlays = await listPlays(claims.teamId, { side, includeArchived: true });

  renderShell();

  function renderShell() {
    root.innerHTML = `
      <div class="row" style="margin-bottom: var(--space-2);">
        <button class="nav-tab ${side === 'offense' ? 'active' : ''}" data-side="offense">Offense</button>
        <button class="nav-tab ${side === 'defense' ? 'active' : ''}" data-side="defense">Defense</button>
        <button id="add-play-btn" class="btn btn-primary" style="margin-left:auto;">+ Add Play</button>
      </div>

      <label class="field" style="margin-bottom: var(--space-2);">
        <span>Search</span>
        <input type="text" id="play-search" placeholder="Play name or wristband code" autocomplete="off" />
      </label>

      <div class="row-wrap" id="filter-chips" style="margin-bottom: var(--space-2);">
        ${QUICK_FILTERS.map((f) => `<button type="button" class="chip" data-filter="${f.key}">${f.label}</button>`).join('')}
      </div>

      <label class="row" style="margin-bottom: var(--space-2);">
        <input type="checkbox" id="show-archived" style="width:22px;height:22px;min-height:0;" />
        <span class="hint" style="margin:0;">Show archived plays</span>
      </label>

      <div id="play-list"></div>
    `;

    root.querySelectorAll('[data-side]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        side = btn.dataset.side;
        allPlays = await listPlays(claims.teamId, { side, includeArchived: true });
        renderShell();
      });
    });

    root.querySelector('#add-play-btn').addEventListener('click', () => {
      renderPlayForm(root, team, claims, side, () => renderPlaybookList(root, team, claims, side));
    });

    root.querySelector('#play-search').addEventListener('input', (e) => {
      uiState.search = e.target.value.trim().toLowerCase();
      renderList();
    });

    root.querySelectorAll('#filter-chips .chip').forEach((chipEl) => {
      chipEl.addEventListener('click', () => {
        const key = chipEl.dataset.filter;
        if (uiState.activeFilters.has(key)) {
          uiState.activeFilters.delete(key);
          chipEl.classList.remove('selected');
        } else {
          uiState.activeFilters.add(key);
          chipEl.classList.add('selected');
        }
        renderList();
      });
    });

    root.querySelector('#show-archived').addEventListener('change', (e) => {
      uiState.showArchived = e.target.checked;
      renderList();
    });

    renderList();
  }

  function renderList() {
    const listEl = root.querySelector('#play-list');
    let plays = allPlays;

    if (!uiState.showArchived) plays = plays.filter((p) => p.active !== false);

    if (uiState.search) {
      plays = plays.filter(
        (p) =>
          p.name.toLowerCase().includes(uiState.search) ||
          (p.wristbandCode || '').toLowerCase().includes(uiState.search)
      );
    }

    QUICK_FILTERS.forEach((f) => {
      if (uiState.activeFilters.has(f.key)) plays = plays.filter(f.test);
    });

    listEl.innerHTML =
      plays.length === 0
        ? '<p class="hint">No plays match. Try clearing a filter, or add your first play above.</p>'
        : plays.map(playCardHtml).join('');

    listEl.querySelectorAll('.play-card').forEach((card) => {
      card.addEventListener('click', () => {
        const play = plays.find((p) => p.id === card.dataset.playId);
        renderPlayForm(root, team, claims, side, () => renderPlaybookList(root, team, claims, side), play.id, play);
      });
    });
  }

  function playCardHtml(play) {
    const depth = play.tags?.yardageDepth ? play.tags.yardageDepth[0].toUpperCase() + play.tags.yardageDepth.slice(1) : '';
    const catLabel = (play.category || '').replace(/_/g, ' ');
    const archivedNote = play.active === false ? ' <span class="hint" style="margin:0;">(Archived)</span>' : '';
    return `
      <div class="play-card" data-play-id="${play.id}" style="${play.active === false ? 'opacity:0.55;' : ''}">
        <div class="play-card-code">${escapeHtml(play.wristbandCode || '--')}</div>
        <div class="play-card-main">
          <div class="play-card-name">
            ${play.favorite ? '<span style="color:var(--sx-gold)">&#9733; </span>' : ''}${escapeHtml(play.name)}${archivedNote}
          </div>
          <div class="play-card-meta">
            <span class="badge ${play.side === 'defense' ? 'badge-defense' : 'badge-offense'}">${play.side}</span>
            &nbsp;${escapeHtml(catLabel)}${depth ? ' · ' + depth : ''}${play.formation ? ' · ' + escapeHtml(play.formation) : ''}
          </div>
        </div>
      </div>
    `;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
