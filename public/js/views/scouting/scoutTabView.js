import { getGame, updateGame, listScouts, getScout, createScout, updateScout } from '../../data.js';
import { renderScoutEditor } from './scoutEditorView.js';
import { labelFor, DEFENSIVE_LOOKS, TENDENCY_TAGS, SITUATIONS } from '../../scouting/scoutingTaxonomy.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

/**
 * Game Detail's "Scout" sub-tab: pick/attach an existing opponent scout,
 * create a new one, or edit the one already attached to this game. Scouts
 * live at the team level (models/scout.js) and are only ever REFERENCED
 * from a Game via game.scoutId — never copied — so the same opponent
 * profile is reusable if the team plays them again.
 */
export async function renderScoutTabView(root, team, claims, gameId) {
  root.innerHTML = `<p class="hint">Loading scouting data...</p>`;
  const teamId = claims.teamId;

  const [game, scouts] = await Promise.all([getGame(teamId, gameId), listScouts(teamId)]);
  let attachedScout = game?.scoutId ? await getScout(teamId, game.scoutId) : null;

  render();

  function render() {
    if (attachedScout) return renderSummary();
    return renderPicker();
  }

  function renderPicker() {
    root.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:var(--space-2);">
        <p class="hint" style="margin:0;">No opponent scout attached to this game yet.</p>
        ${helpButtonHtml('opponentScout')}
      </div>
      ${scouts.length > 0 ? `
        <div class="card" style="margin-bottom:var(--space-2);">
          <h2>Attach an Existing Scout</h2>
          <ul class="roster-list">
            ${scouts.map((s) => `<li class="play-card" data-attach-scout="${s.id}" style="cursor:pointer;"><div class="play-card-main"><div class="play-card-name">${escapeHtml(s.opponentName)}</div></div></li>`).join('')}
          </ul>
        </div>
      ` : ''}
      <button type="button" class="btn btn-primary btn-large" id="scout-new" style="width:100%;">+ New Opponent Scout</button>
    `;
    wireCoachHelpButtons(root);
    root.querySelectorAll('[data-attach-scout]').forEach((li) => {
      li.addEventListener('click', () => attach(li.dataset.attachScout));
    });
    root.querySelector('#scout-new').addEventListener('click', () => openEditor(null));
  }

  function renderSummary() {
    const s = attachedScout;
    const baseLookLabel = s.pregameTendencies?.baseLook ? labelFor(DEFENSIVE_LOOKS, s.pregameTendencies.baseLook) : 'Not set';
    root.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:var(--space-2);">
        <p class="hint" style="margin:0;">Attached to this game:</p>
        ${helpButtonHtml('opponentScout')}
      </div>
      <div class="card card-gold" style="margin-bottom:var(--space-2);">
        <h2>${escapeHtml(s.opponentName)}</h2>
        ${s.notes ? `<p class="hint" style="margin:0 0 8px 0;">${escapeHtml(s.notes)}</p>` : ''}
        <p style="margin:0;">Base Look: <b style="color:var(--sx-gold);">${escapeHtml(baseLookLabel)}</b></p>
        <p style="margin:2px 0 0 0;">${(s.pregameTendencies?.tendencyTags || []).length} tendency tag(s) &middot; ${(s.pregameTendencies?.rusherTags || []).length} rusher tag(s)</p>
        <p style="margin:2px 0 0 0;">${(s.playmakers || []).length} playmaker(s) &middot; ${(s.savedAlignments || []).length} saved alignment(s) &middot; ${(s.situationalTendencies || []).length} situational tendenc${(s.situationalTendencies || []).length === 1 ? 'y' : 'ies'}</p>
      </div>
      ${(s.situationalTendencies || []).length > 0 ? `
        <div class="card" style="margin-bottom:var(--space-2);">
          <h2>Situational Tendencies</h2>
          ${s.situationalTendencies.map((t) => `<p style="margin:0 0 4px 0;">${escapeHtml(labelFor(SITUATIONS, t.situation))}: <b>${escapeHtml(labelFor([...DEFENSIVE_LOOKS, ...TENDENCY_TAGS], t.tendency))}</b></p>`).join('')}
        </div>
      ` : ''}
      <div class="row-wrap">
        <button type="button" class="btn btn-secondary" id="scout-edit" style="flex:1;">&#9998; Edit</button>
        <button type="button" class="btn btn-secondary" id="scout-change" style="flex:1;">&#128260; Change Opponent</button>
      </div>
    `;
    wireCoachHelpButtons(root);
    root.querySelector('#scout-edit').addEventListener('click', () => openEditor(attachedScout));
    root.querySelector('#scout-change').addEventListener('click', async () => {
      await updateGame(teamId, gameId, { scoutId: null });
      attachedScout = null;
      render();
    });
  }

  async function attach(scoutId) {
    await updateGame(teamId, gameId, { scoutId });
    attachedScout = await getScout(teamId, scoutId);
    render();
  }

  function openEditor(existing) {
    renderScoutEditor(root, existing, {
      onCancel: render,
      onSave: async (working) => {
        let scoutId = existing?.id;
        if (scoutId) {
          await updateScout(teamId, scoutId, working);
        } else {
          const created = await createScout(teamId, working);
          scoutId = created.id;
          scouts.push({ id: scoutId, ...working });
        }
        await updateGame(teamId, gameId, { scoutId });
        attachedScout = await getScout(teamId, scoutId);
        render();
      },
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
