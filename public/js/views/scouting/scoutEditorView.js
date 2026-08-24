// Opponent Scout editor — chips/dropdowns/toggles only, per the explicit
// "do not create giant forms" / "typing is last resort" requirement. One
// scrollable screen for the profile itself (name/notes/looks/tags/
// situational tendencies), with two small sub-screens for the two things
// that genuinely need their own space: one playmaker card at a time, and
// the visual alignment editor (delegated to scoutAlignmentEditor.js).
//
// Nothing here writes to Firestore directly — the caller (scoutTabView.js)
// owns createScout/updateScout, matching the working-copy-then-save
// pattern already used by weeklyRolesView.js.

import {
  DEFENSIVE_LOOKS, TENDENCY_TAGS, RUSHER_TAGS, PLAYMAKER_STRENGTH_TAGS, SITUATIONS, labelFor,
} from '../../scouting/scoutingTaxonomy.js';
import { renderScoutAlignmentEditor } from './scoutAlignmentEditor.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

/**
 * @param {HTMLElement} root
 * @param {object|null} existingScout
 * @param {{onSave: (working: object) => void, onCancel: () => void}} callbacks
 */
export function renderScoutEditor(root, existingScout, { onSave, onCancel }) {
  const working = {
    opponentName: existingScout?.opponentName || '',
    notes: existingScout?.notes || '',
    pregameTendencies: {
      baseLook: existingScout?.pregameTendencies?.baseLook || null,
      tendencyTags: [...(existingScout?.pregameTendencies?.tendencyTags || [])],
      rusherTags: [...(existingScout?.pregameTendencies?.rusherTags || [])],
      rusherNote: existingScout?.pregameTendencies?.rusherNote || '',
    },
    playmakers: (existingScout?.playmakers || []).map((p) => ({ ...p })),
    savedAlignments: (existingScout?.savedAlignments || []).map((a) => ({ ...a })),
    situationalTendencies: (existingScout?.situationalTendencies || []).map((s) => ({ ...s })),
  };

  let screen = 'main'; // 'main' | 'playmaker_edit' | 'alignment_edit'
  let playmakerDraft = null;
  let alignmentDraftId = null;

  render();

  function render() {
    if (screen === 'playmaker_edit') return renderPlaymakerEdit();
    if (screen === 'alignment_edit') return renderAlignmentEdit();
    renderMain();
  }

  function renderMain() {
    root.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:var(--space-2);">
        <p class="hint" style="margin:0;">Tap chips — typing is only for the opponent's name.</p>
        ${helpButtonHtml('opponentScout')}
      </div>

      <div class="card" style="margin-bottom:var(--space-2);">
        <h2>Opponent</h2>
        <input type="text" id="scout-name" placeholder="Opponent / team name" value="${escapeAttr(working.opponentName)}" style="margin-bottom:8px;" />
        <textarea id="scout-notes" placeholder="Optional notes" rows="2" style="width:100%;">${escapeHtml(working.notes)}</textarea>
      </div>

      <div class="card" style="margin-bottom:var(--space-2);">
        <h2>Base Defensive Look</h2>
        <div class="row-wrap">${singleChip(DEFENSIVE_LOOKS, working.pregameTendencies.baseLook, 'base-look')}</div>
      </div>

      <div class="card" style="margin-bottom:var(--space-2);">
        <h2>Defensive Tendencies</h2>
        <div class="row-wrap">${multiChip(TENDENCY_TAGS, working.pregameTendencies.tendencyTags, 'tendency-tag')}</div>
      </div>

      <div class="card" style="margin-bottom:var(--space-2);">
        <h2>Rusher Intelligence</h2>
        <div class="row-wrap" style="margin-bottom:8px;">${multiChip(RUSHER_TAGS, working.pregameTendencies.rusherTags, 'rusher-tag')}</div>
        <input type="text" id="scout-rusher-note" placeholder="Short note (optional)" value="${escapeAttr(working.pregameTendencies.rusherNote)}" maxlength="140" />
      </div>

      <div class="card" style="margin-bottom:var(--space-2);">
        <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h2 style="margin:0;">Playmakers</h2>
          <button type="button" class="btn btn-secondary" id="scout-add-playmaker">+ Add</button>
        </div>
        <p class="hint" style="margin:0 0 8px 0;">Coach observation — not objective player ratings.</p>
        ${working.playmakers.length === 0 ? '<p class="hint" style="margin:0;">None yet.</p>' : working.playmakers.map((p) => playmakerCard(p)).join('')}
      </div>

      <div class="card" style="margin-bottom:var(--space-2);">
        <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h2 style="margin:0;">Saved Defensive Alignments</h2>
          <button type="button" class="btn btn-secondary" id="scout-add-alignment">+ New Look</button>
        </div>
        ${working.savedAlignments.length === 0 ? '<p class="hint" style="margin:0;">None yet.</p>' : working.savedAlignments.map((a) => alignmentCard(a)).join('')}
      </div>

      <div class="card" style="margin-bottom:var(--space-2);">
        <h2>Situational Tendencies</h2>
        <p class="hint" style="margin:0 0 8px 0;">Tendencies, not guarantees — leave any row blank.</p>
        ${SITUATIONS.map((s) => situationRow(s)).join('')}
      </div>

      <div class="row-wrap">
        <button type="button" class="btn btn-secondary" id="scout-cancel" style="flex:1;">Cancel</button>
        <button type="button" class="btn btn-primary btn-large" id="scout-save" style="flex:2;">Save Opponent Scout</button>
      </div>
    `;
    wireCoachHelpButtons(root);
    wireMainEvents();
  }

  function playmakerCard(p) {
    return `
      <div class="card" style="margin-bottom:8px; padding:10px 12px; cursor:pointer;" data-edit-playmaker="${p.id}">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <p style="margin:0; font-weight:800;">#${escapeHtml(p.jerseyNumber ?? '?')} ${p.name ? '— ' + escapeHtml(p.name) : ''} ${p.strengthTag ? '— ' + escapeHtml(labelFor(PLAYMAKER_STRENGTH_TAGS, p.strengthTag)) : ''}</p>
          <button type="button" class="btn btn-link" data-remove-playmaker="${p.id}" style="padding:2px 8px;">&times;</button>
        </div>
        ${p.observation ? `<p class="hint" style="margin:4px 0 0 0;"><b>COACH OBSERVATION:</b> ${escapeHtml(p.observation)}</p>` : ''}
      </div>
    `;
  }

  function alignmentCard(a) {
    const defenderCount = Object.keys(a.defenders || {}).length;
    return `
      <div class="card" style="margin-bottom:8px; padding:10px 12px; cursor:pointer;" data-edit-alignment="${a.id}">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <p style="margin:0; font-weight:800;">${escapeHtml(a.name || 'Untitled Look')} <span class="hint">&mdash; ${escapeHtml((a.mode || '').toUpperCase())} &middot; ${defenderCount} defender${defenderCount === 1 ? '' : 's'}</span></p>
          <button type="button" class="btn btn-link" data-remove-alignment="${a.id}" style="padding:2px 8px;">&times;</button>
        </div>
      </div>
    `;
  }

  function situationRow(situation) {
    const existing = working.situationalTendencies.find((s) => s.situation === situation.value);
    const combined = [...DEFENSIVE_LOOKS, ...TENDENCY_TAGS];
    return `
      <div style="margin-bottom:10px;">
        <p class="hint" style="margin:0 0 4px 0;">${escapeHtml(situation.label)}</p>
        <div class="row-wrap" data-situation-row="${situation.value}">
          ${combined.map((t) => `<button type="button" class="chip ${existing?.tendency === t.value ? 'selected' : ''}" data-situation-tag="${t.value}">${escapeHtml(t.label)}</button>`).join('')}
        </div>
      </div>
    `;
  }

  function wireMainEvents() {
    root.querySelector('#scout-name').addEventListener('input', (e) => { working.opponentName = e.target.value; });
    root.querySelector('#scout-notes').addEventListener('input', (e) => { working.notes = e.target.value; });
    root.querySelector('#scout-rusher-note').addEventListener('input', (e) => { working.pregameTendencies.rusherNote = e.target.value; });

    root.querySelectorAll('[data-base-look]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const v = chip.dataset.baseLook;
        working.pregameTendencies.baseLook = working.pregameTendencies.baseLook === v ? null : v;
        render();
      });
    });
    root.querySelectorAll('[data-tendency-tag]').forEach((chip) => {
      chip.addEventListener('click', () => toggleInArray(working.pregameTendencies.tendencyTags, chip.dataset.tendencyTag, render));
    });
    root.querySelectorAll('[data-rusher-tag]').forEach((chip) => {
      chip.addEventListener('click', () => toggleInArray(working.pregameTendencies.rusherTags, chip.dataset.rusherTag, render));
    });

    root.querySelectorAll('[data-situation-row]').forEach((rowEl) => {
      const situation = rowEl.dataset.situationRow;
      rowEl.querySelectorAll('[data-situation-tag]').forEach((chip) => {
        chip.addEventListener('click', () => {
          const tag = chip.dataset.situationTag;
          const idx = working.situationalTendencies.findIndex((s) => s.situation === situation);
          const already = idx !== -1 && working.situationalTendencies[idx].tendency === tag;
          if (idx !== -1) working.situationalTendencies.splice(idx, 1);
          if (!already) working.situationalTendencies.push({ situation, tendency: tag });
          render();
        });
      });
    });

    root.querySelector('#scout-add-playmaker').addEventListener('click', () => {
      playmakerDraft = { id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, jerseyNumber: '', name: '', strengthTag: null, tendencyTags: [], observation: '' };
      screen = 'playmaker_edit';
      render();
    });
    root.querySelectorAll('[data-edit-playmaker]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove-playmaker]')) return;
        playmakerDraft = { ...working.playmakers.find((p) => p.id === card.dataset.editPlaymaker) };
        screen = 'playmaker_edit';
        render();
      });
    });
    root.querySelectorAll('[data-remove-playmaker]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        working.playmakers = working.playmakers.filter((p) => p.id !== btn.dataset.removePlaymaker);
        render();
      });
    });

    root.querySelector('#scout-add-alignment').addEventListener('click', () => {
      alignmentDraftId = null;
      screen = 'alignment_edit';
      render();
    });
    root.querySelectorAll('[data-edit-alignment]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove-alignment]')) return;
        alignmentDraftId = card.dataset.editAlignment;
        screen = 'alignment_edit';
        render();
      });
    });
    root.querySelectorAll('[data-remove-alignment]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        working.savedAlignments = working.savedAlignments.filter((a) => a.id !== btn.dataset.removeAlignment);
        render();
      });
    });

    root.querySelector('#scout-cancel').addEventListener('click', onCancel);
    root.querySelector('#scout-save').addEventListener('click', () => {
      if (!working.opponentName.trim()) {
        root.querySelector('#scout-name').focus();
        return;
      }
      onSave(working);
    });
  }

  function renderPlaymakerEdit() {
    root.innerHTML = `
      <button type="button" class="btn btn-link" id="pm-back" style="padding-left:0;">&larr; Back</button>
      <div class="card">
        <h2>Playmaker</h2>
        <div class="row" style="gap:8px; margin-bottom:8px;">
          <input type="number" id="pm-jersey" placeholder="#" value="${escapeAttr(playmakerDraft.jerseyNumber)}" style="width:80px;" />
          <input type="text" id="pm-name" placeholder="Name/nickname (optional)" value="${escapeAttr(playmakerDraft.name)}" style="flex:1;" />
        </div>
        <p class="hint" style="margin:0 0 6px 0;">Strength / Type</p>
        <div class="row-wrap" style="margin-bottom:10px;">${singleChip(PLAYMAKER_STRENGTH_TAGS, playmakerDraft.strengthTag, 'pm-strength')}</div>
        <p class="hint" style="margin:0 0 6px 0;">Tendencies</p>
        <div class="row-wrap" style="margin-bottom:10px;">${multiChip(TENDENCY_TAGS, playmakerDraft.tendencyTags || [], 'pm-tendency')}</div>
        <p class="hint" style="margin:0 0 6px 0;"><b>COACH OBSERVATION</b> (optional)</p>
        <input type="text" id="pm-observation" placeholder="e.g. Bites hard on play-action" value="${escapeAttr(playmakerDraft.observation)}" maxlength="140" style="margin-bottom:var(--space-2);" />
        <button type="button" class="btn btn-primary btn-large" id="pm-save" style="width:100%;">Save Playmaker</button>
      </div>
    `;
    root.querySelector('#pm-back').addEventListener('click', () => { screen = 'main'; render(); });
    root.querySelector('#pm-jersey').addEventListener('input', (e) => { playmakerDraft.jerseyNumber = e.target.value; });
    root.querySelector('#pm-name').addEventListener('input', (e) => { playmakerDraft.name = e.target.value; });
    root.querySelector('#pm-observation').addEventListener('input', (e) => { playmakerDraft.observation = e.target.value; });
    root.querySelectorAll('[data-pm-strength]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const v = chip.dataset.pmStrength;
        playmakerDraft.strengthTag = playmakerDraft.strengthTag === v ? null : v;
        renderPlaymakerEdit();
      });
    });
    root.querySelectorAll('[data-pm-tendency]').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (!playmakerDraft.tendencyTags) playmakerDraft.tendencyTags = [];
        toggleInArray(playmakerDraft.tendencyTags, chip.dataset.pmTendency, renderPlaymakerEdit);
      });
    });
    root.querySelector('#pm-save').addEventListener('click', () => {
      if (!String(playmakerDraft.jerseyNumber).trim()) {
        root.querySelector('#pm-jersey').focus();
        return;
      }
      const idx = working.playmakers.findIndex((p) => p.id === playmakerDraft.id);
      if (idx !== -1) working.playmakers[idx] = playmakerDraft;
      else working.playmakers.push(playmakerDraft);
      screen = 'main';
      render();
    });
  }

  function renderAlignmentEdit() {
    const existing = alignmentDraftId ? working.savedAlignments.find((a) => a.id === alignmentDraftId) : null;
    renderScoutAlignmentEditor(root, existing, {
      onSave: (alignment) => {
        const idx = working.savedAlignments.findIndex((a) => a.id === alignment.id);
        if (idx !== -1) working.savedAlignments[idx] = alignment;
        else working.savedAlignments.push(alignment);
        screen = 'main';
        render();
      },
      onCancel: () => { screen = 'main'; render(); },
    });
  }
}

function toggleInArray(arr, value, after) {
  const idx = arr.indexOf(value);
  if (idx === -1) arr.push(value);
  else arr.splice(idx, 1);
  after();
}

function multiChip(list, selected, dataAttr) {
  return list.map((item) => `<button type="button" class="chip ${selected.includes(item.value) ? 'selected' : ''}" data-${dataAttr}="${item.value}">${escapeHtml(item.label)}</button>`).join('');
}

function singleChip(list, selected, dataAttr) {
  return list.map((item) => `<button type="button" class="chip ${selected === item.value ? 'selected' : ''}" data-${dataAttr}="${item.value}">${escapeHtml(item.label)}</button>`).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str ?? '');
}
