import { listPractices, listEvaluations, listGames, getWeeklyRoles, listSnaps } from '../../data.js';
import { resolveAssignmentPlayerIds } from '../../practice/practiceLogic.js';
import { derivePlayerPerformance } from '../../postgame/postgameAnalytics.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

const EXECUTION_LABELS = { needs_work: 'Needs Work', developing: 'Developing', solid: 'Solid', strong: 'Strong' };
const EFFORT_LABELS = { needs_work: 'Needs Work', solid: 'Solid', strong: 'Strong' };
const UNDERSTANDING_LABELS = { needs_help: 'Needs Help', getting_it: 'Getting It', ready: 'Ready' };

/**
 * Coach-only. Deliberately keeps GAME PERFORMANCE (from real logged
 * snaps, objective) and PRACTICE OBSERVATIONS (coach's own subjective
 * notes) in clearly separate sections — the roadmap is explicit that
 * these are not the same measurement and must never be blended into one
 * score.
 */
export async function renderPlayerDevelopmentView(root, team, claims, player, onBack) {
  root.innerHTML = `<p class="hint">Loading development history...</p>`;
  const teamId = claims.teamId;

  const [practices, evaluations, allGames] = await Promise.all([
    listPractices(teamId),
    listEvaluations(teamId, player.id),
    listGames(teamId),
  ]);
  const latestGame = allGames[0] || null;
  const weeklyRoles = latestGame ? await getWeeklyRoles(teamId, latestGame.id) : { offense: {}, defense: {} };

  const attendedPractices = practices.filter((p) => p.attendance?.[player.id] === 'PRESENT');
  const relevantBlocks = [];
  practices.forEach((p) => {
    (p.blocks || []).forEach((b) => {
      if (resolveAssignmentPlayerIds(b, [player], weeklyRoles).includes(player.id)) {
        relevantBlocks.push({ practiceDate: p.date, practiceTitle: p.title, block: b });
      }
    });
  });
  relevantBlocks.sort((a, b) => (b.practiceDate || '').localeCompare(a.practiceDate || ''));

  const endedGames = allGames.filter((g) => g.ended);
  const gameSnaps = (await Promise.all(endedGames.map((g) => listSnaps(teamId, g.id)))).flat().filter((s) => !s.voided);
  const perf = derivePlayerPerformance(gameSnaps);
  const receiving = perf.receiving[player.id];
  const rushing = perf.rushing[player.id];
  const passing = perf.passing[player.id];

  root.innerHTML = `
    <button type="button" class="btn btn-link" id="pd-back" style="padding-left:0;">&larr; Back to Roster</button>
    <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:var(--space-2);">
      <h1 style="font-size:20px; margin:0;">${escapeHtml(player.firstName)} ${escapeHtml(player.lastInitial || '')}</h1>
      ${helpButtonHtml('playerDevelopment')}
    </div>

    <div class="card" style="margin-bottom:var(--space-2);">
      <h2>Practice Attendance</h2>
      <p style="margin:0;">${attendedPractices.length} of ${practices.length} practice${practices.length === 1 ? '' : 's'} attended.</p>
    </div>

    <div class="card" style="margin-bottom:var(--space-2);">
      <h2>Recent Assignments</h2>
      ${relevantBlocks.length === 0 ? '<p class="hint" style="margin:0;">No practice assignments recorded yet.</p>' : relevantBlocks.slice(0, 6).map((r) => `
        <p style="margin:0 0 6px 0;">${escapeHtml(formatDate(r.practiceDate))} &mdash; ${escapeHtml(r.block.label)}${r.block.focusArea ? ` (${escapeHtml(r.block.focusArea)})` : ''}</p>
      `).join('')}
    </div>

    <div class="card" style="margin-bottom:var(--space-2);">
      <h2>Practice Observations</h2>
      <p class="hint" style="margin:0 0 8px 0;">Coach notes over time — not permanent labels, and separate from game statistics below.</p>
      ${evaluations.length === 0 ? '<p class="hint" style="margin:0;">No observations recorded yet.</p>' : evaluations.map((ev) => `
        <div style="padding:8px 0; border-bottom:1px solid var(--sx-gold-border);">
          <p style="margin:0 0 4px 0; font-weight:700;">${escapeHtml(formatDate(ev.date))}</p>
          <p class="hint" style="margin:0;">
            ${ev.execution ? `Execution: ${EXECUTION_LABELS[ev.execution] || ev.execution}` : ''}
            ${ev.effort ? ` &middot; Effort: ${EFFORT_LABELS[ev.effort] || ev.effort}` : ''}
            ${ev.understanding ? ` &middot; Understanding: ${UNDERSTANDING_LABELS[ev.understanding] || ev.understanding}` : ''}
          </p>
          ${ev.note ? `<p style="margin:4px 0 0 0;">${escapeHtml(ev.note)}</p>` : ''}
        </div>
      `).join('')}
    </div>

    <div class="card">
      <h2>Game Statistics</h2>
      <p class="hint" style="margin:0 0 8px 0;">From ${endedGames.length} completed game${endedGames.length === 1 ? '' : 's'} — real logged data, kept separate from practice observations above.</p>
      ${!receiving && !rushing && !passing ? '<p class="hint" style="margin:0;">No game stats recorded yet.</p>' : `
        ${passing ? `<p style="margin:0 0 4px 0;">Passing: ${passing.completions}/${passing.attempts}, ${passing.passingYards} yds${passing.touchdowns ? `, ${passing.touchdowns} TD` : ''}</p>` : ''}
        ${receiving ? `<p style="margin:0 0 4px 0;">Receiving: ${receiving.catches}/${receiving.targets} targets, ${receiving.receivingYards} yds, ${receiving.drops} drop${receiving.drops === 1 ? '' : 's'}${receiving.touchdowns ? `, ${receiving.touchdowns} TD` : ''}</p>` : ''}
        ${rushing ? `<p style="margin:0;">Rushing: ${rushing.carries} carries, ${rushing.rushingYards} yds${rushing.touchdowns ? `, ${rushing.touchdowns} TD` : ''}</p>` : ''}
      `}
    </div>
  `;
  wireCoachHelpButtons(root);
  root.querySelector('#pd-back').addEventListener('click', onBack);
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
