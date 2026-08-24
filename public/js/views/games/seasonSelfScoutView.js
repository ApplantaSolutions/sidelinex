import { listGames, listActivePlayers, listSnaps } from '../../data.js';
import { deriveSeasonRollup, derivePlayTrend, derivePlayerTargetTrend } from '../../postgame/seasonSelfScout.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

/**
 * Season Self-Scout V1 — deliberately simple. Reuses the exact same
 * postgame analytics functions a single game's report uses, just fed
 * every ENDED game's snaps concatenated. "Architecture must support
 * Game -> Season -> future multi-season" is satisfied by this reuse, not
 * by a separate, parallel analytics system that could drift from the
 * per-game numbers.
 */
export async function renderSeasonSelfScoutView(root, team, claims, onBack) {
  root.innerHTML = `<p class="hint">Loading Season Self-Scout...</p>`;
  const teamId = claims.teamId;

  const [allGames, players] = await Promise.all([listGames(teamId), listActivePlayers(teamId)]);
  const endedGames = allGames.filter((g) => g.ended).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  if (endedGames.length === 0) {
    root.innerHTML = `
      <button type="button" class="btn btn-link" id="ssc-back" style="padding-left:0;">&larr; Back to Games</button>
      <div class="card">
        <h2>Season Self-Scout</h2>
        <p class="hint" style="margin:8px 0 0 0;">No completed games yet — end a game from its Game Day tab to start building season totals.</p>
      </div>
    `;
    root.querySelector('#ssc-back').addEventListener('click', onBack);
    return;
  }

  const gamesInOrder = await Promise.all(endedGames.map(async (g) => ({
    gameId: g.id,
    label: g.name || g.id,
    snaps: (await listSnaps(teamId, g.id)).filter((s) => !s.voided),
  })));

  const rollup = deriveSeasonRollup(gamesInOrder);

  root.innerHTML = `
    <button type="button" class="btn btn-link" id="ssc-back" style="padding-left:0;">&larr; Back to Games</button>
    <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:var(--space-2);">
      <h1 style="font-size:20px; margin:0;">Season Self-Scout</h1>
      ${helpButtonHtml('seasonSelfScout')}
    </div>
    <p class="hint" style="margin:0 0 var(--space-2) 0;">Across ${rollup.gamesIncluded} completed game${rollup.gamesIncluded === 1 ? '' : 's'} &middot; ${rollup.totalSnaps} total snaps.</p>

    <div class="card" style="margin-bottom:var(--space-2);">
      <h2>Team Totals</h2>
      <p style="margin:0;">Run / Pass: ${rollup.runPassDistribution.run} / ${rollup.runPassDistribution.pass}${rollup.runPassDistribution.runShare != null ? ` (${(rollup.runPassDistribution.runShare * 100).toFixed(0)}% run)` : ''}</p>
      ${Object.values(rollup.teamDefensiveSplits.byLook).length > 0 ? `<p style="margin:4px 0 0 0;">Based on ${rollup.teamDefensiveSplits.trackedSnaps} of ${rollup.teamDefensiveSplits.totalSnaps} tracked snaps: ${Object.values(rollup.teamDefensiveSplits.byLook).map((l) => `${escapeHtml(l.look)} (${l.snaps})`).join(', ')}</p>` : ''}
    </div>

    <div class="card" style="margin-bottom:var(--space-2);">
      <h2>Player Season Stats</h2>
      ${playersHtml()}
    </div>

    <div class="card" style="margin-bottom:var(--space-2);">
      <h2>Play Season Stats</h2>
      ${playsHtml()}
    </div>

    <div class="card">
      <h2>Game-to-Game Trends</h2>
      <p class="hint" style="margin:0 0 8px 0;">Only shown where at least 2 games of real data exist.</p>
      ${trendsHtml()}
    </div>
  `;
  wireCoachHelpButtons(root);
  root.querySelector('#ssc-back').addEventListener('click', onBack);

  function playerName(id) {
    return players.find((p) => p.id === id)?.firstName || 'Unknown';
  }

  function playersHtml() {
    const ids = new Set([...Object.keys(rollup.playerPerformance.passing), ...Object.keys(rollup.playerPerformance.receiving), ...Object.keys(rollup.playerPerformance.rushing)]);
    if (ids.size === 0) return '<p class="hint" style="margin:0;">No player stats yet.</p>';
    return [...ids].map((id) => {
      const r = rollup.playerPerformance.receiving[id];
      const ru = rollup.playerPerformance.rushing[id];
      const share = rollup.targetShares[id];
      return `
        <p style="margin:0 0 6px 0;"><b>${escapeHtml(playerName(id))}</b>${r ? ` — ${r.catches} catches on ${r.targets} targets, ${r.receivingYards} yds${share?.targetShare != null ? ` (${(share.targetShare * 100).toFixed(0)}% of season targets)` : ''}` : ''}${ru ? ` &middot; ${ru.carries} carries, ${ru.rushingYards} yds` : ''}</p>
      `;
    }).join('');
  }

  function playsHtml() {
    const ids = Object.keys(rollup.playPerformance);
    if (ids.length === 0) return '<p class="hint" style="margin:0;">No plays logged yet.</p>';
    return ids.map((id) => {
      const p = rollup.playPerformance[id];
      return `<p style="margin:0 0 6px 0;"><b>${escapeHtml(id)}</b> — ${p.timesCalled} calls, ${p.averageGain != null ? p.averageGain.toFixed(1) : '—'} avg yds, ${p.successes}/${p.timesCalled} successful</p>`;
    }).join('');
  }

  function trendsHtml() {
    const topPlayIds = Object.values(rollup.playPerformance).sort((a, b) => b.timesCalled - a.timesCalled).slice(0, 3).map((p) => p.playId);
    const playTrends = topPlayIds.map((id) => derivePlayTrend(gamesInOrder, id)).filter((t) => t.sufficientData);

    const topPlayerIds = Object.values(rollup.playerPerformance.receiving).sort((a, b) => b.targets - a.targets).slice(0, 3).map((r) => r.playerId);
    const playerTrends = topPlayerIds.map((id) => derivePlayerTargetTrend(gamesInOrder, id)).filter((t) => t.sufficientData);

    if (playTrends.length === 0 && playerTrends.length === 0) return '<p class="hint" style="margin:0;">Not enough games yet for a real trend.</p>';

    return `
      ${playTrends.map((t) => `<p style="margin:0 0 6px 0;"><b>${escapeHtml(t.playId)}</b> avg yds: ${t.points.map((p) => p.averageGain.toFixed(1)).join(' &rarr; ')}</p>`).join('')}
      ${playerTrends.map((t) => `<p style="margin:0 0 6px 0;"><b>${escapeHtml(playerName(t.playerId))}</b> targets: ${t.points.map((p) => p.targets).join(' &rarr; ')}</p>`).join('')}
    `;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
