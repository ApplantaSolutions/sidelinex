import { listPractices, createPractice, getPractice } from '../../data.js';
import { renderPracticeDetailView } from './practiceDetailView.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

export async function renderPracticeListView(root, team, claims) {
  root.innerHTML = `<p class="hint">Loading practices...</p>`;
  const practices = await listPractices(claims.teamId);
  render();

  function render() {
    root.innerHTML = `
      <div class="card">
        <div class="card-header-row">
          <h2>Practices (${practices.length})</h2>
          <div class="row" style="gap:8px;">
            ${helpButtonHtml('practice')}
            <button id="new-practice-btn" class="btn btn-primary">+ New Practice</button>
          </div>
        </div>
        <ul class="roster-list" id="practice-list">
          ${practices.map((p) => `
            <li class="play-card" data-practice-id="${p.id}" style="cursor:pointer;">
              <div class="play-card-main">
                <div class="play-card-name">${escapeHtml(p.title || 'Practice')}</div>
                <div class="play-card-meta">${escapeHtml(formatDate(p.date))} &middot; ${p.durationMinutes || 0} min &middot; ${(p.blocks || []).length} block${(p.blocks || []).length === 1 ? '' : 's'}</div>
              </div>
            </li>
          `).join('') || '<li class="hint">No practices yet — tap "+ New Practice" to build your first one.</li>'}
        </ul>
      </div>
      <div id="new-practice-panel" hidden></div>
    `;
    wireCoachHelpButtons(root);

    root.querySelectorAll('[data-practice-id]').forEach((li) => {
      li.addEventListener('click', async () => {
        const practice = await getPractice(claims.teamId, li.dataset.practiceId);
        if (!practice) return;
        renderPracticeDetailView(root, team, claims, practice, () => renderPracticeListView(root, team, claims));
      });
    });

    root.querySelector('#new-practice-btn').addEventListener('click', () => renderNewPracticeForm());
  }

  function renderNewPracticeForm() {
    const panel = root.querySelector('#new-practice-panel');
    panel.hidden = false;
    panel.innerHTML = `
      <div class="card">
        <h2>New Practice</h2>
        <form id="new-practice-form" class="stack">
          <label class="field">
            <span>Date</span>
            <input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}" />
          </label>
          <label class="field">
            <span>Title (optional)</span>
            <input type="text" name="title" autocomplete="off" placeholder="e.g. Saturday Practice" />
          </label>
          <label class="field">
            <span>Duration (minutes)</span>
            <input type="number" name="durationMinutes" min="10" value="90" required />
          </label>
          <button type="submit" class="btn btn-primary btn-large">Create Practice</button>
        </form>
      </div>
    `;
    panel.querySelector('#new-practice-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const dateVal = formData.get('date');
      const { id } = await createPractice(claims.teamId, {
        date: dateVal ? new Date(dateVal).toISOString() : null,
        title: formData.get('title') || null,
        durationMinutes: Number(formData.get('durationMinutes')) || 90,
      });
      const practice = await getPractice(claims.teamId, id);
      renderPracticeDetailView(root, team, claims, practice, () => renderPracticeListView(root, team, claims));
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
