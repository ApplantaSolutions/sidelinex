import { createPlay, updatePlay, duplicatePlay, setPlayActive, getActiveVersion } from '../../data.js';
import { createFieldDesigner } from '../../playbook/fieldDesigner.js';
import {
  categoriesForSide,
  YARDAGE_DEPTH,
  RISK_LEVELS,
  EFFECTIVENESS_LEVELS,
  ROLE_CLASSIFICATIONS,
} from '../../constants/football.js';

export async function renderPlayForm(root, team, claims, side, onDone, playId, existingPlay) {
  let existingAssignments = {};
  let existingFieldDesign = null;
  let existingVersionId = existingPlay?.activeVersionId || null;

  if (playId && existingPlay?.activeVersionId) {
    const version = await getActiveVersion(claims.teamId, playId, existingPlay.activeVersionId);
    existingAssignments = version?.assignments || {};
    existingFieldDesign = version?.fieldDesign || null;
  }

  let designer = null;
  render();

  // The Designer's Help overlay lives on document.body (so it can cover
  // the whole screen), not inside `root` — replacing root.innerHTML alone
  // does NOT remove it. Every path that discards the current designer
  // (a fresh render(), or leaving this view entirely) must call this
  // first, or a still-open overlay is orphaned and stuck on screen.
  function teardownDesigner() {
    if (designer) {
      designer.destroy();
      designer = null;
    }
  }

  function render() {
    teardownDesigner();
    const categories = categoriesForSide(side);
    root.innerHTML = `
      <button id="back-to-list" class="btn btn-link" style="padding-left:0;">&larr; Back to Playbook</button>
      <div class="dash-header" style="margin-bottom: var(--space-2);">
        <h1 style="font-size:22px; margin:0;">${playId ? 'Edit Play' : 'Add Play'}</h1>
        ${playId ? `
          <div class="row" style="flex-wrap:wrap;">
            <button type="button" id="duplicate-play" class="btn btn-link">Duplicate</button>
            <button type="button" id="archive-play" class="btn btn-link">${existingPlay.active === false ? 'Restore' : 'Archive'}</button>
          </div>
        ` : ''}
      </div>

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
          <p class="hint" style="margin: 8px 0 0 0;">Upload to Firebase Storage — needs a live signed-in session plus a one-time Storage setup step (see Milestone 1 status). If you draw the play below, you may not need an uploaded image at all.</p>
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
          <p class="hint" style="margin: var(--space-2) 0 0 0;">Primary/Secondary/Decoy below are set from the Play Designer's route designations once you draw routes — you can also type them manually if you skip the designer.</p>
          <label class="field" style="margin-top: var(--space-1);">
            <span>Primary Target Slot</span>
            <input type="text" name="primaryTargetSlot" id="primaryTargetSlot" value="${escapeAttr(existingPlay?.intent?.primaryTargetSlot)}" placeholder="e.g. WR1" />
          </label>
          <label class="field" style="margin-top: var(--space-2);">
            <span>Secondary Target Slot</span>
            <input type="text" name="secondaryTargetSlot" id="secondaryTargetSlot" value="${escapeAttr(existingPlay?.intent?.secondaryTargetSlot)}" placeholder="e.g. Center" />
          </label>
          <label class="field" style="margin-top: var(--space-2);">
            <span>Decoy / Clear-Out Slots (comma-separated)</span>
            <input type="text" name="decoySlots" id="decoySlots" value="${escapeAttr((existingPlay?.intent?.decoySlots || []).join(', '))}" placeholder="e.g. WR2, WR3" />
          </label>
        </div>

        <div class="card">
          <h2>Play Designer</h2>
          <div id="field-designer-mount"></div>
        </div>

        <div class="card">
          <h2>Assignments — What / Role / Why / Key</h2>
          <div id="assignment-blocks"></div>
        </div>

        <button type="submit" class="btn btn-primary btn-large">Save Play</button>
        <p id="form-error" class="error" hidden></p>
      </form>
    `;

    root.querySelector('#back-to-list').addEventListener('click', () => { teardownDesigner(); onDone(); });

    root.querySelector('#side-select').addEventListener('change', (e) => {
      side = e.target.value;
      render();
    });

    if (playId) {
      root.querySelector('#duplicate-play').addEventListener('click', async () => {
        await duplicatePlay(claims.teamId, playId);
        teardownDesigner();
        onDone();
      });
      root.querySelector('#archive-play').addEventListener('click', async () => {
        await setPlayActive(claims.teamId, playId, existingPlay.active === false);
        teardownDesigner();
        onDone();
      });
    }

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

    // --- Field Designer ---
    // The Designer now owns adding players itself (guided "Pick a Player"
    // step) — it just needs to know about slots that already have
    // Assignment text but no drawn position yet (legacy plays from before
    // the Designer existed), and to tell us when a slot is added/removed
    // so the Assignments card below stays in sync.
    const knownSlots = Object.keys(existingAssignments);
    designer = createFieldDesigner(root.querySelector('#field-designer-mount'), {
      initialDesign: existingFieldDesign,
      knownSlots,
      onSlotAdded: (slot) => addAssignmentBlock(slot),
      onSlotRemoved: (slot) => {
        const block = root.querySelector(`#assignment-blocks [data-slot="${cssEscape(slot)}"]`);
        if (block) block.remove();
      },
      onChange: syncIntentFromDesigner,
    });

    // Pre-populate Assignment blocks for every slot the Designer already
    // knows about (both positioned and legacy-unpositioned).
    new Set([...knownSlots, ...Object.keys(existingFieldDesign?.positions || {})]).forEach((slot) => {
      addAssignmentBlock(slot, existingAssignments[slot] || {});
    });

    root.querySelector('#play-form').addEventListener('submit', handleSubmit);
  }

  function syncIntentFromDesigner(design) {
    const primary = Object.entries(design.routes).find(([, r]) => r.designation === 'primary')?.[0];
    const secondary = Object.entries(design.routes).find(([, r]) => r.designation === 'secondary')?.[0];
    const decoys = Object.entries(design.routes).filter(([, r]) => r.designation === 'decoy').map(([slot]) => slot);
    if (primary) root.querySelector('#primaryTargetSlot').value = primary;
    if (secondary) root.querySelector('#secondaryTargetSlot').value = secondary;
    if (decoys.length) root.querySelector('#decoySlots').value = decoys.join(', ');
  }

  function addAssignmentBlock(slotLabel, data = {}) {
    const container = root.querySelector('#assignment-blocks');
    if (container.querySelector(`[data-slot="${cssEscape(slotLabel)}"]`)) return;
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
    block.querySelector('[data-remove-slot]').addEventListener('click', () => {
      block.remove();
      designer.removeSlot(slotLabel);
    });
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
        return selected ? (selected.dataset.value === 'true' ? true : selected.dataset.value) : null;
      };
      const isChipSelected = (field) => !!root.querySelector(`.chip[data-field="${field}"].selected`);

      const playData = {
        name: formData.get('name'),
        wristbandCode: formData.get('wristbandCode'),
        side: formData.get('side'),
        category: formData.get('category'),
        formation: formData.get('formation') || null,
        favorite: formData.get('favorite') === 'on',
        diagramUrl: existingPlay?.diagramUrl || null, // real Storage upload wiring is the next increment
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
        supplementalTags: (formData.get('supplementalTags') || '').split(',').map((s) => s.trim()).filter(Boolean),
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

      const fieldDesign = designer.getDesign();

      if (playId) {
        await updatePlay(claims.teamId, playId, playData, assignmentsOut, fieldDesign);
      } else {
        await createPlay(claims.teamId, playData, assignmentsOut, fieldDesign);
      }
      teardownDesigner();
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
