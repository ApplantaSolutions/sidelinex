import { createPlay, updatePlay, duplicatePlay, setPlayActive, getActiveVersion } from '../../data.js';
import { createFieldDesigner } from '../../playbook/fieldDesigner.js';
import { analyzePlay } from '../../auth.js';
import { approxYardsFromDelta } from '../../constants/routes.js';
import { helpButtonHtml, wireCoachHelpButtons, closeCoachHelp } from '../../ui/coachHelp.js';
import {
  categoriesForSide,
  YARDAGE_DEPTH,
  RISK_LEVELS,
  EFFECTIVENESS_LEVELS,
  ROLE_CLASSIFICATIONS,
} from '../../constants/football.js';

// Product-wide rule (Play Intelligence V1): if SidelineX already knows
// something from the Play Designer, never make the coach retype it — only
// ever a smart DEFAULT, never a silent overwrite of something the coach
// already typed. designation -> roleClassification is a many-to-one
// mapping (the Designer's 3-way primary/secondary/decoy vs. the fuller
// roleClassification vocabulary) — this covers the common case; a coach
// can still pick a more specific option (checkdown, block/screen, motion,
// etc.) any time.
const DESIGNATION_TO_ROLE = { primary: 'primary_target', secondary: 'secondary_target', decoy: 'decoy_clearout' };

const TAG_LABELS = {
  beatsMan: 'Beats Man',
  beatsZone: 'Beats Zone',
  beatsPressure: 'Beats Pressure',
  goalLine: 'Goal Line',
  conversion: 'Conversion',
  explosive: 'Explosive / Shot',
  safe: 'Safe Call',
};

// Unsigned Cloudinary upload — no backend endpoint needed, no API secret
// ever touches the browser. The preset itself (configured in the
// Cloudinary dashboard, not here) is what constrains where uploads land
// (folder: sidelinex/plays) and enforces "Disallow public ID" so users
// can't override the generated filename.
const CLOUDINARY_CLOUD_NAME = 'yyeeks1y';
const CLOUDINARY_UPLOAD_PRESET = 'sidelinex_plays';

function openDiagramLightbox(url, closeRef) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.9);
    display:flex; align-items:center; justify-content:center; padding:16px;
  `;
  overlay.innerHTML = `
    <img src="${url}" alt="Play diagram, full size" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:8px;" />
    <button type="button" aria-label="Close" style="
      position:fixed; top:16px; right:16px; width:44px; height:44px; border-radius:50%;
      border:none; background:rgba(255,255,255,0.15); color:#fff; font-size:22px; line-height:1;
    ">&times;</button>
  `;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.tagName === 'BUTTON') closeRef();
  });
  document.body.appendChild(overlay);
  return overlay;
}

async function uploadDiagramToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: formData,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.error?.message || `Upload failed (${res.status})`;
    throw new Error(message);
  }
  return payload.secure_url;
}

export async function renderPlayForm(root, team, claims, side, onDone, playId, existingPlay) {
  let existingAssignments = {};
  let existingFieldDesign = null;
  let existingVersionId = existingPlay?.activeVersionId || null;

  // Tracks the diagram image across re-renders and the async upload —
  // separate from the DOM because the <input type="file"> itself can't
  // hold "this play already has an uploaded image" state on its own.
  let diagramUrl = existingPlay?.diagramUrl || null;
  let diagramUploadPromise = null;

  if (playId && existingPlay?.activeVersionId) {
    const version = await getActiveVersion(claims.teamId, playId, existingPlay.activeVersionId);
    existingAssignments = version?.assignments || {};
    existingFieldDesign = version?.fieldDesign || null;
  }

  let designer = null;
  let lightboxEl = null;
  render();

  // The Designer's Help overlay (and, below, the diagram lightbox) live on
  // document.body so they can cover the whole screen — replacing
  // root.innerHTML alone does NOT remove them. Every path that discards
  // the current designer (a fresh render(), or leaving this view
  // entirely) must call this first, or a still-open overlay is orphaned
  // and stuck on screen, exactly like the Help-overlay bug this pattern
  // was originally built to fix.
  function teardownDesigner() {
    closeDiagramLightbox();
    closeCoachHelp();
    if (designer) {
      designer.destroy();
      designer = null;
    }
  }

  function showDiagramLightbox() {
    if (!diagramUrl || lightboxEl) return;
    lightboxEl = openDiagramLightbox(diagramUrl, closeDiagramLightbox);
  }

  function closeDiagramLightbox() {
    if (lightboxEl) {
      lightboxEl.remove();
      lightboxEl = null;
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
          <div class="card-header-row">
            <h2>Diagram (Optional)</h2>
            ${helpButtonHtml('diagramUpload')}
          </div>
          ${diagramUrl ? `
            <div id="diagram-preview-wrap" style="margin-bottom:8px;">
              <img id="diagram-preview" src="${escapeAttr(diagramUrl)}" alt="Uploaded play diagram" style="max-width:100%; border-radius:8px; display:block; cursor:zoom-in;" />
              <p class="hint" style="margin:4px 0 0 0;">Tap image to enlarge</p>
              <button type="button" id="remove-diagram" class="btn btn-link" style="padding-left:0;">Remove image</button>
            </div>
          ` : `<div id="diagram-preview-wrap"></div>`}
          <input type="file" name="diagramFile" id="diagram-file-input" accept="image/*" ${diagramUrl ? 'hidden' : ''} />
          <p id="diagram-status" class="hint" style="margin: 8px 0 0 0;">If you draw the play below, you may not need an uploaded image at all.</p>
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

        <div class="card">
          <div class="card-header-row">
            <h2>AI Play Analyzer</h2>
            ${helpButtonHtml('aiAnalyzer')}
          </div>
          <p class="hint" style="margin-bottom:var(--space-2);">Advisory only — SidelineX explains its reasoning, you make the final call. Nothing here is applied until you accept it.</p>
          <button type="button" id="analyze-btn" class="btn btn-primary btn-large" style="width:100%;">&#129504; ANALYZE PLAY</button>
          <div id="analyze-results"></div>
        </div>

        <button type="submit" class="btn btn-primary btn-large">Save Play</button>
        <p id="form-error" class="error" hidden></p>
      </form>
    `;

    root.querySelector('#back-to-list').addEventListener('click', () => { teardownDesigner(); onDone(); });

    wireCoachHelpButtons(root);

    root.querySelector('#diagram-preview')?.addEventListener('click', showDiagramLightbox);

    const diagramFileInput = root.querySelector('#diagram-file-input');
    const diagramStatusEl = root.querySelector('#diagram-status');
    if (diagramFileInput) {
      diagramFileInput.addEventListener('change', () => {
        const file = diagramFileInput.files?.[0];
        if (!file) return;
        diagramStatusEl.textContent = 'Uploading…';
        diagramStatusEl.style.color = '';
        diagramUploadPromise = uploadDiagramToCloudinary(file)
          .then((url) => {
            diagramUrl = url;
            diagramStatusEl.textContent = '';
            renderDiagramPreview();
          })
          .catch((err) => {
            diagramStatusEl.textContent = err.message || 'Upload failed — try again.';
            diagramStatusEl.style.color = 'var(--sx-danger, #e5484d)';
          })
          .finally(() => { diagramUploadPromise = null; });
      });
    }
    const removeDiagramBtn = root.querySelector('#remove-diagram');
    if (removeDiagramBtn) {
      removeDiagramBtn.addEventListener('click', () => {
        diagramUrl = null;
        renderDiagramPreview();
      });
    }

    function renderDiagramPreview() {
      const wrap = root.querySelector('#diagram-preview-wrap');
      const input = root.querySelector('#diagram-file-input');
      if (!wrap || !input) return;
      if (diagramUrl) {
        wrap.innerHTML = `
          <img id="diagram-preview" src="${escapeAttr(diagramUrl)}" alt="Uploaded play diagram" style="max-width:100%; border-radius:8px; display:block; cursor:zoom-in;" />
          <p class="hint" style="margin:4px 0 0 0;">Tap image to enlarge</p>
          <button type="button" id="remove-diagram" class="btn btn-link" style="padding-left:0;">Remove image</button>
        `;
        wrap.querySelector('#diagram-preview').addEventListener('click', showDiagramLightbox);
        wrap.querySelector('#remove-diagram').addEventListener('click', () => {
          closeDiagramLightbox();
          diagramUrl = null;
          renderDiagramPreview();
        });
        input.hidden = true;
        input.value = '';
      } else {
        wrap.innerHTML = '';
        input.hidden = false;
      }
    }

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
      onChange: (design) => {
        syncIntentFromDesigner(design);
        syncAssignmentDefaultsFromDesigner(design);
        suggestIntendedYardage(design);
      },
      onFormationApplied: (label) => {
        const formationInput = root.querySelector('input[name="formation"]');
        // Only a default — a coach who already typed something (e.g. a
        // side-flipped variant name) keeps exactly what they typed.
        if (formationInput && !formationInput.value.trim()) formationInput.value = label;
      },
    });

    // Pre-populate Assignment blocks for every slot the Designer already
    // knows about (both positioned and legacy-unpositioned).
    new Set([...knownSlots, ...Object.keys(existingFieldDesign?.positions || {})]).forEach((slot) => {
      addAssignmentBlock(slot, existingAssignments[slot] || {});
    });

    root.querySelector('#play-form').addEventListener('submit', handleSubmit);
    root.querySelector('#analyze-btn').addEventListener('click', handleAnalyze);
  }

  async function handleAnalyze() {
    const btn = root.querySelector('#analyze-btn');
    const resultsEl = root.querySelector('#analyze-results');
    btn.disabled = true;
    btn.textContent = 'Analyzing…';
    resultsEl.innerHTML = '';

    try {
      const design = designer.getDesign();
      const playData = {
        formation: root.querySelector('input[name="formation"]').value || null,
        category: root.querySelector('select[name="category"]').value,
        side,
        positions: design.positions,
        routes: design.routes,
        defense: design.defense,
        primaryTargetSlot: root.querySelector('#primaryTargetSlot').value || null,
        secondaryTargetSlot: root.querySelector('#secondaryTargetSlot').value || null,
        decoySlots: (root.querySelector('#decoySlots').value || '').split(',').map((s) => s.trim()).filter(Boolean),
        existingMetadata: {
          riskLevel: root.querySelector('select[name="riskLevel"]').value,
          tags: {
            beatsMan: !!root.querySelector('.chip[data-field="beatsMan"].selected'),
            beatsZone: !!root.querySelector('.chip[data-field="beatsZone"].selected'),
            beatsPressure: !!root.querySelector('.chip[data-field="beatsPressure"].selected'),
          },
          effectiveness: {
            vsMan: root.querySelector('select[name="vsMan"]').value || null,
            vsZone: root.querySelector('select[name="vsZone"]').value || null,
            vsPressure: root.querySelector('select[name="vsPressure"]').value || null,
          },
        },
      };

      const analysis = await analyzePlay(playData);
      renderAnalysisResults(resultsEl, analysis);
    } catch (err) {
      resultsEl.innerHTML = `<p class="error" style="margin-top:8px;">${escapeHtml(err.message || 'Analysis failed — try again.')}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '🧠 ANALYZE PLAY';
    }
  }

  function renderAnalysisResults(el, analysis) {
    const suggested = analysis.suggestedMetadata || {};
    const suggestionFields = buildSuggestionFields(suggested);

    el.innerHTML = `
      ${listSection('LIKELY STRENGTHS', analysis.strengths)}
      ${listSection('POTENTIAL WEAKNESSES', analysis.weaknesses)}
      ${listSection('BEST SITUATIONS', analysis.bestSituations)}
      <h3 style="margin: var(--space-2) 0 8px 0; font-size:15px;">COVERAGE FIT</h3>
      ${['man', 'zone', 'pressure'].map((k) => coverageRowHtml(k, analysis.coverageFit?.[k])).join('')}
      ${suggestionFields.length > 0 ? `
        <h3 style="margin: var(--space-2) 0 8px 0; font-size:15px;">SIDELINEX SUGGESTS</h3>
        <div class="row-wrap" id="suggestion-chips" style="margin-bottom:var(--space-2);">
          ${suggestionFields.map((f) => `<button type="button" class="chip selected" data-suggestion="${escapeAttr(f.key)}">${escapeHtml(f.label)}</button>`).join('')}
        </div>
        <p class="hint" style="margin-bottom:8px;">All selected by default — tap any to leave it out, then apply.</p>
        <button type="button" class="btn btn-primary btn-large" id="apply-suggestions" style="width:100%;">Apply Selected</button>
      ` : ''}
    `;

    if (suggestionFields.length > 0) {
      el.querySelectorAll('[data-suggestion]').forEach((chip) => {
        chip.addEventListener('click', () => chip.classList.toggle('selected'));
      });
      el.querySelector('#apply-suggestions').addEventListener('click', () => {
        const selectedKeys = new Set(
          [...el.querySelectorAll('[data-suggestion].selected')].map((c) => c.dataset.suggestion)
        );
        applySuggestions(suggestionFields.filter((f) => selectedKeys.has(f.key)));
      });
    }
  }

  function listSection(title, items) {
    if (!items || items.length === 0) return '';
    return `
      <h3 style="margin: var(--space-2) 0 8px 0; font-size:15px;">${title}</h3>
      <ul style="margin:0 0 0 20px; padding:0;">
        ${items.map((s) => `<li style="margin-bottom:4px;">${escapeHtml(s)}</li>`).join('')}
      </ul>
    `;
  }

  function coverageRowHtml(key, fit) {
    if (!fit) return '';
    const colors = { HIGH: 'var(--sx-gold)', MEDIUM: 'var(--sx-silver)', LIMITED: 'var(--sx-silver-dim)' };
    return `
      <div class="card" style="background:var(--sx-charcoal-2); margin-bottom:8px; padding:10px 14px;">
        <p style="margin:0; font-weight:800;">${key.toUpperCase()} — <span style="color:${colors[fit.confidence] || 'var(--sx-silver)'};">${escapeHtml(fit.confidence)}</span></p>
        <p class="hint" style="margin:4px 0 0 0;">${escapeHtml(fit.why)}</p>
      </div>
    `;
  }

  /**
   * Only ever proposes filling a field that's currently EMPTY — the AI
   * autofill must never silently overwrite football information the
   * coach already entered, matching the same rule already applied to
   * Designer->Intent and Designer->Assignment auto-population.
   */
  function buildSuggestionFields(suggested) {
    const fields = [];
    const categorySelect = root.querySelector('select[name="category"]');
    if (suggested.category && categorySelect && !categorySelect.value) {
      fields.push({ key: 'category', label: `Category: ${suggested.category}`, apply: () => { categorySelect.value = suggested.category; } });
    }
    const riskSelect = root.querySelector('select[name="riskLevel"]');
    if (suggested.riskLevel && riskSelect) {
      fields.push({ key: 'riskLevel', label: `Risk: ${suggested.riskLevel}`, apply: () => { riskSelect.value = suggested.riskLevel; } });
    }
    if (suggested.yardageDepth) {
      const alreadySet = root.querySelector('.chip[data-field="yardageDepth"].selected');
      if (!alreadySet) {
        fields.push({
          key: 'yardageDepth',
          label: `Depth: ${suggested.yardageDepth}`,
          apply: () => {
            root.querySelectorAll('.chip[data-field="yardageDepth"]').forEach((c) => {
              c.classList.toggle('selected', c.dataset.value === suggested.yardageDepth);
            });
          },
        });
      }
    }
    Object.entries(suggested.tags || {}).forEach(([tagKey, val]) => {
      if (!val) return;
      const chip = root.querySelector(`.chip[data-field="${tagKey}"]`);
      if (chip && !chip.classList.contains('selected')) {
        fields.push({ key: `tag_${tagKey}`, label: TAG_LABELS[tagKey] || tagKey, apply: () => chip.classList.add('selected') });
      }
    });
    ['vsMan', 'vsZone', 'vsPressure'].forEach((field) => {
      const val = suggested.effectiveness?.[field];
      const select = root.querySelector(`select[name="${field}"]`);
      if (val && select && !select.value) {
        fields.push({ key: field, label: `${field}: ${val}`, apply: () => { select.value = val; } });
      }
    });
    if (suggested.primaryTargetSlot) {
      const input = root.querySelector('#primaryTargetSlot');
      if (input && !input.value.trim()) {
        fields.push({ key: 'primaryTargetSlot', label: `Primary: ${suggested.primaryTargetSlot}`, apply: () => { input.value = suggested.primaryTargetSlot; } });
      }
    }
    if (suggested.secondaryTargetSlot) {
      const input = root.querySelector('#secondaryTargetSlot');
      if (input && !input.value.trim()) {
        fields.push({ key: 'secondaryTargetSlot', label: `Secondary: ${suggested.secondaryTargetSlot}`, apply: () => { input.value = suggested.secondaryTargetSlot; } });
      }
    }
    if (Array.isArray(suggested.decoySlots) && suggested.decoySlots.length > 0) {
      const input = root.querySelector('#decoySlots');
      if (input && !input.value.trim()) {
        fields.push({ key: 'decoySlots', label: `Decoy: ${suggested.decoySlots.join(', ')}`, apply: () => { input.value = suggested.decoySlots.join(', '); } });
      }
    }
    return fields;
  }

  function applySuggestions(fields) {
    fields.forEach((f) => f.apply());
    const banner = document.createElement('p');
    banner.className = 'success';
    banner.style.marginTop = '8px';
    banner.textContent = `Applied ${fields.length} suggestion${fields.length === 1 ? '' : 's'}.`;
    root.querySelector('#analyze-results').appendChild(banner);
  }

  function syncIntentFromDesigner(design) {
    const primary = Object.entries(design.routes).find(([, r]) => r.designation === 'primary')?.[0];
    const secondary = Object.entries(design.routes).find(([, r]) => r.designation === 'secondary')?.[0];
    const decoys = Object.entries(design.routes).filter(([, r]) => r.designation === 'decoy').map(([slot]) => slot);
    if (primary) root.querySelector('#primaryTargetSlot').value = primary;
    if (secondary) root.querySelector('#secondaryTargetSlot').value = secondary;
    if (decoys.length) root.querySelector('#decoySlots').value = decoys.join(', ');
  }

  /**
   * If the Designer already knows a slot's route type (e.g. WR1 = Go) or
   * designation (primary/secondary/decoy), pre-fills the matching
   * Assignment block field with that — but ONLY when the field is
   * currently empty. A coach who already typed their own description (or
   * picked a more specific Role like "Checkdown") never gets it silently
   * replaced; this only ever fills in a genuinely blank field.
   */
  function syncAssignmentDefaultsFromDesigner(design) {
    Object.entries(design.routes || {}).forEach(([slot, route]) => {
      const block = root.querySelector(`#assignment-blocks [data-slot="${cssEscape(slot)}"]`);
      if (!block) return;

      const routeInput = block.querySelector('[data-assign-field="route"]');
      if (routeInput && !routeInput.value.trim() && route?.routeType) {
        routeInput.value = capitalize(route.routeType);
      }

      const roleSelect = block.querySelector('[data-assign-field="roleClassification"]');
      if (roleSelect && !roleSelect.value) {
        const inferred = route?.designation ? DESIGNATION_TO_ROLE[route.designation] : (slot === 'QB' && !route?.points ? 'qb' : null);
        if (inferred) roleSelect.value = inferred;
      }
    });
  }

  /**
   * Suggests Intended Yardage from the primary target's actual route
   * depth — the Designer already has this data (start position + drawn
   * endpoint); no reason to make the coach estimate and type it again.
   * Only ever fills a blank field, never overwrites a coach's own number.
   */
  function suggestIntendedYardage(design) {
    const yardageInput = root.querySelector('input[name="intendedYardage"]');
    if (!yardageInput || yardageInput.value.trim()) return;
    const primaryEntry = Object.entries(design.routes || {}).find(([, r]) => r.designation === 'primary');
    if (!primaryEntry) return;
    const [slot, route] = primaryEntry;
    const start = design.positions?.[slot];
    const end = route.endPoint || (route.points && route.points[route.points.length - 1]);
    if (!start || !end) return;
    yardageInput.value = approxYardsFromDelta(start, end);
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
      if (diagramUploadPromise) {
        submitBtn.textContent = 'Waiting for image upload…';
        await diagramUploadPromise;
      }

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
        diagramUrl: diagramUrl || null,
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

function capitalize(str) {
  const s = String(str ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
