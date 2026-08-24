import {
  updatePractice, listActivePlayers, listGames, getWeeklyRoles, listPlays, getActiveVersion,
  listPracticeIdeas, markPracticeIdeaScheduled, listCustomFocusAreas, addCustomFocusArea, addEvaluation,
} from '../../data.js';
import { deriveUsedSlots } from '../../playbook/roleResolution.js';
import { BUILT_IN_FOCUS_AREAS } from '../../practice/focusAreaTaxonomy.js';
import { sumBlockDuration, deriveDurationSummary, reorderBlocks, resolveAssignmentPlayerIds } from '../../practice/practiceLogic.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

const ATTENDANCE_STATES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const EXECUTION_LEVELS = [['needs_work', 'Needs Work'], ['developing', 'Developing'], ['solid', 'Solid'], ['strong', 'Strong']];
const EFFORT_LEVELS = [['needs_work', 'Needs Work'], ['solid', 'Solid'], ['strong', 'Strong']];
const UNDERSTANDING_LEVELS = [['needs_help', 'Needs Help'], ['getting_it', 'Getting It'], ['ready', 'Ready']];

export async function renderPracticeDetailView(root, team, claims, practice, onBack) {
  root.innerHTML = `<p class="hint">Loading practice...</p>`;
  const teamId = claims.teamId;

  const [players, allGames, offensePlays, defensePlays, practiceIdeas, customFocusAreas] = await Promise.all([
    listActivePlayers(teamId),
    listGames(teamId),
    listPlays(teamId, { side: 'offense' }),
    listPlays(teamId, { side: 'defense' }),
    listPracticeIdeas(teamId),
    listCustomFocusAreas(teamId),
  ]);
  const allPlays = [...offensePlays, ...defensePlays];
  const versions = await Promise.all(allPlays.map((p) => (p.activeVersionId ? getActiveVersion(teamId, p.id, p.activeVersionId) : null)));
  const playsById = {};
  allPlays.forEach((p, i) => { playsById[p.id] = { play: p, version: versions[i] }; });

  // Weekly Roles resolution context: the most recent game's Weekly Roles
  // — a deliberate, documented interpretation, since a Practice isn't
  // tied to one specific game. Roles usually stay stable week to week;
  // this is what lets "role" assignments (WR1, QB, etc.) resolve to a
  // real player without asking the coach to re-pick them by name.
  const latestGame = allGames[0] || null;
  const weeklyRoles = latestGame ? await getWeeklyRoles(teamId, latestGame.id) : { offense: {}, defense: {} };
  const usedSlots = deriveUsedSlots(allPlays.map((p, i) => ({ side: p.side, slots: Object.keys(versions[i]?.fieldDesign?.positions || {}) })));
  const allRoles = [...usedSlots.offense, ...usedSlots.defense];

  const working = { ...practice };
  let screen = 'main'; // 'main' | 'block_edit' | 'attendance' | 'evaluate'
  let blockDraft = null;
  let evalTarget = null;

  render();

  async function save(fields) {
    Object.assign(working, fields);
    await updatePractice(teamId, working.id, fields);
  }

  function render() {
    if (screen === 'block_edit') return renderBlockEdit();
    if (screen === 'attendance') return renderAttendance();
    if (screen === 'evaluate') return renderEvaluate();
    renderMain();
  }

  // ---------- MAIN ----------

  function renderMain() {
    const blocks = (working.blocks || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const durationSummary = deriveDurationSummary(blocks, working.durationMinutes);
    const unscheduledIdeas = practiceIdeas.filter((i) => !i.scheduledInPracticeId);
    const attendanceCount = Object.keys(working.attendance || {}).length;

    root.innerHTML = `
      <button type="button" class="btn btn-link" id="pr-back" style="padding-left:0;">&larr; Back to Practices</button>
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h1 style="font-size:20px; margin:0;">${escapeHtml(working.title || 'Practice')}</h1>
        ${helpButtonHtml('practice')}
      </div>
      <p class="hint" style="margin:0 0 var(--space-2) 0;">${escapeHtml(formatDate(working.date))}</p>

      <div class="card card-gold" style="margin-bottom:var(--space-2);">
        <div class="row" style="justify-content:space-between;">
          <p style="margin:0;">Scheduled: <b>${durationSummary.scheduled} min</b> of <b>${durationSummary.planned} min</b> planned</p>
          <p style="margin:0; color:${durationSummary.remaining < 0 ? 'var(--sx-error)' : 'inherit'};">${durationSummary.remaining >= 0 ? `${durationSummary.remaining} min free` : `${Math.abs(durationSummary.remaining)} min over`}</p>
        </div>
      </div>

      ${unscheduledIdeas.length > 0 ? `
        <div class="card" style="margin-bottom:var(--space-2);">
          <h2>Practice Ideas</h2>
          <p class="hint" style="margin:0 0 8px 0;">From Postgame Analytics and coach notes — not yet scheduled.</p>
          ${unscheduledIdeas.map((i) => `
            <div class="row" style="justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--sx-gold-border);">
              <p style="margin:0;">${escapeHtml(i.text)} <span class="hint">(${i.source === 'postgame' ? 'Postgame' : 'Coach Added'})</span></p>
              <button type="button" class="btn btn-secondary" data-add-idea-block="${i.id}">+ Add to Practice</button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="card" style="margin-bottom:var(--space-2);">
        <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h2 style="margin:0;">Agenda</h2>
          <button type="button" class="btn btn-secondary" id="pr-add-block">+ Add Block</button>
        </div>
        ${blocks.length === 0 ? '<p class="hint" style="margin:0;">No blocks yet.</p>' : blocks.map((b, i) => blockCardHtml(b, i, blocks.length)).join('')}
      </div>

      <button type="button" class="btn btn-secondary" id="pr-attendance-btn" style="width:100%; margin-bottom:8px;">&#128100; Attendance (${attendanceCount}/${players.length})</button>

      <div class="card">
        <h2>Coach Notes</h2>
        <textarea id="pr-notes" rows="3" style="width:100%;" placeholder="Optional">${escapeHtml(working.notes || '')}</textarea>
      </div>
    `;
    wireCoachHelpButtons(root);
    root.querySelector('#pr-back').addEventListener('click', onBack);
    root.querySelector('#pr-add-block').addEventListener('click', () => { blockDraft = newBlockDraft(); screen = 'block_edit'; render(); });
    root.querySelector('#pr-attendance-btn').addEventListener('click', () => { screen = 'attendance'; render(); });
    root.querySelector('#pr-notes').addEventListener('change', (e) => save({ notes: e.target.value }));

    root.querySelectorAll('[data-add-idea-block]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idea = unscheduledIdeas.find((i) => i.id === btn.dataset.addIdeaBlock);
        blockDraft = { ...newBlockDraft(), label: idea.text, practiceIdeaId: idea.id, focusArea: idea.category || null };
        screen = 'block_edit';
        render();
      });
    });

    root.querySelectorAll('[data-edit-block]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-block-action]')) return;
        blockDraft = { ...blocks.find((b) => b.id === card.dataset.editBlock) };
        screen = 'block_edit';
        render();
      });
    });
    root.querySelectorAll('[data-block-action="complete"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newBlocks = blocks.map((b) => (b.id === btn.dataset.blockId ? { ...b, complete: !b.complete } : b));
        await save({ blocks: newBlocks });
        render();
      });
    });
    root.querySelectorAll('[data-block-action="up"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = blocks.findIndex((b) => b.id === btn.dataset.blockId);
        if (idx > 0) { await save({ blocks: reorderBlocks(blocks, idx, idx - 1) }); render(); }
      });
    });
    root.querySelectorAll('[data-block-action="down"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = blocks.findIndex((b) => b.id === btn.dataset.blockId);
        if (idx < blocks.length - 1) { await save({ blocks: reorderBlocks(blocks, idx, idx + 1) }); render(); }
      });
    });
    root.querySelectorAll('[data-block-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await save({ blocks: blocks.filter((b) => b.id !== btn.dataset.blockId) });
        render();
      });
    });
  }

  function newBlockDraft() {
    return { id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label: '', durationMinutes: 10, focusArea: null, playIds: [], assignmentType: 'team', assignedPlayerIds: [], assignedRole: null, practiceIdeaId: null, complete: false };
  }

  function blockCardHtml(b, i, total) {
    const assignedIds = resolveAssignmentPlayerIds(b, players, weeklyRoles);
    const assignmentLabel = b.assignmentType === 'team' ? 'Whole Team' : b.assignmentType === 'role' ? `Role: ${escapeHtml(b.assignedRole || '')}` : `${assignedIds.length} player${assignedIds.length === 1 ? '' : 's'}`;
    return `
      <div class="card" data-edit-block="${b.id}" style="margin-bottom:8px; padding:10px 12px; cursor:pointer; ${b.complete ? 'opacity:0.6;' : ''}">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <p style="margin:0; font-weight:800;">${b.complete ? '&#10003; ' : ''}${escapeHtml(b.label || 'Block')} <span class="hint">&mdash; ${b.durationMinutes} min</span></p>
          <div class="row" style="gap:4px;">
            <button type="button" class="btn btn-link" data-block-action="up" data-block-id="${b.id}" ${i === 0 ? 'disabled' : ''} style="padding:2px 6px;">&#8593;</button>
            <button type="button" class="btn btn-link" data-block-action="down" data-block-id="${b.id}" ${i === total - 1 ? 'disabled' : ''} style="padding:2px 6px;">&#8595;</button>
          </div>
        </div>
        <p class="hint" style="margin:4px 0 0 0;">${b.focusArea ? escapeHtml(b.focusArea) + ' &middot; ' : ''}${assignmentLabel}${(b.playIds || []).length > 0 ? ` &middot; ${b.playIds.length} play${b.playIds.length === 1 ? '' : 's'}` : ''}</p>
        <div class="row-wrap" style="margin-top:6px;">
          <button type="button" class="btn btn-secondary" data-block-action="complete" data-block-id="${b.id}" style="padding:4px 10px;">${b.complete ? 'Mark Incomplete' : 'Mark Complete'}</button>
          <button type="button" class="btn btn-link" data-block-action="delete" data-block-id="${b.id}" style="padding:4px 10px; color:var(--sx-error);">Delete</button>
        </div>
      </div>
    `;
  }

  // ---------- BLOCK EDIT ----------

  function renderBlockEdit() {
    const allFocusAreas = [...BUILT_IN_FOCUS_AREAS, ...customFocusAreas.map((f) => f.label)];
    root.innerHTML = `
      <button type="button" class="btn btn-link" id="be-back" style="padding-left:0;">&larr; Back</button>
      <div class="card">
        <h2>Practice Block</h2>
        <input type="text" id="be-label" placeholder="Block name" value="${escapeAttr(blockDraft.label)}" style="margin-bottom:8px;" />
        <label class="field" style="margin-bottom:10px;">
          <span>Duration (minutes)</span>
          <input type="number" id="be-duration" min="1" value="${blockDraft.durationMinutes}" />
        </label>

        <p class="hint" style="margin:0 0 6px 0;">Focus Area</p>
        <div class="row-wrap" style="margin-bottom:6px;">
          ${allFocusAreas.map((f) => `<button type="button" class="chip ${blockDraft.focusArea === f ? 'selected' : ''}" data-focus-area="${escapeAttr(f)}">${escapeHtml(f)}</button>`).join('')}
        </div>
        <div class="row" style="gap:8px; margin-bottom:12px;">
          <input type="text" id="be-custom-focus" placeholder="Add custom focus area" style="flex:1;" />
          <button type="button" class="btn btn-secondary" id="be-add-focus">Add</button>
        </div>

        <p class="hint" style="margin:0 0 6px 0;">Attached Plays</p>
        <div class="row-wrap" style="margin-bottom:12px;">
          ${allPlays.map((p) => `<button type="button" class="chip ${blockDraft.playIds.includes(p.id) ? 'selected' : ''}" data-toggle-play="${p.id}">${escapeHtml(p.wristbandCode || p.name)}</button>`).join('') || '<p class="hint" style="margin:0;">No plays in the Playbook yet.</p>'}
        </div>

        <p class="hint" style="margin:0 0 6px 0;">Who</p>
        <div class="row-wrap" style="margin-bottom:8px;">
          <button type="button" class="chip ${blockDraft.assignmentType === 'team' ? 'selected' : ''}" data-assign-type="team">Whole Team</button>
          <button type="button" class="chip ${blockDraft.assignmentType === 'players' ? 'selected' : ''}" data-assign-type="players">Specific Players</button>
          <button type="button" class="chip ${blockDraft.assignmentType === 'role' ? 'selected' : ''}" data-assign-type="role">Role</button>
        </div>
        ${blockDraft.assignmentType === 'players' ? `
          <div class="row-wrap" style="margin-bottom:12px;">
            ${players.map((p) => `<button type="button" class="chip ${blockDraft.assignedPlayerIds.includes(p.id) ? 'selected' : ''}" data-toggle-player="${p.id}">${escapeHtml(p.firstName)}</button>`).join('')}
          </div>
        ` : ''}
        ${blockDraft.assignmentType === 'role' ? `
          <div class="row-wrap" style="margin-bottom:12px;">
            ${allRoles.length === 0 ? '<p class="hint" style="margin:0;">No roles found yet — build a play in the Playbook first.</p>' : allRoles.map((r) => `<button type="button" class="chip ${blockDraft.assignedRole === r ? 'selected' : ''}" data-assign-role="${escapeAttr(r)}">${escapeHtml(r)}</button>`).join('')}
          </div>
        ` : ''}

        <div class="row-wrap">
          <button type="button" class="btn btn-secondary" id="be-cancel" style="flex:1;">Cancel</button>
          <button type="button" class="btn btn-primary btn-large" id="be-save" style="flex:2;">Save Block</button>
        </div>
      </div>
    `;
    root.querySelector('#be-back').addEventListener('click', () => { screen = 'main'; render(); });
    root.querySelector('#be-cancel').addEventListener('click', () => { screen = 'main'; render(); });
    root.querySelector('#be-label').addEventListener('input', (e) => { blockDraft.label = e.target.value; });
    root.querySelector('#be-duration').addEventListener('input', (e) => { blockDraft.durationMinutes = Number(e.target.value) || 0; });

    root.querySelectorAll('[data-focus-area]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const v = chip.dataset.focusArea;
        blockDraft.focusArea = blockDraft.focusArea === v ? null : v;
        renderBlockEdit();
      });
    });
    root.querySelector('#be-add-focus').addEventListener('click', async () => {
      const input = root.querySelector('#be-custom-focus');
      const label = input.value.trim();
      if (!label) return;
      await addCustomFocusArea(teamId, label);
      customFocusAreas.push({ label });
      blockDraft.focusArea = label;
      renderBlockEdit();
    });

    root.querySelectorAll('[data-toggle-play]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.togglePlay;
        blockDraft.playIds = blockDraft.playIds.includes(id) ? blockDraft.playIds.filter((x) => x !== id) : [...blockDraft.playIds, id];
        renderBlockEdit();
      });
    });

    root.querySelectorAll('[data-assign-type]').forEach((chip) => {
      chip.addEventListener('click', () => { blockDraft.assignmentType = chip.dataset.assignType; renderBlockEdit(); });
    });
    root.querySelectorAll('[data-toggle-player]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.togglePlayer;
        blockDraft.assignedPlayerIds = blockDraft.assignedPlayerIds.includes(id) ? blockDraft.assignedPlayerIds.filter((x) => x !== id) : [...blockDraft.assignedPlayerIds, id];
        renderBlockEdit();
      });
    });
    root.querySelectorAll('[data-assign-role]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const v = chip.dataset.assignRole;
        blockDraft.assignedRole = blockDraft.assignedRole === v ? null : v;
        renderBlockEdit();
      });
    });

    root.querySelector('#be-save').addEventListener('click', async () => {
      if (!blockDraft.label.trim()) { root.querySelector('#be-label').focus(); return; }
      const existingBlocks = working.blocks || [];
      const idx = existingBlocks.findIndex((b) => b.id === blockDraft.id);
      const newBlocks = idx !== -1
        ? existingBlocks.map((b) => (b.id === blockDraft.id ? blockDraft : b))
        : [...existingBlocks, { ...blockDraft, order: existingBlocks.length }];
      await save({ blocks: newBlocks });
      if (blockDraft.practiceIdeaId) await markPracticeIdeaScheduled(teamId, blockDraft.practiceIdeaId, working.id);
      screen = 'main';
      render();
    });
  }

  // ---------- ATTENDANCE ----------

  function renderAttendance() {
    root.innerHTML = `
      <button type="button" class="btn btn-link" id="at-back" style="padding-left:0;">&larr; Back</button>
      <div class="card">
        <h2>Attendance</h2>
        ${players.map((p) => `
          <div style="padding:8px 0; border-bottom:1px solid var(--sx-gold-border);">
            <p style="margin:0 0 4px 0; font-weight:700;">${escapeHtml(p.firstName)}</p>
            <div class="row-wrap">
              ${ATTENDANCE_STATES.map((s) => `<button type="button" class="chip ${working.attendance?.[p.id] === s ? 'selected' : ''}" data-attendance="${p.id}" data-value="${s}">${s}</button>`).join('')}
              <button type="button" class="btn btn-link" data-evaluate="${p.id}" style="padding:4px 8px;">&#128221; Evaluate</button>
            </div>
          </div>
        `).join('') || '<p class="hint" style="margin:0;">No players on the roster yet.</p>'}
      </div>
    `;
    root.querySelector('#at-back').addEventListener('click', () => { screen = 'main'; render(); });
    root.querySelectorAll('[data-attendance]').forEach((chip) => {
      chip.addEventListener('click', async () => {
        const playerId = chip.dataset.attendance;
        const value = chip.dataset.value;
        const attendance = { ...(working.attendance || {}) };
        attendance[playerId] = attendance[playerId] === value ? null : value;
        await save({ attendance });
        render();
      });
    });
    root.querySelectorAll('[data-evaluate]').forEach((btn) => {
      btn.addEventListener('click', () => {
        evalTarget = players.find((p) => p.id === btn.dataset.evaluate);
        screen = 'evaluate';
        render();
      });
    });
  }

  // ---------- QUICK EVALUATION ----------

  function renderEvaluate() {
    const draft = { execution: null, effort: null, understanding: null, note: '' };
    root.innerHTML = `
      <button type="button" class="btn btn-link" id="ev-back" style="padding-left:0;">&larr; Back to Attendance</button>
      <div class="card card-gold" style="margin-bottom:8px;">
        <p style="margin:0;">Coach observation for <b>${escapeHtml(evalTarget.firstName)}</b> — ${escapeHtml(formatDate(working.date))}. Not a permanent label — just this practice.</p>
      </div>
      <div class="card">
        <p class="hint" style="margin:0 0 6px 0;">Execution</p>
        <div class="row-wrap" style="margin-bottom:10px;" data-eval-group="execution">
          ${EXECUTION_LEVELS.map(([v, l]) => `<button type="button" class="chip" data-eval-value="${v}">${l}</button>`).join('')}
        </div>
        <p class="hint" style="margin:0 0 6px 0;">Effort</p>
        <div class="row-wrap" style="margin-bottom:10px;" data-eval-group="effort">
          ${EFFORT_LEVELS.map(([v, l]) => `<button type="button" class="chip" data-eval-value="${v}">${l}</button>`).join('')}
        </div>
        <p class="hint" style="margin:0 0 6px 0;">Understanding</p>
        <div class="row-wrap" style="margin-bottom:10px;" data-eval-group="understanding">
          ${UNDERSTANDING_LEVELS.map(([v, l]) => `<button type="button" class="chip" data-eval-value="${v}">${l}</button>`).join('')}
        </div>
        <input type="text" id="ev-note" placeholder="Optional short note" maxlength="140" style="margin-bottom:var(--space-2);" />
        <button type="button" class="btn btn-primary btn-large" id="ev-save" style="width:100%;">Save Observation</button>
      </div>
    `;
    root.querySelector('#ev-back').addEventListener('click', () => { screen = 'attendance'; render(); });
    root.querySelectorAll('[data-eval-group]').forEach((group) => {
      group.querySelectorAll('[data-eval-value]').forEach((chip) => {
        chip.addEventListener('click', () => {
          draft[group.dataset.evalGroup] = chip.dataset.evalValue;
          group.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c === chip));
        });
      });
    });
    root.querySelector('#ev-note').addEventListener('input', (e) => { draft.note = e.target.value; });
    root.querySelector('#ev-save').addEventListener('click', async () => {
      await addEvaluation(teamId, evalTarget.id, { practiceId: working.id, date: working.date, ...draft });
      screen = 'attendance';
      render();
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
