import { listPlays, getActiveVersion } from '../../data.js';
import { createPlayViewer } from '../../playbook/playViewer.js';

// Read-only Playbook for players — same play data the coach built (Firestore
// rules already allow any team member to read /plays), but no create/edit/
// archive controls, and tapping a play opens Watch Play directly instead of
// the edit form.
export async function renderPlaybookPlayerView(root, team, claims, side = 'offense') {
  let viewer = null;
  root.innerHTML = `<p class="hint">Loading plays...</p>`;
  let plays = await listPlays(claims.teamId, { side });

  renderList();

  function renderList() {
    teardownViewer();
    root.innerHTML = `
      <div class="row" style="margin-bottom: var(--space-2); flex-wrap: wrap;">
        <button class="nav-tab ${side === 'offense' ? 'active' : ''}" data-side="offense">Offense</button>
        <button class="nav-tab ${side === 'defense' ? 'active' : ''}" data-side="defense">Defense</button>
      </div>
      <div id="pb-list"></div>
    `;

    root.querySelectorAll('[data-side]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        side = btn.dataset.side;
        plays = await listPlays(claims.teamId, { side });
        renderList();
      });
    });

    const listEl = root.querySelector('#pb-list');
    listEl.innerHTML =
      plays.length === 0
        ? '<p class="hint">No plays here yet — check back once your coach adds some.</p>'
        : plays.map(playCardHtml).join('');

    listEl.querySelectorAll('.play-card').forEach((card) => {
      card.addEventListener('click', () => {
        const play = plays.find((p) => p.id === card.dataset.playId);
        renderWatch(play);
      });
    });
  }

  async function renderWatch(play) {
    teardownViewer();
    root.innerHTML = `
      <button id="pb-back" class="btn btn-link" style="padding-left:0;">&larr; Back to Playbook</button>
      <h1 style="font-size:22px; margin: 4px 0 12px 0;">${escapeHtml(play.name)}</h1>
      <p class="hint" style="margin-bottom:var(--space-2);">${escapeHtml(play.wristbandCode || '')}${play.formation ? ' &middot; ' + escapeHtml(play.formation) : ''}</p>
      <div id="pb-viewer-mount"></div>
    `;
    root.querySelector('#pb-back').addEventListener('click', renderList);

    const version = play.activeVersionId
      ? await getActiveVersion(claims.teamId, play.id, play.activeVersionId)
      : null;
    const design = version?.fieldDesign || { positions: {}, routes: {} };
    viewer = createPlayViewer(root.querySelector('#pb-viewer-mount'), { design });
  }

  function teardownViewer() {
    if (viewer) {
      viewer.destroy();
      viewer = null;
    }
  }

  function playCardHtml(play) {
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
            &nbsp;${escapeHtml(catLabel)}
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
