import { listPlays, getActiveVersion, listActivePlayers, getWeeklyRoles, setWeeklyRoles } from '../../data.js';
import { deriveUsedSlots, findRoleConflicts } from '../../playbook/roleResolution.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

// Weekly Roles: map roster players onto whatever slot labels the
// Playbook actually uses (QB/C/WR1/WR2/WR3, or anything a coach named
// freely in the Designer) — never a hardcoded list, so this works
// unchanged for 5v5/6v6/7v7 or any future format. Slots come from the
// WHOLE active Playbook, not just this game's Game Plan, so a coach can
// do Weekly Roles before or after picking this week's plays.
export async function renderWeeklyRolesView(root, team, claims, gameId) {
  root.innerHTML = `<p class="hint">Loading roster and playbook...</p>`;

  const [players, offensePlays, defensePlays, roles] = await Promise.all([
    listActivePlayers(claims.teamId),
    listPlays(claims.teamId, { side: 'offense' }),
    listPlays(claims.teamId, { side: 'defense' }),
    getWeeklyRoles(claims.teamId, gameId),
  ]);

  const allPlays = [...offensePlays, ...defensePlays];
  const versions = await Promise.all(
    allPlays.map((p) => (p.activeVersionId ? getActiveVersion(claims.teamId, p.id, p.activeVersionId) : null))
  );
  const playsWithSlots = allPlays.map((p, i) => ({
    side: p.side,
    slots: Object.keys(versions[i]?.fieldDesign?.positions || {}),
  }));
  const usedSlots = deriveUsedSlots(playsWithSlots);

  // Working copy — only written to Firestore on explicit Save, so a coach
  // can freely tap around without partial/half-set state landing live.
  const working = { offense: { ...roles.offense }, defense: { ...roles.defense } };

  render();

  function render() {
    root.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:var(--space-2);">
        <p class="hint" style="margin:0;">Tap a player for each spot. Change this any week without touching the Playbook.</p>
        ${helpButtonHtml('weeklyRoles')}
      </div>
      ${sideSection('Offense', 'offense', usedSlots.offense)}
      ${sideSection('Defense', 'defense', usedSlots.defense)}
      <button type="button" id="wr-save" class="btn btn-primary btn-large" style="width:100%; margin-top:var(--space-2);">Save Weekly Roles</button>
      <p id="wr-saved-msg" class="success" hidden style="text-align:center; margin-top:8px;">Saved.</p>
    `;
    wireCoachHelpButtons(root);

    root.querySelectorAll('[data-slot-side][data-slot]').forEach((chipRow) => {
      const side = chipRow.dataset.slotSide;
      const slot = chipRow.dataset.slot;
      chipRow.querySelectorAll('[data-player-chip]').forEach((chip) => {
        chip.addEventListener('click', () => {
          const playerId = chip.dataset.playerChip;
          working[side][slot] = working[side][slot] === playerId ? null : playerId;
          render();
        });
      });
    });

    root.querySelector('#wr-save').addEventListener('click', async () => {
      await setWeeklyRoles(claims.teamId, gameId, working);
      const msg = root.querySelector('#wr-saved-msg');
      msg.hidden = false;
      setTimeout(() => { msg.hidden = true; }, 2000);
    });
  }

  function sideSection(label, sideKey, slots) {
    if (slots.length === 0) {
      return `<div class="card"><h2>${label}</h2><p class="hint" style="margin:0;">No plays with players drawn on this side yet — build a play in the Playbook first.</p></div>`;
    }
    const conflicts = findRoleConflicts(working[sideKey]);
    return `
      <div class="card">
        <h2>${label}</h2>
        ${conflicts.length > 0 ? `
          <p class="hint" style="color:var(--sx-error); margin-bottom:var(--space-2);">
            &#9888; Same player set for more than one spot: ${conflicts.map((c) => `${escapeHtml(playerName(c.playerId))} (${c.slots.join(', ')})`).join('; ')}
          </p>
        ` : ''}
        ${slots.map((slot) => slotRow(sideKey, slot)).join('')}
      </div>
    `;
  }

  function slotRow(sideKey, slot) {
    const current = working[sideKey][slot];
    return `
      <div style="margin-bottom: var(--space-2);">
        <p class="hint" style="margin:0 0 6px 0;">${escapeHtml(slot)}${current ? ` &mdash; <span style="color:var(--sx-gold);">${escapeHtml(playerName(current))}</span>` : ''}</p>
        <div class="row-wrap" data-slot-side="${sideKey}" data-slot="${escapeAttr(slot)}">
          ${players.map((p) => `
            <button type="button" class="chip ${current === p.id ? 'selected' : ''}" data-player-chip="${p.id}">${escapeHtml(p.firstName)}${p.jerseyNumber != null ? ' #' + p.jerseyNumber : ''}</button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function playerName(playerId) {
    const p = players.find((x) => x.id === playerId);
    return p ? p.firstName : 'Unknown';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str ?? '');
}
