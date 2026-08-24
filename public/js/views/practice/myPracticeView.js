import { listPractices, listGames, getWeeklyRoles, listPlays, getActiveVersion, getChecklist, setChecklistItem } from '../../data.js';
import { resolveAssignmentPlayerIds, CHECKLIST_ITEMS } from '../../practice/practiceLogic.js';
import { createPlayViewer } from '../../playbook/playViewer.js';
import { slotsForPlayer } from '../../playbook/roleResolution.js';

const CHECKLIST_LABELS = {
  reviewedMyPlays: 'Reviewed My Plays',
  watchedMyJob: 'Watched My Job',
  reviewedAssignments: 'Reviewed Assignments',
  practiceAssignmentComplete: 'Practice Assignment Complete',
};
// Only these two can be verified by an action the player actually takes
// in this view — the other two stay honest self-report, never faked.
const AUTO_VERIFIABLE = new Set(['watchedMyJob']);

/**
 * Player Mode's "My Practice" — shows ONLY what's relevant to THIS
 * player: no full-team agenda, no other players' assignments, no coach
 * evaluations (those never leave the coach-only evaluations collection —
 * this view never even fetches them).
 */
export async function renderMyPracticeView(root, team, claims) {
  root.innerHTML = `<p class="hint">Loading your practice...</p>`;
  const teamId = claims.teamId;
  const playerId = claims.playerId;

  const [practices, allGames, checklist] = await Promise.all([
    listPractices(teamId),
    listGames(teamId),
    getChecklist(teamId, playerId),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = practices.filter((p) => (p.date || '').slice(0, 10) >= today).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const practice = upcoming[0] || practices[0] || null;

  const latestGame = allGames[0] || null;
  const weeklyRoles = latestGame ? await getWeeklyRoles(teamId, latestGame.id) : { offense: {}, defense: {} };

  let myBlocks = [];
  let playsById = {};
  if (practice) {
    myBlocks = (practice.blocks || []).filter((b) => resolveAssignmentPlayerIds(b, [{ id: playerId }], weeklyRoles).includes(playerId) || b.assignmentType === 'team');
    const relevantPlayIds = [...new Set(myBlocks.flatMap((b) => b.playIds || []))];
    if (relevantPlayIds.length > 0) {
      const [offensePlays, defensePlays] = await Promise.all([listPlays(teamId, { side: 'offense' }), listPlays(teamId, { side: 'defense' })]);
      const allPlays = [...offensePlays, ...defensePlays].filter((p) => relevantPlayIds.includes(p.id));
      const versions = await Promise.all(allPlays.map((p) => (p.activeVersionId ? getActiveVersion(teamId, p.id, p.activeVersionId) : null)));
      allPlays.forEach((p, i) => { playsById[p.id] = { play: p, version: versions[i] }; });
    }
  }

  render();

  function render() {
    if (!practice) {
      root.innerHTML = `<div class="card"><h2>My Practice</h2><p class="hint" style="margin:8px 0 0 0;">No practices scheduled yet — check back once your coach builds one.</p></div>`;
      return;
    }

    const focusAreas = [...new Set(myBlocks.map((b) => b.focusArea).filter(Boolean))];
    root.innerHTML = `
      <div class="card card-gold" style="margin-bottom:var(--space-2);">
        <h2>Next Practice</h2>
        <p style="margin:0;">${escapeHtml(formatDate(practice.date))}${practice.title ? ` — ${escapeHtml(practice.title)}` : ''}</p>
      </div>

      ${focusAreas.length > 0 ? `
        <div class="card" style="margin-bottom:var(--space-2);">
          <h2>What We're Working On</h2>
          <div class="row-wrap">${focusAreas.map((f) => `<span class="chip">${escapeHtml(f)}</span>`).join('')}</div>
        </div>
      ` : ''}

      <div class="card" style="margin-bottom:var(--space-2);">
        <h2>Your Job</h2>
        ${myBlocks.length === 0 ? '<p class="hint" style="margin:0;">No specific assignment yet for this practice.</p>' : myBlocks.map((b) => `
          <p style="margin:0 0 8px 0;"><b>${escapeHtml(b.label)}</b>${b.focusArea ? ` — ${escapeHtml(b.focusArea)}` : ''}</p>
        `).join('')}
      </div>

      ${Object.keys(playsById).length > 0 ? `
        <div class="card" style="margin-bottom:var(--space-2);">
          <h2>Plays to Review</h2>
          ${Object.entries(playsById).map(([playId, { play }]) => playCardHtml(playId, play)).join('')}
        </div>
      ` : ''}

      <div class="card">
        <h2>Game Ready Checklist</h2>
        ${CHECKLIST_ITEMS.map((key) => `
          <label class="row" style="margin-bottom:8px;">
            <input type="checkbox" data-checklist-item="${key}" ${checklist?.[key]?.done ? 'checked' : ''} ${AUTO_VERIFIABLE.has(key) ? 'disabled' : ''} style="width:24px;height:24px;min-height:0;" />
            <span>${CHECKLIST_LABELS[key]}${AUTO_VERIFIABLE.has(key) ? ' <span class="hint">(auto-tracked)</span>' : ''}</span>
          </label>
        `).join('')}
      </div>
    `;

    root.querySelectorAll('[data-checklist-item]').forEach((box) => {
      box.addEventListener('change', async (e) => {
        await setChecklistItem(teamId, playerId, box.dataset.checklistItem, e.target.checked, 'player_marked');
        checklist[box.dataset.checklistItem] = { done: e.target.checked, source: 'player_marked' };
      });
    });

    Object.entries(playsById).forEach(([playId, { version }]) => wirePlayCard(playId, version));
  }

  function playCardHtml(playId, play) {
    return `
      <div style="margin-bottom:var(--space-2);">
        <p style="margin:0 0 6px 0; font-weight:800;">${escapeHtml(play.wristbandCode || '--')} &mdash; ${escapeHtml(play.name)}</p>
        <div id="mp-viewer-${playId}"></div>
        <div class="row-wrap" style="margin-top:8px;">
          <button type="button" class="btn btn-primary" data-watch-play="${playId}">&#9654; Watch Play</button>
          <button type="button" class="btn btn-secondary" data-watch-job="${playId}">&#9733; Watch My Job</button>
        </div>
      </div>
    `;
  }

  function wirePlayCard(playId, version) {
    const design = version?.fieldDesign || { positions: {}, routes: {} };
    const mount = root.querySelector(`#mp-viewer-${playId}`);
    let viewer = null;
    const playBtn = root.querySelector(`[data-watch-play="${playId}"]`);
    const jobBtn = root.querySelector(`[data-watch-job="${playId}"]`);
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (viewer) viewer.destroy();
        viewer = createPlayViewer(mount, { design });
      });
    }
    if (jobBtn) {
      jobBtn.addEventListener('click', async () => {
        if (viewer) viewer.destroy();
        const play = playsById[playId].play;
        const mySlots = slotsForPlayer(weeklyRoles, play.side, playerId).filter((s) => design.positions[s]);
        viewer = createPlayViewer(mount, { design, highlightSlot: mySlots[0] || null });
        // This is a REAL action the player just took, not a guess — safe
        // to auto-mark, per "SidelineX may automatically recognize
        // activities it can actually verify."
        await setChecklistItem(teamId, playerId, 'watchedMyJob', true, 'auto_verified');
        checklist.watchedMyJob = { done: true, source: 'auto_verified' };
        const box = root.querySelector('[data-checklist-item="watchedMyJob"]');
        if (box) box.checked = true;
      });
    }
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
