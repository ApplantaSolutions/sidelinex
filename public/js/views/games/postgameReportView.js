import {
  getGame, getGamePlan, getWeeklyRoles, listPlays, getActiveVersion, listActivePlayers,
  getRuleConfig, getGameDayMeta, listSnaps, listRecommendations, addPracticeIdea,
} from '../../data.js';
import { getPostgameSummary } from '../../auth.js';
import { resolvePlayerForSlot } from '../../playbook/roleResolution.js';
import {
  deriveGameSummary, derivePlayerPerformance, deriveTargetShares, derivePlayPerformance,
  derivePrimaryTargetPerformanceForPlay, deriveTeamDefensiveSplits, deriveRunPassDistribution,
  derivePhaseDistribution, deriveConversionCallTendency, deriveCallFrequencyRanking,
  deriveAdvisorVsCoach, deriveWorkedAndReview, derivePracticeSuggestions,
} from '../../postgame/postgameAnalytics.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

const SECTION_IDS = ['summary', 'players', 'plays', 'defense', 'selfscout', 'practice'];

/**
 * Postgame Analytics V1. Purely a READ + COMPUTE view — nothing here is
 * ever stored. Every number is recomputed fresh from Snap/Game/
 * Recommendation records each time this opens, which is exactly what
 * makes a completed game's report always reproducible and reopenable
 * without drift.
 */
export async function renderPostgameReportView(root, team, claims, gameId) {
  root.innerHTML = `<p class="hint">Loading Postgame Report...</p>`;
  const teamId = claims.teamId;

  let game, entries, playsById, players, ruleConfig, weeklyRoles, meta, snaps, recommendations;
  try {
    [game, { entries }, weeklyRoles = { offense: {}, defense: {} }, players, ruleConfig, meta] = await Promise.all([
      getGame(teamId, gameId),
      getGamePlan(teamId, gameId),
      getWeeklyRoles(teamId, gameId),
      listActivePlayers(teamId),
      getRuleConfig(teamId),
      getGameDayMeta(teamId, gameId),
    ]);
    const [allOffense, allDefense] = await Promise.all([
      listPlays(teamId, { side: 'offense' }),
      listPlays(teamId, { side: 'defense' }),
    ]);
    const allPlays = [...allOffense, ...allDefense];
    const versions = await Promise.all(allPlays.map((p) => (p.activeVersionId ? getActiveVersion(teamId, p.id, p.activeVersionId) : null)));
    playsById = {};
    allPlays.forEach((p, i) => { playsById[p.id] = { play: p, version: versions[i] }; });

    const [allSnaps, allRecs] = await Promise.all([listSnaps(teamId, gameId), listRecommendations(teamId, gameId)]);
    snaps = allSnaps.filter((s) => !s.voided);
    recommendations = allRecs;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Postgame Report failed to load:', err);
    root.innerHTML = `
      <div class="card" style="border-color:var(--sx-error);">
        <h2 style="color:var(--sx-error);">Couldn't load Postgame Report</h2>
        <p class="hint" style="margin:8px 0;">${escapeHtml(err.message || 'Something went wrong.')}</p>
        <button type="button" class="btn btn-primary btn-large" id="pg-retry" style="width:100%;">Try Again</button>
      </div>
    `;
    root.querySelector('#pg-retry').addEventListener('click', () => renderPostgameReportView(root, team, claims, gameId));
    return;
  }

  if (!game?.ended) {
    root.innerHTML = `
      <div class="card">
        <h2>Postgame Report</h2>
        <p class="hint" style="margin:8px 0 0 0;">This game hasn't ended yet. Use <b>&#127937; End Game</b> on the Game Day tab once it's over to generate the report.</p>
      </div>
    `;
    return;
  }

  const startingPossession = meta?.startingPossession || 'us';
  const summary = deriveGameSummary(snaps, ruleConfig, startingPossession);
  const { passing, receiving, rushing } = derivePlayerPerformance(snaps);
  const targetShares = deriveTargetShares(receiving);
  const playStats = derivePlayPerformance(snaps);
  const teamDefensiveSplits = deriveTeamDefensiveSplits(snaps);
  const runPass = deriveRunPassDistribution(snaps);
  const phaseDist = derivePhaseDistribution(snaps, ruleConfig, startingPossession);
  const conversionTendency = deriveConversionCallTendency(snaps, ruleConfig, startingPossession);
  const callFreq = deriveCallFrequencyRanking(playStats);
  const advisorVsCoach = deriveAdvisorVsCoach(recommendations, snaps);
  const { worked, review } = deriveWorkedAndReview(playStats, receiving);
  const practiceSuggestions = derivePracticeSuggestions(review, teamDefensiveSplits);

  const expanded = new Set(['summary']);
  let aiSummary = null;
  let aiSummaryState = 'idle'; // 'idle' | 'loading' | 'done' | 'failed'

  render();

  function render() {
    root.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:var(--space-2);">
        <h1 style="font-size:20px; margin:0;">Postgame Report</h1>
        ${helpButtonHtml('postgameReport')}
      </div>
      ${section('summary', 'Summary', summaryHtml())}
      ${section('players', 'Players', playersHtml())}
      ${section('plays', 'Plays', playsHtml())}
      ${section('defense', 'Defense', defenseHtml())}
      ${section('selfscout', 'Self-Scout', selfScoutHtml())}
      ${section('practice', 'Practice Ideas', practiceHtml())}
    `;
    wireCoachHelpButtons(root);
    wireSectionToggles();
    wirePracticeButtons();
    wireAiSummaryButton();
  }

  function section(id, title, bodyHtml) {
    const isOpen = expanded.has(id);
    return `
      <div class="card" style="margin-bottom:8px; padding:0; overflow:hidden;">
        <button type="button" class="btn" data-section-toggle="${id}" style="width:100%; text-align:left; background:transparent; border:none; padding:14px 16px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:800; text-transform:uppercase; font-size:15px;">${title}</span>
          <span class="hint">${isOpen ? '&minus;' : '+'}</span>
        </button>
        ${isOpen ? `<div style="padding:0 16px 16px 16px;">${bodyHtml}</div>` : ''}
      </div>
    `;
  }

  function wireSectionToggles() {
    root.querySelectorAll('[data-section-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.sectionToggle;
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        render();
      });
    });
  }

  // ---------- SUMMARY ----------

  function bigStat(label, value) {
    return `
      <div style="background:rgba(201,162,39,0.08); border-radius:8px; padding:10px;">
        <p class="hint" style="margin:0 0 2px 0;">${label}</p>
        <p style="margin:0; font-size:20px; font-weight:900;">${value}</p>
      </div>
    `;
  }

  function summaryHtml() {
    return `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        ${bigStat('Final Score', `${summary.score.us}&ndash;${summary.score.them}`)}
        ${bigStat('Total Snaps', summary.totalSnaps)}
        ${bigStat('Passing', `${summary.completions}/${summary.passAttempts} &middot; ${summary.passingYards} yds`)}
        ${bigStat('Rushing', `${summary.rushingYards} yds`)}
        ${bigStat('Touchdowns', summary.touchdowns)}
        ${bigStat('Turnovers', summary.turnovers)}
        ${bigStat('Conversions', summary.conversions)}
        ${bigStat('Offensive Success', `${summary.offensiveSuccess.successes}/${summary.offensiveSuccess.totalSnaps}`)}
      </div>
      <p class="hint" style="margin:10px 0 0 0;">Defensive looks tracked on ${summary.defensiveLooksTracked} of ${summary.defensiveLooksTotalSnaps} snaps.</p>
    `;
  }

  // ---------- PLAYERS ----------

  function playerName(id) {
    return players.find((p) => p.id === id)?.firstName || 'Unknown';
  }

  function playersHtml() {
    const ids = new Set([...Object.keys(passing), ...Object.keys(receiving), ...Object.keys(rushing)]);
    if (ids.size === 0) return '<p class="hint" style="margin:0;">No player stats recorded.</p>';
    return [...ids].map((id) => {
      const p = passing[id];
      const r = receiving[id];
      const ru = rushing[id];
      const share = targetShares[id];
      return `
        <div style="padding:10px 0; border-bottom:1px solid var(--sx-gold-border);">
          <p style="margin:0 0 4px 0; font-weight:800;">${escapeHtml(playerName(id))}</p>
          ${p ? `<p class="hint" style="margin:0;">Passing: ${p.completions}/${p.attempts}, ${p.passingYards} yds${p.touchdowns ? `, ${p.touchdowns} TD` : ''}</p>` : ''}
          ${r ? `<p class="hint" style="margin:0;">Receiving: ${r.targets} targets, ${r.catches} catches, ${r.drops} drops, ${r.receivingYards} yds, ${r.yardsPerCatch != null ? r.yardsPerCatch.toFixed(1) : '—'} yds/catch${r.touchdowns ? `, ${r.touchdowns} TD` : ''}${share?.targetShare != null ? ` &middot; ${(share.targetShare * 100).toFixed(0)}% of recorded targets (${r.targets}/${share.totalGameTargets})` : ''}</p>` : ''}
          ${ru ? `<p class="hint" style="margin:0;">Rushing: ${ru.carries} carries, ${ru.rushingYards} yds, ${ru.yardsPerCarry != null ? ru.yardsPerCarry.toFixed(1) : '—'} yds/carry${ru.touchdowns ? `, ${ru.touchdowns} TD` : ''}</p>` : ''}
        </div>
      `;
    }).join('');
  }

  // ---------- PLAYS ----------

  function playsHtml() {
    const ids = Object.keys(playStats);
    if (ids.length === 0) return '<p class="hint" style="margin:0;">No plays logged.</p>';
    return ids.map((id) => {
      const p = playStats[id];
      const play = playsById[id]?.play;
      const primarySlot = play?.intent?.primaryTargetSlot;
      const primaryPlayerId = primarySlot ? resolvePlayerForSlot(weeklyRoles, 'offense', primarySlot) : null;
      const primaryPerf = primaryPlayerId ? derivePrimaryTargetPerformanceForPlay(snaps, id, primaryPlayerId) : null;
      const lookBreakdown = Object.entries(p.byDefensiveLook).map(([look, l]) => `${l.timesCalled} vs ${escapeHtml(look)}`).join(' &middot; ');
      return `
        <div style="padding:10px 0; border-bottom:1px solid var(--sx-gold-border);">
          <p style="margin:0 0 4px 0; font-weight:800;">${escapeHtml(play?.wristbandCode || '--')} &mdash; ${escapeHtml(play?.name || id)}</p>
          <p class="hint" style="margin:0;">${p.timesCalled} call${p.timesCalled === 1 ? '' : 's'} &middot; ${p.averageGain != null ? p.averageGain.toFixed(1) : '—'} avg yds${p.completionRate != null ? ` &middot; ${p.completions}/${p.attempts} passing` : ''}${p.touchdowns ? ` &middot; ${p.touchdowns} TD` : ''} &middot; ${p.successes}/${p.timesCalled} successful</p>
          ${lookBreakdown ? `<p class="hint" style="margin:2px 0 0 0;">${lookBreakdown}</p>` : ''}
          ${primaryPerf ? `<p class="hint" style="margin:2px 0 0 0;">Primary target (${escapeHtml(playerName(primaryPlayerId))}): ${primaryPerf.catches}/${primaryPerf.targets}${primaryPerf.drops ? `, ${primaryPerf.drops} drop${primaryPerf.drops === 1 ? '' : 's'}` : ''}, ${primaryPerf.yards} yds</p>` : ''}
        </div>
      `;
    }).join('');
  }

  // ---------- DEFENSE ----------

  function defenseHtml() {
    const looks = Object.values(teamDefensiveSplits.byLook);
    return `
      <p class="hint" style="margin:0 0 10px 0;">Based on tracked snaps &mdash; ${teamDefensiveSplits.trackedSnaps} of ${teamDefensiveSplits.totalSnaps} total.</p>
      ${looks.length === 0 ? '<p class="hint" style="margin:0;">No defensive looks were tracked this game.</p>' : looks.sort((a, b) => b.snaps - a.snaps).map((l) => `
        <div style="padding:8px 0; border-bottom:1px solid var(--sx-gold-border);">
          <p style="margin:0; font-weight:800;">VS ${escapeHtml(l.look)}</p>
          <p class="hint" style="margin:0;">${l.snaps} snap${l.snaps === 1 ? '' : 's'} &middot; ${l.averageGain != null ? l.averageGain.toFixed(1) : '—'} avg yds &middot; ${l.successes}/${l.snaps} successful${l.touchdowns ? ` &middot; ${l.touchdowns} TD` : ''}</p>
        </div>
      `).join('')}
    `;
  }

  // ---------- SELF-SCOUT ----------

  function selfScoutHtml() {
    return `
      <h3 style="margin:0 0 6px 0;">Run / Pass</h3>
      <p class="hint" style="margin:0 0 12px 0;">${runPass.run} run${runPass.run === 1 ? '' : 's'} / ${runPass.pass} pass${runPass.pass === 1 ? '' : 'es'}${runPass.runShare != null ? ` &middot; ${(runPass.runShare * 100).toFixed(0)}% run` : ''}</p>

      <h3 style="margin:0 0 6px 0;">Before / After Midfield</h3>
      <p class="hint" style="margin:0 0 12px 0;">${phaseDist.toMidfield} call${phaseDist.toMidfield === 1 ? '' : 's'} to Midfield &middot; ${phaseDist.toScore} to Score</p>

      <h3 style="margin:0 0 6px 0;">Conversion Situations</h3>
      <p class="hint" style="margin:0 0 12px 0;">
        ${conversionTendency.totalConversionAttempts === 0 ? 'No tracked conversion attempts this game.' : Object.entries(conversionTendency.callCounts).map(([playId, count]) => `Potential tendency: ${escapeHtml(playsById[playId]?.play?.name || playId)} was called on ${count} of ${conversionTendency.totalConversionAttempts} tracked conversion attempts.`).join('<br/>')}
      </p>

      <h3 style="margin:0 0 6px 0;">Call Frequency</h3>
      <p class="hint" style="margin:0 0 4px 0;"><b>Most Called:</b> ${callFreq.mostCalled.map((p) => `${escapeHtml(playsById[p.playId]?.play?.name || p.playId)} (${p.timesCalled})`).join(', ') || '—'}</p>
      <p class="hint" style="margin:0 0 12px 0;"><b>Least Used:</b> ${callFreq.leastUsed.map((p) => `${escapeHtml(playsById[p.playId]?.play?.name || p.playId)} (${p.timesCalled})`).join(', ') || '—'}</p>

      <h3 style="margin:0 0 6px 0;">Advisor vs. Coach</h3>
      <p class="hint" style="margin:0 0 12px 0;">
        ${advisorVsCoach.totalTraceable === 0 ? 'No traceable Advisor recommendations this game.' : `Called an Advisor-suggested play on ${advisorVsCoach.matched} of ${advisorVsCoach.totalTraceable} traceable snaps.
        ${advisorVsCoach.overridden > 0 ? ` Chose outside the top options on ${advisorVsCoach.overridden}.${advisorVsCoach.overrideAvgYards != null ? ` Those calls averaged ${advisorVsCoach.overrideAvgYards.toFixed(1)} yds (sample: ${advisorVsCoach.overrideSampleSize}).` : ''}` : ''}`}
      </p>

      <h3 style="margin:0 0 6px 0; color:#4ade80;">Worked Well</h3>
      ${worked.length === 0 ? '<p class="hint" style="margin:0 0 12px 0;">Nothing yet cleared the sample-size bar to call out.</p>' : `<ul style="margin:0 0 12px 0; padding-left:18px;">${worked.map((w) => `<li class="hint">${workedReviewLine(w)}</li>`).join('')}</ul>`}

      <h3 style="margin:0 0 6px 0; color:#f59e0b;">Review</h3>
      ${review.length === 0 ? '<p class="hint" style="margin:0 0 12px 0;">Nothing flagged for review.</p>' : `<ul style="margin:0 0 12px 0; padding-left:18px;">${review.map((r) => `<li class="hint">${workedReviewLine(r)}</li>`).join('')}</ul>`}

      <button type="button" class="btn btn-secondary" id="pg-ai-summary-btn" ${aiSummaryState === 'loading' ? 'disabled' : ''}>
        ${aiSummaryState === 'loading' ? 'Generating…' : '&#129302; Get AI Coach Notes'}
      </button>
      ${aiSummaryState === 'done' && aiSummary ? `<p style="margin:10px 0 0 0; font-style:italic; color:var(--sx-gold);">${escapeHtml(aiSummary)}</p>` : ''}
      ${aiSummaryState === 'done' && !aiSummary ? '<p class="hint" style="margin:10px 0 0 0;">No AI summary available this time — the report above is already complete.</p>' : ''}
      ${aiSummaryState === 'failed' ? '<p class="hint" style="margin:10px 0 0 0;">AI summary unavailable right now — the report above is unaffected.</p>' : ''}
    `;
  }

  function workedReviewLine(item) {
    if (item.type === 'play') return `${escapeHtml(playsById[item.playId]?.play?.name || item.playId)}: ${item.timesCalled} calls, ${item.averageGain != null ? item.averageGain.toFixed(1) : '—'} avg yds`;
    if (item.type === 'receiver') return `${escapeHtml(playerName(item.playerId))}: ${item.catches} catches on ${item.targets} targets`;
    if (item.type === 'drops') return `${escapeHtml(playerName(item.playerId))}: ${item.drops} recorded drop${item.drops === 1 ? '' : 's'}`;
    return '';
  }

  function wireAiSummaryButton() {
    const btn = root.querySelector('#pg-ai-summary-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      aiSummaryState = 'loading';
      render();
      const postgameData = {
        summary, worked, review,
        runPass: { run: runPass.run, pass: runPass.pass, runShare: runPass.runShare },
        advisorVsCoach,
        practiceSuggestions: practiceSuggestions.map((s) => s.text),
      };
      try {
        const result = await getPostgameSummary(postgameData);
        aiSummary = result?.summary || null;
        aiSummaryState = 'done';
      } catch {
        aiSummaryState = 'failed';
      }
      render();
    });
  }

  // ---------- PRACTICE IDEAS ----------

  function practiceHtml() {
    return `
      ${practiceSuggestions.length === 0 ? '<p class="hint" style="margin:0 0 10px 0;">No suggestions from this game\'s data.</p>' : practiceSuggestions.map((s) => `
        <div class="row" style="justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--sx-gold-border);">
          <p style="margin:0;">${escapeHtml(s.text)}</p>
          <button type="button" class="btn btn-secondary" data-add-practice="${escapeAttr(s.id)}" data-add-practice-text="${escapeAttr(s.text)}">+ Add</button>
        </div>
      `).join('')}
      <p id="pg-practice-added" class="success" hidden style="margin-top:8px;">Added.</p>
    `;
  }

  function wirePracticeButtons() {
    root.querySelectorAll('[data-add-practice]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await addPracticeIdea(teamId, { text: btn.dataset.addPracticeText, sourceGameId: gameId, category: btn.dataset.addPractice, source: 'postgame' });
        const msg = root.querySelector('#pg-practice-added');
        if (msg) { msg.hidden = false; setTimeout(() => { msg.hidden = true; }, 2000); }
      });
    });
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
