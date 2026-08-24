import { listPlays, getGamePlan, setGamePlan } from '../../data.js';
import { categoriesForSide } from '../../constants/football.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

// Game Plan Builder: selects Play references (never copies) from the
// master Playbook into an ordered, per-game list. Reorder/isCore/order
// all live only in the Game Plan entry — the Play/PlayVersion documents
// themselves are never touched, so editing a play in the Playbook is
// instantly reflected here (this view always reads the CURRENT play,
// never a snapshot).
export async function renderGamePlanBuilderView(root, team, claims, gameId) {
  let side = 'offense';
  let search = '';
  let categoryFilter = '';
  let showPicker = false;

  root.innerHTML = `<p class="hint">Loading plays...</p>`;
  const [allOffense, allDefense, gamePlan] = await Promise.all([
    listPlays(claims.teamId, { side: 'offense' }),
    listPlays(claims.teamId, { side: 'defense' }),
    getGamePlan(claims.teamId, gameId),
  ]);
  const playsById = {};
  [...allOffense, ...allDefense].forEach((p) => { playsById[p.id] = p; });

  let entries = gamePlan.entries.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  render();

  async function persist() {
    await setGamePlan(claims.teamId, gameId, entries);
  }

  function render() {
    root.innerHTML = `
      <div class="card">
        <div class="card-header-row">
          <h2>This Week's Game Plan (${entries.length})</h2>
          <div class="row" style="gap:8px;">
            ${helpButtonHtml('gamePlan')}
            <button type="button" id="gp-add-toggle" class="btn btn-primary">${showPicker ? 'Close' : '+ Add Plays'}</button>
          </div>
        </div>
        ${entries.length === 0 ? '<p class="hint">No plays added yet — tap "+ Add Plays" to build this week\'s plan.</p>' : selectedListHtml()}
      </div>
      ${showPicker ? pickerHtml() : ''}
    `;
    wireCoachHelpButtons(root);

    root.querySelector('#gp-add-toggle').addEventListener('click', () => {
      showPicker = !showPicker;
      render();
    });

    wireSelectedListEvents();
    if (showPicker) wirePickerEvents();
  }

  function selectedListHtml() {
    return `
      <ul class="roster-list" id="gp-entries">
        ${entries.map((e, i) => {
          const play = playsById[e.playId];
          if (!play) return '';
          return `
            <li class="row" style="justify-content:space-between; align-items:center;">
              <span style="flex:1; min-width:0;">
                <span class="code-display" style="font-size:15px; margin-right:8px;">${escapeHtml(play.wristbandCode || '--')}</span>
                ${e.isCore ? '<span style="color:var(--sx-gold);">&#9733; </span>' : ''}${escapeHtml(play.name)}
                <span class="badge ${play.side === 'defense' ? 'badge-defense' : 'badge-offense'}" style="margin-left:6px;">${play.side}</span>
              </span>
              <span class="row" style="gap:4px;">
                <button type="button" class="btn btn-link" data-move-up="${i}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
                <button type="button" class="btn btn-link" data-move-down="${i}" ${i === entries.length - 1 ? 'disabled' : ''}>&darr;</button>
                <button type="button" class="btn btn-link" data-toggle-core="${e.playId}">${e.isCore ? 'Unmark Core' : 'Mark Core'}</button>
                <button type="button" class="btn btn-link" data-remove-entry="${e.playId}">Remove</button>
              </span>
            </li>
          `;
        }).join('')}
      </ul>
    `;
  }

  function pickerHtml() {
    const categories = categoriesForSide(side);
    const already = new Set(entries.map((e) => e.playId));
    const pool = (side === 'defense' ? allDefense : allOffense).filter((p) => {
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !(p.wristbandCode || '').toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    return `
      <div class="card">
        <h2>Add From Playbook</h2>
        <div class="row" style="margin-bottom: var(--space-2);">
          <button class="nav-tab ${side === 'offense' ? 'active' : ''}" data-picker-side="offense">Offense</button>
          <button class="nav-tab ${side === 'defense' ? 'active' : ''}" data-picker-side="defense">Defense</button>
        </div>
        <input type="text" id="gp-search" placeholder="Search name or wristband code" value="${escapeAttr(search)}" autocomplete="off" style="margin-bottom: var(--space-2);" />
        <div class="row-wrap" style="margin-bottom: var(--space-2);">
          <button type="button" class="chip ${categoryFilter === '' ? 'selected' : ''}" data-category-filter="">All</button>
          ${categories.map((c) => `<button type="button" class="chip ${categoryFilter === c.value ? 'selected' : ''}" data-category-filter="${c.value}">${c.label}</button>`).join('')}
        </div>
        <ul class="roster-list">
          ${pool.map((p) => `
            <li class="row" style="justify-content:space-between;">
              <span><span class="code-display" style="font-size:14px; margin-right:8px;">${escapeHtml(p.wristbandCode || '--')}</span>${escapeHtml(p.name)}</span>
              <button type="button" class="btn ${already.has(p.id) ? 'btn-secondary' : 'btn-primary'}" data-toggle-play="${p.id}">${already.has(p.id) ? 'Added' : '+ Add'}</button>
            </li>
          `).join('') || '<li class="hint">No plays match.</li>'}
        </ul>
      </div>
    `;
  }

  function wireSelectedListEvents() {
    root.querySelectorAll('[data-move-up]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const i = Number(btn.dataset.moveUp);
        swapOrder(i, i - 1);
        await persist();
        render();
      });
    });
    root.querySelectorAll('[data-move-down]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const i = Number(btn.dataset.moveDown);
        swapOrder(i, i + 1);
        await persist();
        render();
      });
    });
    root.querySelectorAll('[data-toggle-core]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const entry = entries.find((e) => e.playId === btn.dataset.toggleCore);
        if (entry) entry.isCore = !entry.isCore;
        await persist();
        render();
      });
    });
    root.querySelectorAll('[data-remove-entry]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        entries = entries.filter((e) => e.playId !== btn.dataset.removeEntry);
        renumber();
        await persist();
        render();
      });
    });
  }

  function wirePickerEvents() {
    root.querySelectorAll('[data-picker-side]').forEach((btn) => {
      btn.addEventListener('click', () => { side = btn.dataset.pickerSide; render(); });
    });
    root.querySelector('#gp-search').addEventListener('input', (e) => {
      search = e.target.value;
      render();
      root.querySelector('#gp-search').focus();
      root.querySelector('#gp-search').selectionStart = root.querySelector('#gp-search').value.length;
    });
    root.querySelectorAll('[data-category-filter]').forEach((btn) => {
      btn.addEventListener('click', () => { categoryFilter = btn.dataset.categoryFilter; render(); });
    });
    root.querySelectorAll('[data-toggle-play]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const playId = btn.dataset.togglePlay;
        if (entries.some((e) => e.playId === playId)) {
          entries = entries.filter((e) => e.playId !== playId);
        } else {
          entries.push({ playId, order: entries.length, isCore: false });
        }
        renumber();
        await persist();
        render();
      });
    });
  }

  function swapOrder(i, j) {
    if (j < 0 || j >= entries.length) return;
    [entries[i], entries[j]] = [entries[j], entries[i]];
    renumber();
  }

  function renumber() {
    entries.forEach((e, i) => { e.order = i; });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str ?? '');
}
