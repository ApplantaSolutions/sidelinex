import { listGames, createGame, getGame } from '../../data.js';
import { renderGameDetail } from './gameDetail.js';
import { renderSeasonSelfScoutView } from './seasonSelfScoutView.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

export async function renderGamesList(root, team, claims) {
  root.innerHTML = `<p class="hint">Loading games...</p>`;
  const games = await listGames(claims.teamId);
  render();

  function render() {
    root.innerHTML = `
      <div class="card">
        <div class="card-header-row">
          <h2>Games (${games.length})</h2>
          <div class="row" style="gap:8px;">
            ${helpButtonHtml('games')}
            <button id="new-game-btn" class="btn btn-primary">+ New Game</button>
          </div>
        </div>
        <ul class="roster-list" id="games-list">
          ${games.map((g) => `
            <li class="play-card" data-game-id="${g.id}" style="cursor:pointer;">
              <div class="play-card-main">
                <div class="play-card-name">${escapeHtml(g.name)}${g.ended ? ' <span class="hint">(Final)</span>' : ''}</div>
                <div class="play-card-meta">${escapeHtml(formatDate(g.date))}${g.opponent ? ' vs. ' + escapeHtml(g.opponent) : ''}</div>
              </div>
            </li>
          `).join('') || '<li class="hint">No games yet — tap "+ New Game" to plan your first one.</li>'}
        </ul>
      </div>
      <button type="button" class="btn btn-secondary" id="season-self-scout-btn" style="width:100%; margin-top:var(--space-2);">&#128200; Season Self-Scout</button>
      <div id="new-game-panel" hidden></div>
    `;

    wireCoachHelpButtons(root);

    root.querySelectorAll('[data-game-id]').forEach((li) => {
      li.addEventListener('click', async () => {
        const game = await getGame(claims.teamId, li.dataset.gameId);
        if (!game) return;
        renderGameDetail(root, team, claims, game, () => renderGamesList(root, team, claims));
      });
    });

    root.querySelector('#new-game-btn').addEventListener('click', () => renderNewGameForm());
    root.querySelector('#season-self-scout-btn').addEventListener('click', () => renderSeasonSelfScoutView(root, team, claims, () => renderGamesList(root, team, claims)));
  }

  function renderNewGameForm() {
    const panel = root.querySelector('#new-game-panel');
    panel.hidden = false;
    panel.innerHTML = `
      <div class="card">
        <h2>New Game</h2>
        <form id="new-game-form" class="stack">
          <label class="field">
            <span>Game Name</span>
            <input type="text" name="name" required autocomplete="off" placeholder="e.g. Week 4 Home" />
          </label>
          <label class="field">
            <span>Date</span>
            <input type="date" name="date" required />
          </label>
          <label class="field">
            <span>Opponent (optional)</span>
            <input type="text" name="opponent" autocomplete="off" />
          </label>
          <button type="submit" class="btn btn-primary btn-large">Create Game</button>
        </form>
      </div>
    `;
    panel.querySelector('#new-game-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const dateVal = formData.get('date');
      const { id } = await createGame(claims.teamId, {
        name: formData.get('name'),
        date: dateVal ? new Date(dateVal).toISOString() : null,
        opponent: formData.get('opponent') || null,
      });
      const game = await getGame(claims.teamId, id);
      renderGameDetail(root, team, claims, game, () => renderGamesList(root, team, claims));
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
