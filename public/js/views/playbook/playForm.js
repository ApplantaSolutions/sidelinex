import { createPlay, getActiveVersion } from '../../data.js';
import {
  categoriesForSide,
  YARDAGE_DEPTH,
  RISK_LEVELS,
  EFFECTIVENESS_LEVELS,
  ROLE_CLASSIFICATIONS,
  SUGGESTED_SLOTS,
} from '../../constants/football.js';

/**
 * Renders the Add Play form. Editing an existing play (playId/existingPlay
 * passed) pre-fills fields but Milestone 2's first checkpoint only wires
 * up create — full edit-and-save is a fast follow, not blocking this
 * review.
 */
export async function renderPlayForm(root, team, claims, side, onDone, playId, existingPlay) {
  const assignments = {}; // slotLabel -> {route, roleClassification, job, why, key}
  let existingAssignments = {};

  if (playId && existingPlay?.activeVersionId) {
    const version = await getActiveVersion(claims.teamId, playId, existingPlay.activeVersionId);
    existingAssignments = version?.assignments || {};
    Object.assign(assignments, existingAssignments);
  }

  render();

  function render() {
    const categories = categoriesForSide(side);
    root.innerHTML = `
      <button id="back-to-list" class="btn btn-link" style="padding-left:0;">&larr; Back to Playbook</button>
      <h1 style="font-size:22px;">${playId ? 'Play Details' : 'Add Play'}</h1>

      <form id="play-form" class="stack">
        <div class="card">
          <h2>Basics</h2>
          <div class="stack">
            <label class="field">
              <span>Play Name</span>
              <input type="text" name="name" required value="${escapeAttr(existingPlay?.name)}" autocomplete="off" />
            </label>
            <div class="row" style="gap: var(--space-2);">
              <label class="field" style="flex:1;">
                <span>Wristband Code</span>
                <input type="text" name="wristbandCode" required value="${escapeAttr(existingPlay?.wristbandCode)}" autocomplete="off" />
              </label>
              <label class="field" style="flex:1;">
                <span>Side</span>
                <select name="side" id="side-select">
                  <option value="offense" ${side === 'offense' ? 'selected' : ''}>Offense</option>
                  <option value="defense" ${side === 'defense' ? 'selected' : ''}>Defense</option>
                </select>
              </label>
            </div>
            <label class="field">
              <span>Category</span>
              <select name="category">
                ${categories.map((c) => `<option value="${c.value}" ${existingPlay?.category === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <span>Formation</span>
              <input type="text" name="formation" value="${escapeAttr(existingPlay?.formation)}" autocomplete="off" placeholder="e.g. Trips Right" />
            </label>
            <label class="row">
              <input type="checkbox" name="favorite" ${existingPlay?.favorite ? 'checked' : ''} style="width:24px;height:24px;min-height:0;" />
              <span style="font-weight:700;">&#9733; Favorite</span>
            </label>
          </div>
        </div>

        <div class="card">
          <h2>Diagram (Optional)</h2>
          <input type="file" name="diagramFile" accept="image/*" />
          <p class="hint" style="margin: 8px 0 0 0;">Upload to Firebase Storage — wired up, but full upload testing needs a live signed-in session (see Milestone 1 status).</p>
        </div>

        <div class="card">
          <h2>Situational Tags</h2>
          <p class="hint" style="margin-bottom:8px;">Effective against:</p>
          <div class="row-wrap" id="matchup-chips">
            ${chip('beatsMan', 'Beats Man', existingPlay?.tags?.beatsMan)}
            ${chip('beatsZone', 'Beats Zone', existingPlay?.tags?.beatsZone)}
            ${chip('beatsPressure', 'Beats Pressure', existingPlay?.tags?.beatsPressure)}
          </div>
          <p class="hint" style="margin: var(--space-2) 0 8px 0;">Depth:</p>
          <div class="row-wrap" id="depth-chips">
            ${YARDAGE_DEPTH.map((d) => chip('yardageDepth', d.label, existingPlay?.tags?.yardageDepth === d.value, d.value, true)).join('')}
          </div>
          <p class="hint" style="margin: var(--space-2) 0 8px 0;">Situation:</p>
          <div class="row-wrap" id="situation-chips">
            ${chip('goalLine', 'Goal Line', existingPlay?.tags?.goalLine)}
            ${chip('conversion', 'Conversion', existingPlay?.tags?.conversion)}
            ${chip('explosive', 'Explosive / Shot', existingPlay?.tags?.explosive)}
            ${chip('safe', 'Safe Call', existingPlay?.tags?.safe)}
          </div>
          <label class="field" style="margin-top: var(--space-2);">
            <span>Risk Level</span>
            <select name="riskLevel">
              ${RISK_LEVELS.map((r) => `<option value="${r.value}" ${existingPlay?.tags?.riskLevel === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
            </select>
          </label>
          <label class="field" style="margin-top: var(--space-2);">
            <span>Intended Yardage</span>
            <input type="number" name="intendedYardage" value="${existingPlay?.intendedYardage ?? ''}" />
          </label>
          <label class="field" style="margin-top: var(--space-2);">
            <span>Supplemental Tags (comma-separated)</span>
            <input type="text" name="supplementalTags" value="${escapeAttr((existingPlay?.supplementalTags || []).join(', '))}" placeholder="e.g. crossing, edge, quick-game" />
          </label>
        </div>

        <div class="card">
          <h2>Effectiveness (Coach Judgment)</h2>
          <p class="hint" style="margin-bottom:8px;">Supplemented by real performance data once games are played.</p>
          ${['vsMan', 'vsZone', 'vsPressure'].map((field, i) => `
            <label class="field" style="margin-top:${i ? 'var(--space-2)' : '0'};">
              <span>${['vs. Man', 'vs. Zone', 'vs. Pressure'][i]}</span>
              <select name="${field}">
                <option value="">Not rated</option>
                ${EFFECTIVENESS_LEVELS.map((e) => `<option value="${e.value}" ${existingPlay?.effectiveness?.[field] === e.value ? 'selected' : ''}>${e.label}</option>`).join('')}
              </select>
            </label>
          `).join('')}
        </div>

        <div class="card">
          <h2>Play Intent</h2>
          <label class="field">
            <span>Overall Intent</span>
            <textarea name="intentDescription" placeholder="What is this play designed to do?">${escapeHtml(existingPlay?.intent?.description)}</textarea>
          </label>
          <label class="field" style="margin-top: var(--space-2);">
            <span>Primary Target Slot</span>
            <input type="text" name="primaryTargetSlot" value="${escapeAttr(existingPlay?.intent?.primaryTargetSlot)}" placeholder="e.g. WR1" />
          </label>
          <label class="field" style="margin-top: var(--space-2);">
            <span>Secondary Target Slot</span>
            <input type="text" name="secondaryTargetSlot" value="${escapeAttr(existingPlay?.intent?.secondaryTargetSlot)}" placeholder="e.g. Center" />
          </label>
          <label class="field" style="margin-top: var(--space-2);">
            <span>Decoy / Clear-Out Slots (comma-separated)</span>
            <input type="text" name="decoySlots" value="${escapeAttr((existingPlay?.intent?.decoySlots || []).join(', '))}" placeholder="e.g. WR2, WR4" />
          </label>
        </div>

        <div class="card">
          <h2>Slot Assignments</h2>
          <p class="hint" style="margin-bottom:8px;">Each slot answers: WHAT do I do? WHAT is my role? WHY does it matter? What's the KEY coaching point?</p>
          <div class="row-wrap" id="suggested-slots">
            ${SUGGESTED_SLOTS.map((s) => `<button type="button" class="chip" data-add-slot="${s}">+ ${s}</button>`).join('')}
          </div>
          <div class="row" style="margin-top: var(--space-2);">
            <input type="text" id="custom-slot-input" placeholder="Custom slot name" style="flex:1;" />
            <button type="button" id="add-custom-slot" class="btn btn-secondary">Add</button>
          </div>
          <div id="assignment-blocks" style="margin-top: var(--space-2);"></div>
        </div>

        <button type="submit" class="btn btn-primary btn-large">Save Play</button>
        <p id="form-error" class="error" hidden></p>
      </form>
    `;

    root.querySelector('#back-to-list').addEventListener('click', () => onDone());

    root.querySelector('#side-select').addEventListener('change', (e) => {
      side = e.target.value;
      render();
    });

    root.querySelectorAll('.chip[data-field]').forEach((chipEl) => {
      chipEl.addEventListener('click', () => {
        const field = chipEl.dataset.field;
        const isRadio = chipEl.dataset.radio === '1';
        if (isRadio) {
          root.querySelectorAll(`.chip[data-field="${field}"]`).forEach((c) => c.classList.remove('selected'));
          chipEl.classList.add('selected');
        } else {
          chipEl.classList.toggle('selected');
        }
      });
    });

    root.querySelectorAll('[data-add-slot]').forEach((btn) => {
      btn.addEventListener('click', () => addAssignmentBlock(btn.dataset.addSlot));
    });
    root.querySelector('#add-custom-slot').addEventListener('click', () => {
      const input = root.querySelector('#custom-slot-input');
      const label = input.value.trim();
      if (label) {
        addAssignmentBlock(label);
        input.value = '';
      }
    });

    // Re-add any assignments already present (editing case)
    Object.keys(existingAssignments).forEach((slot) => addAssignmentBlock(slot, existingAssignments[slot]));

    root.querySelector('#play-form').addEventListener('submit', handleSubmit);
  }

  function addAssignmentBlock(slotLabel, data = {}) {
    const container = root.querySelector('#assignment-blocks');
    if (container.querySelector(`[data-slot="${cssEscape(slotLabel)}"]`)) return; // no duplicates
    const block = document.createElement('div');
    block.className = 'card';
    block.dataset.slot = slotLabel;
    block.style.background = 'var(--sx-charcoal-2)';
    block.innerHTML = `
      <div class="card-header-row">
        <h2 style="color:var(--sx-gold);">${escapeHtml(slotLabel)}</h2>
        <button type="button" class="btn btn-link" data-remove-slot>Remove</button>
      </div>
      <div class="stack">
        <label class="field">
          <span>Route / Technique (WHAT)</span>
          <input type="text" data-assign-field="route" value="${escapeAttr(data.route)}" placeholder="e.g. Go, Drag, Block" />
        </label>
        <label class="field">
          <span>Role</span>
          <select data-assign-field="roleClassification">
            <option value="">Select...</option>
            ${ROLE_CLASSIFICATIONS.map((r) => `<option value="${r.value}" ${data.roleClassification === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Job (WHAT do I do)</span>
          <textarea data-assign-field="job" placeholder="Plain instructions for the player">${escapeHtml(data.job)}</textarea>
        </label>
        <label class="field">
          <span>Why It Matters</span>
          <textarea data-assign-field="why" placeholder="Why this assignment matters to the play">${escapeHtml(data.why)}</textarea>
        </label>
        <label class="field">
          <span>Key Coaching Point</span>
          <textarea data-assign-field="key" placeholder="The one thing to remember">${escapeHtml(data.key)}</textarea>
        </label>
      </div>
    `;
    block.querySelector('[data-remove-slot]').addEventListener('click', () => block.remove());
    container.appendChild(block);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const errorEl = root.querySelector('#form-error');
    errorEl.hidden = true;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
      const getChipValue = (field) => {
        const selected = root.querySelector(`.chip[data-field="${field}"].selected`);
        return selected ? selected.dataset.value === 'true' ? true : selected.dataset.value : null;
      };
      const isChipSelected = (field) => !!root.querySelector(`.chip[data-field="${field}"].selected`);

      const playData = {
        name: formData.get('name'),
        wristbandCode: formData.get('wristbandCode'),
        side: formData.get('side'),
        category: formData.get('category'),
        formation: formData.get('formation') || null,
        favorite: formData.get('favorite') === 'on',
        diagramUrl: null, // real Storage upload wiring is the next increment after this checkpoint
        tags: {
          beatsMan: isChipSelected('beatsMan'),
          beatsZone: isChipSelected('beatsZone'),
          beatsPressure: isChipSelected('beatsPressure'),
          yardageDepth: getChipValue('yardageDepth') || null,
          goalLine: isChipSelected('goalLine'),
          conversion: isChipSelected('conversion'),
          explosive: isChipSelected('explosive'),
          safe: isChipSelected('safe'),
          riskLevel: formData.get('riskLevel') || 'medium',
        },
        supplementalTags: (formData.get('supplementalTags') || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        intendedYardage: formData.get('intendedYardage') ? Number(formData.get('intendedYardage')) : null,
        intent: {
          description: formData.get('intentDescription') || '',
          primaryTargetSlot: formData.get('primaryTargetSlot') || null,
          secondaryTargetSlot: formData.get('secondaryTargetSlot') || null,
          decoySlots: (formData.get('decoySlots') || '').split(',').map((s) => s.trim()).filter(Boolean),
        },
        effectiveness: {
          vsMan: formData.get('vsMan') || null,
          vsZone: formData.get('vsZone') || null,
          vsPressure: formData.get('vsPressure') || null,
        },
      };

      const assignmentsOut = {};
      root.querySelectorAll('#assignment-blocks > [data-slot]').forEach((block) => {
        const slot = block.dataset.slot;
        assignmentsOut[slot] = {
          route: block.querySelector('[data-assign-field="route"]').value,
          roleClassification: block.querySelector('[data-assign-field="roleClassification"]').value,
          job: block.querySelector('[data-assign-field="job"]').value,
          why: block.querySelector('[data-assign-field="why"]').value,
          key: block.querySelector('[data-assign-field="key"]').value,
        };
      });

      await createPlay(claims.teamId, playData, assignmentsOut);
      onDone();
    } catch (err) {
      errorEl.textContent = err.message || 'Something went wrong saving this play.';
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Play';
    }
  }
}

function chip(field, label, selected, value = 'true', radio = false) {
  return `<button type="button" class="chip ${selected ? 'selected' : ''}" data-field="${field}" data-value="${value}" data-radio="${radio ? '1' : '0'}">${label}</button>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str ?? '');
}

function cssEscape(str) {
  return (str ?? '').replace(/"/g, '\\"');
}
