import {
  getGame, updateGame, getGamePlan, getWeeklyRoles, listPlays, getActiveVersion, listActivePlayers,
  getRuleConfig, getGameDayMeta, startGameDay, saveSnap, listSnaps, getScout,
  saveRecommendation, markRecommendationOutcome,
} from '../../data.js';
import { explainRecommendations } from '../../auth.js';
import { resolvePlayerForSlot } from '../../playbook/roleResolution.js';
import { buildFieldSvgMarkup } from '../../playbook/staticFieldSvg.js';
import { deriveGameState, describeDown } from '../../gameday/gameStateEngine.js';
import { deriveAllStats } from '../../gameday/gameStats.js';
import { rankPlayCalls, QUICK_FILTERS } from '../../gameday/sidelineAdvisor.js';
import {
  deriveTotalTrackedCount, deriveTodayLookCounts, deriveRecentLookSequence, describeSampleConfidence,
} from '../../scouting/scoutingIntelligence.js';
import { labelFor, DEFENSIVE_LOOKS, PLAYMAKER_STRENGTH_TAGS } from '../../scouting/scoutingTaxonomy.js';
import {
  generateSnapId, cacheGameDayData, loadCachedGameDayData, loadLocalSnaps,
  queueSnapLocally, hasPendingSnaps, flushPendingSnaps,
  cacheGameDayMeta, loadCachedGameDayMeta,
} from '../../gameday/localQueue.js';
import { helpButtonHtml, wireCoachHelpButtons } from '../../ui/coachHelp.js';

const YARDAGE_CHIPS = [-5, -3, 0, 3, 5, 7, 10, 15];
const DEFENSIVE_OBSERVATION_CHIPS = ['MAN', 'ZONE', 'PRESSURE', 'SOFT', 'TIGHT', 'RUSHER FAST', 'EDGE OPEN', 'MIDDLE OPEN'];
const FETCH_TIMEOUT_MS = 8000;

function generateRecommendationId() {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A stalled network request on bad signal doesn't reject — it just never
 * resolves — so a plain await + .catch() can leave the UI stuck on a
 * loading screen forever with no way forward. This races the real
 * request against a timeout and falls back to a safe default either way.
 */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function renderGameDayView(root, team, claims, gameId) {
  root.innerHTML = `<p class="hint">Loading Game Day...</p>`;
  const teamId = claims.teamId;

  let cache, meta, snaps;

  // Every piece of Game Day screen state, declared BEFORE the try block —
  // this is the actual root cause of the "stuck loading" bug: on a repeat
  // visit (game already started), renderGameDay() gets called from
  // INSIDE the try block, which — when these were declared further down,
  // after the try/catch — meant they were still in their temporal dead
  // zone at that point in THIS call's execution timeline. `let` bindings
  // are hoisted but stay uninitialized until their own declaration line
  // actually runs; reading one before that throws ReferenceError. On the
  // FIRST visit (game not started yet) only renderStartScreen() ran,
  // which never touches any of these, so the bug never showed up until a
  // second visit called renderGameDay() directly.
  let screen = 'pick_play'; // 'pick_play' | 'log_result' | 'stats'
  let screenBeforeStats = 'pick_play'; // so "Game" tab resumes exactly where Quick Stats was opened from
  let selected = null; // { playId, play, version }
  let pendingObservation = null;
  let search = '';
  let categoryFilter = '';
  let logDraft = null;
  // Sideline Advisor V1 state. advisorLoggedSnapCount tracks the live snap
  // count at the moment the current recommendation set was generated —
  // when it no longer matches the real live snap count, the situation has
  // moved on (a snap was logged or undone) and a fresh recommendation gets
  // generated + logged. advisorExplanations is keyed by a signature of
  // (ranked playIds + filter) so a slow/async AI response can never be
  // misapplied to a different situation's cards.
  let advisorFilter = null;
  let advisorLoggedSnapCount = -1;
  let lastRecommendationId = null;
  let advisorExplanations = { signature: null, byPlayId: {} };
  let endGameConfirming = false;

  try {
    cache = loadCachedGameDayData(gameId);
    if (!cache) {
      const [game, gamePlan, weeklyRoles, players, ruleConfig, allOffense, allDefense] = await Promise.all([
        getGame(teamId, gameId),
        getGamePlan(teamId, gameId),
        getWeeklyRoles(teamId, gameId),
        listActivePlayers(teamId),
        getRuleConfig(teamId),
        listPlays(teamId, { side: 'offense' }),
        listPlays(teamId, { side: 'defense' }),
      ]);
      const allPlays = [...allOffense, ...allDefense];
      const versions = await Promise.all(
        allPlays.map((p) => (p.activeVersionId ? getActiveVersion(teamId, p.id, p.activeVersionId) : null))
      );
      const playsById = {};
      allPlays.forEach((p, i) => { playsById[p.id] = { play: p, version: versions[i] }; });
      // Opponent Scout is coach-only data (see firestore.rules) — fetched
      // here like everything else so it's available offline too. If the
      // signed-in session ever isn't the coach, this simply resolves to
      // null (permission denied) rather than blocking Game Day.
      const scout = game?.scoutId ? await getScout(teamId, game.scoutId).catch(() => null) : null;

      cache = { game, entries: gamePlan.entries, weeklyRoles, players, ruleConfig, playsById, scout };
      cacheGameDayData(gameId, cache);
    }

    // Whether the game has started is checked against Firestore with a
    // hard timeout, falling back to whatever was last cached locally —
    // once Start Game Day has ever succeeded once on this device, opening
    // Game Day again never depends on a live network round trip just to
    // know that.
    const cachedMeta = loadCachedGameDayMeta(gameId);
    meta = await withTimeout(getGameDayMeta(teamId, gameId), FETCH_TIMEOUT_MS, cachedMeta);
    if (meta) cacheGameDayMeta(gameId, meta);
    else meta = cachedMeta;

    const remoteSnaps = await withTimeout(listSnaps(teamId, gameId), FETCH_TIMEOUT_MS, []);
    const localSnaps = loadLocalSnaps(gameId);
    // Merge remote + local, local wins on id conflicts (it may hold edits
    // not yet synced) — see localQueue.js for the documented scope of this.
    const mergedById = {};
    remoteSnaps.forEach((s) => { mergedById[s.id] = s; });
    localSnaps.forEach((s) => { mergedById[s.id] = s; });
    snaps = Object.values(mergedById).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (!meta?.started) {
      renderStartScreen();
    } else {
      tryFlush();
      renderGameDay();
    }
  } catch (err) {
    // Wraps the WHOLE screen, not just the data loading — a synchronous
    // bug in the render functions themselves would otherwise be an
    // unhandled rejection that leaves "Loading Game Day..." on screen
    // forever with zero indication anything went wrong. This is what
    // actually surfaces a real error message instead of a silent freeze.
    // eslint-disable-next-line no-console
    console.error('Game Day failed to load/render:', err);
    root.innerHTML = `
      <div class="card" style="border-color:var(--sx-error);">
        <h2 style="color:var(--sx-error);">Couldn't load Game Day</h2>
        <p class="hint" style="margin:8px 0;">${escapeHtml(err.message || 'Something went wrong.')}</p>
        <button type="button" class="btn btn-primary btn-large" id="gd-retry" style="width:100%;">Try Again</button>
      </div>
    `;
    root.querySelector('#gd-retry').addEventListener('click', () => renderGameDayView(root, team, claims, gameId));
    return;
  }

  /**
   * Opportunistic, fire-and-forget sync — tried once whenever this view
   * mounts (catches anything still pending from a previous offline
   * session) and again after every commit/undo. No persistent listener,
   * so there's nothing to leak or clean up when the coach navigates away
   * — the tradeoff (documented in localQueue.js) is that a snap logged
   * while genuinely offline only syncs on the NEXT commit/undo/remount,
   * not the instant connectivity returns.
   */
  async function tryFlush() {
    const result = await flushPendingSnaps(gameId, (snap) => saveSnap(teamId, gameId, snap)).catch(() => null);
    if (result && result.synced > 0) renderGameDay();
  }

  function renderStartScreen() {
    root.innerHTML = `
      <div class="card card-gold">
        <h2>Start Game Day</h2>
        <p class="hint" style="margin-bottom:var(--space-2);">Everything for this game — plan, roles, plays, diagrams — gets cached to this device so a bad signal at the field doesn't stop you.</p>
        <p class="hint" style="margin-bottom:8px;">Who has the ball first?</p>
        <div class="row-wrap" style="margin-bottom:var(--space-2);">
          <button type="button" class="btn btn-primary btn-large" id="gd-start-us">${escapeHtml(team.name)} (Us)</button>
          <button type="button" class="btn btn-secondary btn-large" id="gd-start-them">${escapeHtml(cache.game?.opponent || 'Opponent')} (Them)</button>
        </div>
      </div>
    `;
    root.querySelector('#gd-start-us').addEventListener('click', () => doStart('us'));
    root.querySelector('#gd-start-them').addEventListener('click', () => doStart('them'));

    async function doStart(startingPossession) {
      meta = { started: true, startingPossession };
      cacheGameDayMeta(gameId, meta); // set locally FIRST — never block starting the game on the network
      renderGameDay();
      startGameDay(teamId, gameId, { startingPossession }).catch(() => { /* retried implicitly: cached meta already reflects "started" for this device */ });
    }
  }

  // ---------- main Game Day screen ----------
  // (screen/selected/pendingObservation/search/categoryFilter/logDraft are
  // all declared up top, before the try block — see the comment there.)

  function renderGameDay() {
    const liveSnaps = snaps.filter((s) => !s.voided);
    const gameState = deriveGameState(liveSnaps.map(toResult), cache.ruleConfig, meta.startingPossession);
    const stats = deriveAllStats(snaps);

    if (cache.game?.ended) {
      root.innerHTML = `
        <div class="card card-gold">
          <h2>Game Ended</h2>
          <p class="hint" style="margin:8px 0;">Final: ${gameState.score.us}&ndash;${gameState.score.them}</p>
          <p style="margin:0;">Open this game's <b>Postgame</b> tab to review the full report.</p>
        </div>
      `;
      return;
    }

    root.innerHTML = `
      <div class="card card-gold" style="padding:12px 16px;">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div>
            <p style="margin:0; font-size:22px; font-weight:900;">${escapeHtml(describeDown(gameState, cache.ruleConfig))}</p>
            <p class="hint" style="margin:2px 0 0 0;">Possession: <b style="color:var(--sx-white);">${gameState.possession === 'us' ? escapeHtml(team.name) : escapeHtml(cache.game?.opponent || 'Them')}</b></p>
          </div>
          <div style="text-align:right;">
            <p style="margin:0; font-size:28px; font-weight:900;">${gameState.score.us}&ndash;${gameState.score.them}</p>
            ${hasPendingSnaps(gameId) ? '<p class="hint" style="margin:0; color:var(--sx-gold);">Syncing…</p>' : ''}
          </div>
        </div>
        ${endGameConfirming ? `
          <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--sx-gold-border);">
            <p style="margin:0 0 8px 0;">End the game? This locks it and generates the Postgame Report.</p>
            <div class="row-wrap">
              <button type="button" class="btn btn-secondary" id="gd-end-cancel" style="flex:1;">Cancel</button>
              <button type="button" class="btn btn-primary" id="gd-end-confirm" style="flex:1;">Yes, End Game</button>
            </div>
          </div>
        ` : `
          <button type="button" class="btn btn-link" id="gd-end-game" style="margin-top:6px; padding:0;">&#127937; End Game</button>
        `}
      </div>

      <div class="row" style="margin: var(--space-2) 0; gap:8px; flex-wrap: wrap;">
        <button class="nav-tab ${screen !== 'stats' && screen !== 'scout_intel' ? 'active' : ''}" id="gd-tab-play">Game</button>
        <button class="nav-tab ${screen === 'stats' ? 'active' : ''}" id="gd-tab-stats">Quick Stats</button>
        <button class="nav-tab ${screen === 'scout_intel' ? 'active' : ''}" id="gd-tab-scout">&#128065; Scout</button>
        ${helpButtonHtml('gameDay')}
        <button type="button" class="btn btn-link" id="gd-undo" style="margin-left:auto;" ${liveSnaps.length === 0 ? 'disabled' : ''}>&#8617; Undo Last</button>
      </div>

      <div id="gameday-content"></div>
    `;
    wireCoachHelpButtons(root);

    root.querySelector('#gd-tab-play').addEventListener('click', () => { screen = (screen === 'stats' || screen === 'scout_intel') ? screenBeforeStats : screen; renderGameDay(); });
    root.querySelector('#gd-tab-stats').addEventListener('click', () => {
      if (screen !== 'stats' && screen !== 'scout_intel') screenBeforeStats = screen;
      screen = 'stats';
      renderGameDay();
    });
    root.querySelector('#gd-tab-scout').addEventListener('click', () => {
      if (screen !== 'stats' && screen !== 'scout_intel') screenBeforeStats = screen;
      screen = 'scout_intel';
      renderGameDay();
    });
    root.querySelector('#gd-undo').addEventListener('click', undoLast);

    const endGameBtn = root.querySelector('#gd-end-game');
    if (endGameBtn) endGameBtn.addEventListener('click', () => { endGameConfirming = true; renderGameDay(); });
    const endGameCancel = root.querySelector('#gd-end-cancel');
    if (endGameCancel) endGameCancel.addEventListener('click', () => { endGameConfirming = false; renderGameDay(); });
    const endGameConfirm = root.querySelector('#gd-end-confirm');
    if (endGameConfirm) endGameConfirm.addEventListener('click', endGame);

    const content = root.querySelector('#gameday-content');
    if (screen === 'stats') return renderStatsScreen(content, stats);
    if (screen === 'scout_intel') return renderScoutIntelScreen(content, liveSnaps);
    if (screen === 'log_result' && selected) return renderLogResultScreen(content, gameState);
    return renderPickPlayScreen(content, gameState);
  }

  // ---------- Scout Intel — "what are they doing?" (glanceable, no dashboard) ----------

  function renderScoutIntelScreen(el, liveSnaps) {
    const totalTracked = deriveTotalTrackedCount(liveSnaps);
    const todayCounts = deriveTodayLookCounts(liveSnaps);
    const recentSeq = deriveRecentLookSequence(liveSnaps, 5);
    const sampleNote = describeSampleConfidence(totalTracked);
    const scout = cache.scout;

    el.innerHTML = `
      <div class="card" style="margin-bottom:var(--space-2);">
        <h2>Today</h2>
        ${Object.keys(todayCounts).length === 0 ? '<p class="hint" style="margin:0;">No defensive looks tracked yet — tap a chip on the play list to start tracking.</p>' : Object.entries(todayCounts).sort((a, b) => b[1] - a[1]).map(([look, count]) => `<p style="margin:0 0 4px 0;">${escapeHtml(look)} &mdash; <b style="color:var(--sx-gold);">${count}</b> observed</p>`).join('')}
        ${sampleNote ? `<p class="hint" style="margin:6px 0 0 0; color:var(--sx-gold);">${sampleNote}</p>` : ''}
        <p class="hint" style="margin:6px 0 0 0;">Source: OBSERVED TODAY &middot; ${totalTracked} tracked snap${totalTracked === 1 ? '' : 's'}</p>
      </div>
      <div class="card" style="margin-bottom:var(--space-2);">
        <h2>Recent</h2>
        ${recentSeq.length === 0 ? '<p class="hint" style="margin:0;">Nothing tracked yet.</p>' : `<p style="margin:0; font-weight:800;">${recentSeq.map((l) => escapeHtml(l)).join(' &bull; ')}</p>`}
      </div>
      <div class="card">
        <h2>Watch</h2>
        ${!scout ? '<p class="hint" style="margin:0;">No opponent scout attached — attach one from this game\'s Scout tab.</p>'
          : (scout.playmakers || []).length === 0 ? '<p class="hint" style="margin:0;">No playmakers logged for this opponent yet.</p>'
          : scout.playmakers.map((p) => `<p style="margin:0 0 4px 0;">#${escapeHtml(p.jerseyNumber ?? '?')}${p.name ? ' — ' + escapeHtml(p.name) : ''} &mdash; <b>${escapeHtml(p.strengthTag ? labelFor(PLAYMAKER_STRENGTH_TAGS, p.strengthTag) : 'Watch')}</b></p>`).join('')}
        ${scout ? '<p class="hint" style="margin:6px 0 0 0;">Source: COACH SCOUTING</p>' : ''}
      </div>
    `;
  }

  // ---------- pick play ----------

  function renderPickPlayScreen(el, gameState) {
    const liveSnaps = snaps.filter((s) => !s.voided);
    if (liveSnaps.length !== advisorLoggedSnapCount) {
      // A fresh situation (a snap was just logged or undone) — start the
      // quick filter over and clear any AI text from the prior situation
      // rather than risk it lingering on a play that happens to reappear.
      advisorFilter = null;
      advisorExplanations = { signature: null, byPlayId: {} };
      // The Advisor only ever runs on our own possession (see the early
      // return in renderAdvisorSection below). If possession has since
      // flipped, any lastRecommendationId still set is stale — clear it so
      // the NEXT snap logged (which may be a defensive call while they
      // have the ball) never gets wrongly attributed to it.
      if (gameState.possession !== 'us') lastRecommendationId = null;
    }

    const entries = cache.entries.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const filtered = entries.filter((e) => {
      const p = cache.playsById[e.playId]?.play;
      if (!p) return false;
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !(p.wristbandCode || '').toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    el.innerHTML = `
      ${renderAdvisorSection(gameState, liveSnaps)}
      <div class="row-wrap" style="margin-bottom:8px;">
        <p class="hint" style="margin:0 0 4px 0; width:100%;">Defense look seen right now (optional, sticks until changed):</p>
        ${DEFENSIVE_OBSERVATION_CHIPS.map((c) => `<button type="button" class="chip ${pendingObservation === c ? 'selected' : ''}" data-obs="${escapeAttr(c)}">${c}</button>`).join('')}
      </div>
      <input type="text" id="gd-search" placeholder="Search call number or name" value="${escapeAttr(search)}" autocomplete="off" style="margin-bottom:8px;" />
      <div class="row-wrap" style="margin-bottom: var(--space-2);">
        <button type="button" class="chip ${categoryFilter === '' ? 'selected' : ''}" data-cat="">All</button>
        <button type="button" class="chip ${categoryFilter === 'pass' ? 'selected' : ''}" data-cat="pass">Pass</button>
        <button type="button" class="chip ${categoryFilter === 'run' ? 'selected' : ''}" data-cat="run">Run</button>
      </div>
      <ul class="roster-list">
        ${filtered.map((e) => {
          const p = cache.playsById[e.playId].play;
          return `
          <li class="play-card" data-play-id="${e.playId}" style="cursor:pointer;">
            <div class="play-card-code">${escapeHtml(p.wristbandCode || '--')}</div>
            <div class="play-card-main">
              <div class="play-card-name">${p.favorite || e.isCore ? '<span style="color:var(--sx-gold);">&#9733; </span>' : ''}${escapeHtml(p.name)}</div>
              <div class="play-card-meta">${escapeHtml((p.category || '').replace(/_/g, ' '))}</div>
            </div>
          </li>
        `;
        }).join('') || '<li class="hint">No plays match.</li>'}
      </ul>
    `;

    el.querySelectorAll('[data-obs]').forEach((chip) => {
      chip.addEventListener('click', () => {
        pendingObservation = pendingObservation === chip.dataset.obs ? null : chip.dataset.obs;
        renderPickPlayScreen(el, gameState);
      });
    });
    el.querySelector('#gd-search').addEventListener('input', (e) => { search = e.target.value; renderPickPlayScreen(el, gameState); });
    el.querySelectorAll('[data-cat]').forEach((chip) => {
      chip.addEventListener('click', () => { categoryFilter = chip.dataset.cat; renderPickPlayScreen(el, gameState); });
    });
    el.querySelectorAll('[data-play-id]').forEach((card) => {
      card.addEventListener('click', () => selectPlayForResult(card.dataset.playId));
    });
    el.querySelectorAll('[data-advisor-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        advisorFilter = advisorFilter === chip.dataset.advisorFilter ? null : chip.dataset.advisorFilter;
        renderPickPlayScreen(el, gameState);
      });
    });
    el.querySelectorAll('[data-advisor-call]').forEach((btn) => {
      btn.addEventListener('click', () => selectPlayForResult(btn.dataset.advisorCall));
    });
    wireCoachHelpButtons(el);
  }

  function selectPlayForResult(playId) {
    const found = cache.playsById[playId];
    if (!found) return;
    selected = { playId, play: found.play, version: found.version };
    logDraft = null; // fresh draft for the newly picked play
    screen = 'log_result';
    renderGameDay();
  }

  // ---------- Sideline Advisor V1 ----------
  // Deterministic filtering -> transparent ranking (rankPlayCalls, pure,
  // no AI) happens first and is what's actually shown; the AI explanation
  // call is fetched asynchronously afterward and only ever ADDS a short
  // sentence on top of the same real reasons — see auth.js/
  // sidelineAdvisorExplain.js for the anti-fabrication validation. If the
  // AI call fails or never resolves, the deterministic card is already
  // complete and useful on its own — nothing here ever blocks on it.

  function renderAdvisorSection(gameState, liveSnaps) {
    if (gameState.possession !== 'us') return '';

    const situation = `${describeDown(gameState, cache.ruleConfig)}, score ${gameState.score.us}-${gameState.score.them}`;
    const recs = rankPlayCalls({
      gameState, entries: cache.entries, playsById: cache.playsById, snaps: liveSnaps,
      weeklyRoles: cache.weeklyRoles, players: cache.players, filter: advisorFilter, scout: cache.scout,
    });

    if (liveSnaps.length !== advisorLoggedSnapCount) {
      advisorLoggedSnapCount = liveSnaps.length;
      // Log the UNFILTERED base ranking — the self-scouting record should
      // reflect what the Advisor actually suggested before the coach
      // narrowed it with a quick filter of their own.
      const baseRecs = advisorFilter
        ? rankPlayCalls({ gameState, entries: cache.entries, playsById: cache.playsById, snaps: liveSnaps, weeklyRoles: cache.weeklyRoles, players: cache.players, scout: cache.scout })
        : recs;
      lastRecommendationId = generateRecommendationId();
      const rec = {
        id: lastRecommendationId,
        situationSnapshot: situation,
        rankedOptions: baseRecs.map((r) => ({ playId: r.playId, score: r.score, confidence: r.confidence, reasons: r.reasons })),
        shownAt: new Date().toISOString(),
        calledPlayId: null,
        calledSnapId: null,
      };
      saveRecommendation(teamId, gameId, rec).catch(() => { /* self-scouting log only — never blocks Game Day */ });
    }

    maybeFetchAdvisorExplanations(situation, recs);

    return `
      <div class="card card-gold" style="margin-bottom:var(--space-2);">
        <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:6px;">
          <p style="margin:0; font-weight:800;">&#128161; Sideline Advisor</p>
          ${helpButtonHtml('sidelineAdvisor')}
        </div>
        <div class="row-wrap" style="margin-bottom:8px;">
          ${QUICK_FILTERS.map((f) => `<button type="button" class="chip ${advisorFilter === f.value ? 'selected' : ''}" data-advisor-filter="${f.value}">${f.label}</button>`).join('')}
        </div>
        ${recs.length === 0
          ? '<p class="hint" style="margin:0;">No plays in the Game Plan match this filter.</p>'
          : recs.map((r) => advisorCardHtml(r)).join('')}
      </div>
    `;
  }

  function advisorCardHtml(r) {
    const p = cache.playsById[r.playId]?.play;
    if (!p) return '';
    const aiText = advisorExplanations.byPlayId[r.playId];
    return `
      <div class="card" style="margin-bottom:8px; padding:10px 12px;">
        <div class="row" style="justify-content:space-between; align-items:center; gap:8px;">
          <div>
            <p style="margin:0; font-weight:800;">${escapeHtml(p.wristbandCode || '--')} &middot; ${escapeHtml(p.name)}</p>
            <p class="hint" style="margin:2px 0 0 0;">${escapeHtml(r.confidence)} confidence</p>
          </div>
          <button type="button" class="btn btn-primary" data-advisor-call="${r.playId}" style="flex-shrink:0;">CALL THIS PLAY</button>
        </div>
        <ul style="margin:6px 0 0 0; padding-left:18px; line-height:1.6;">
          ${r.reasons.map((reason) => `<li class="hint">${escapeHtml(reason)}</li>`).join('')}
        </ul>
        ${aiText ? `<p style="margin:6px 0 0 0; font-style:italic; color:var(--sx-gold);">${escapeHtml(aiText)}</p>` : ''}
      </div>
    `;
  }

  /**
   * Fires the AI explanation call at most once per distinct (ranked
   * playIds + filter) signature — a search keystroke or an unrelated
   * re-render never re-triggers it. A response that arrives after the
   * situation has already moved on (signature no longer matches) is
   * discarded rather than misapplied to the wrong cards.
   */
  function maybeFetchAdvisorExplanations(situation, recs) {
    const signature = `${recs.map((r) => r.playId).join(',')}|${advisorFilter || ''}`;
    if (advisorExplanations.signature === signature) return;
    advisorExplanations = { signature, byPlayId: {} };
    if (recs.length === 0) return;

    explainRecommendations(situation, recs.map((r) => ({
      playId: r.playId,
      playName: cache.playsById[r.playId]?.play?.name || r.playId,
      confidence: r.confidence,
      reasons: r.reasons,
    })))
      .then((result) => {
        if (advisorExplanations.signature !== signature) return; // situation moved on — discard
        advisorExplanations = { signature, byPlayId: result?.explanations || {} };
        // Only re-render if the coach is still looking at the pick-play
        // screen — a slow AI response must never yank them back to it.
        if (screen === 'pick_play') renderGameDay();
      })
      .catch(() => { /* deterministic reasons already shown — AI gloss just isn't available this time */ });
  }

  // ---------- log result ----------

  function renderLogResultScreen(el, gameState) {
    const { play, version } = selected;
    const design = version?.fieldDesign || { positions: {}, routes: {} };

    function resolveSlot(slot) {
      if (!slot) return null;
      return resolvePlayerForSlot(cache.weeklyRoles, play.side, slot);
    }
    function resolveBallCarrier() {
      const slot = Object.entries(version?.assignments || {}).find(([, a]) => a.roleClassification === 'ball_carrier')?.[0];
      return slot ? resolveSlot(slot) : null;
    }
    function playerName(id) {
      return cache.players.find((p) => p.id === id)?.firstName || '—';
    }

    if (!logDraft) {
      logDraft = {
        resultType: null, // set once a result chip is tapped
        chosenPasser: resolveSlot('QB'),
        chosenTarget: play.intent?.primaryTargetSlot ? resolveSlot(play.intent.primaryTargetSlot) : null,
        chosenCarrier: resolveBallCarrier(),
        touchdown: false,
        crossedMidfield: false,
        turnover: false,
        customYardsMode: false,
      };
    }

    renderBody();

    function renderBody() {
      el.innerHTML = `
        <button type="button" class="btn btn-link" id="gd-back-to-pick" style="padding-left:0;">&larr; Change Play</button>
        <div class="card card-gold" style="margin-bottom:var(--space-2);">
          <div class="row" style="justify-content:space-between; align-items:center;">
            <div>
              <p class="code-display" style="font-size:20px;">${escapeHtml(play.wristbandCode || '--')}</p>
              <p style="margin:2px 0 0 0; font-weight:800; font-size:18px;">${escapeHtml(play.name)}</p>
            </div>
            <div style="width:70px; height:88px;">${buildFieldSvgMarkup(design, { compact: true })}</div>
          </div>
        </div>

        ${!logDraft.resultType ? resultTypeButtonsHtml() : followUpHtml()}
      `;

      el.querySelector('#gd-back-to-pick').addEventListener('click', () => { logDraft = null; screen = 'pick_play'; renderGameDay(); });

      if (!logDraft.resultType) {
        el.querySelectorAll('[data-result-type]').forEach((btn) => {
          btn.addEventListener('click', () => { logDraft.resultType = btn.dataset.resultType; renderBody(); });
        });
        return;
      }

      wireFollowUpEvents();
    }

    function resultTypeButtonsHtml() {
      return `
        <div class="stack">
          <div class="row-wrap">
            <button type="button" class="btn btn-primary btn-large" data-result-type="complete" style="flex:1;">COMPLETE</button>
            <button type="button" class="btn btn-secondary btn-large" data-result-type="incomplete" style="flex:1;">INCOMPLETE</button>
          </div>
          <div class="row-wrap">
            <button type="button" class="btn btn-secondary btn-large" data-result-type="drop" style="flex:1;">DROP</button>
            <button type="button" class="btn btn-primary btn-large" data-result-type="run" style="flex:1;">RUN</button>
          </div>
          <div class="row-wrap">
            <button type="button" class="btn btn-secondary btn-large" data-result-type="penalty" style="flex:1;">PENALTY</button>
            <button type="button" class="btn btn-secondary btn-large" data-result-type="other" style="flex:1;">OTHER</button>
          </div>
        </div>
      `;
    }

    function playerChipsHtml(dataAttr, chosenId, label) {
      const eligible = cache.players; // small youth roster — showing everyone keeps override always one tap away
      return `
        <p class="hint" style="margin:8px 0 4px 0;">${label}${chosenId ? `: <b style="color:var(--sx-gold);">${escapeHtml(playerName(chosenId))}</b>` : ' (tap to set)'}</p>
        <div class="row-wrap" data-player-group="${dataAttr}">
          ${eligible.map((p) => `<button type="button" class="chip ${chosenId === p.id ? 'selected' : ''}" data-player="${p.id}">${escapeHtml(p.firstName)}</button>`).join('')}
        </div>
      `;
    }

    function followUpHtml() {
      const resultType = logDraft.resultType;
      const needsPasserTarget = ['complete', 'incomplete', 'drop'].includes(resultType);
      const needsCarrier = resultType === 'run';
      return `
        <div class="card">
          <p style="margin:0 0 8px 0; font-weight:800; text-transform:uppercase;">${resultType}</p>
          ${needsPasserTarget ? playerChipsHtml('target', logDraft.chosenTarget, 'Target') : ''}
          ${needsPasserTarget ? playerChipsHtml('passer', logDraft.chosenPasser, 'Passer') : ''}
          ${needsCarrier ? playerChipsHtml('carrier', logDraft.chosenCarrier, 'Ball Carrier') : ''}

          ${resultType !== 'incomplete' && resultType !== 'drop' ? `
            <p class="hint" style="margin:var(--space-2) 0 4px 0;">Yards</p>
            <div class="row-wrap">
              ${YARDAGE_CHIPS.map((y) => `<button type="button" class="chip" data-yards="${y}">${y > 0 ? '+' : ''}${y}</button>`).join('')}
              <button type="button" class="chip" id="gd-custom-yards">CUSTOM</button>
            </div>
            ${logDraft.customYardsMode ? `
              <div class="row" style="margin-top:8px; gap:8px;">
                <input type="number" id="gd-custom-yards-input" placeholder="yards" style="flex:1;" />
                <button type="button" class="btn btn-primary" id="gd-custom-yards-save">Log</button>
              </div>
            ` : ''}
          ` : ''}

          <div class="row-wrap" style="margin-top: var(--space-2);">
            <label class="row"><input type="checkbox" id="gd-td" ${logDraft.touchdown ? 'checked' : ''} style="width:24px;height:24px;min-height:0;" /><span>&#127944; Touchdown</span></label>
            ${gameState.phase === 'toMidfield' ? `<label class="row"><input type="checkbox" id="gd-crossed" ${logDraft.crossedMidfield ? 'checked' : ''} style="width:24px;height:24px;min-height:0;" /><span>Crossed Midfield</span></label>` : ''}
            ${resultType !== 'penalty' ? `<label class="row"><input type="checkbox" id="gd-turnover" ${logDraft.turnover ? 'checked' : ''} style="width:24px;height:24px;min-height:0;" /><span>&#8635; Turnover</span></label>` : ''}
          </div>

          ${resultType === 'incomplete' || resultType === 'drop' ? `
            <button type="button" class="btn btn-primary btn-large" id="gd-save-zero" style="width:100%; margin-top:var(--space-2);">Log It</button>
          ` : ''}

          <button type="button" class="btn btn-link" id="gd-change-result" style="margin-top:8px;">Change Result Type</button>
        </div>
      `;
    }

    function wireFollowUpEvents() {
      el.querySelectorAll('[data-player-group]').forEach((group) => {
        group.querySelectorAll('[data-player]').forEach((chip) => {
          chip.addEventListener('click', () => {
            const g = group.dataset.playerGroup;
            if (g === 'target') logDraft.chosenTarget = chip.dataset.player;
            if (g === 'passer') logDraft.chosenPasser = chip.dataset.player;
            if (g === 'carrier') logDraft.chosenCarrier = chip.dataset.player;
            renderBody();
          });
        });
      });

      const tdBox = el.querySelector('#gd-td');
      if (tdBox) tdBox.addEventListener('change', (e) => { logDraft.touchdown = e.target.checked; });
      const crossedBox = el.querySelector('#gd-crossed');
      if (crossedBox) crossedBox.addEventListener('change', (e) => { logDraft.crossedMidfield = e.target.checked; });
      const turnoverBox = el.querySelector('#gd-turnover');
      if (turnoverBox) turnoverBox.addEventListener('change', (e) => { logDraft.turnover = e.target.checked; });

      el.querySelectorAll('[data-yards]').forEach((chip) => {
        chip.addEventListener('click', () => commitSnap(Number(chip.dataset.yards)));
      });
      const customBtn = el.querySelector('#gd-custom-yards');
      if (customBtn) customBtn.addEventListener('click', () => { logDraft.customYardsMode = true; renderBody(); });
      const customSave = el.querySelector('#gd-custom-yards-save');
      if (customSave) {
        customSave.addEventListener('click', () => {
          const val = Number(el.querySelector('#gd-custom-yards-input').value) || 0;
          commitSnap(val);
        });
      }
      const saveZero = el.querySelector('#gd-save-zero');
      if (saveZero) saveZero.addEventListener('click', () => commitSnap(0));

      el.querySelector('#gd-change-result').addEventListener('click', () => { logDraft.resultType = null; renderBody(); });
    }

    function commitSnap(yards) {
      const resultType = logDraft.resultType;
      const snap = {
        id: generateSnapId(),
        gameId,
        playId: selected.playId,
        playVersionId: play.activeVersionId || null,
        resultType,
        yards,
        touchdown: logDraft.touchdown,
        crossedMidfield: logDraft.crossedMidfield,
        turnover: logDraft.turnover,
        passerId: ['complete', 'incomplete', 'drop'].includes(resultType) ? logDraft.chosenPasser : null,
        targetId: ['complete', 'incomplete', 'drop'].includes(resultType) ? logDraft.chosenTarget : null,
        receiverId: resultType === 'complete' ? logDraft.chosenTarget : null,
        ballCarrierId: resultType === 'run' ? logDraft.chosenCarrier : null,
        defensiveLookObserved: pendingObservation,
        note: null,
        createdAt: new Date().toISOString(),
        order: snaps.length,
        voided: false,
      };
      snaps = queueSnapLocally(gameId, snap);
      saveSnap(teamId, gameId, snap).catch(() => { /* stays queued locally — tryFlush() picks it up on the next commit/undo/remount */ });
      if (lastRecommendationId) {
        // Self-scouting only — records what was actually called against
        // what the Advisor suggested for this situation. Never gates or
        // blocks logging the snap itself.
        markRecommendationOutcome(teamId, gameId, lastRecommendationId, { calledPlayId: selected.playId, calledSnapId: snap.id }).catch(() => {});
        lastRecommendationId = null;
      }
      selected = null;
      logDraft = null;
      screen = 'pick_play';
      renderGameDay();
      tryFlush();
    }
  }

  // ---------- end game ----------
  // Requires the explicit confirm step above so this can never happen
  // accidentally from a stray tap. Nothing is duplicated here — the
  // Postgame Report is always computed fresh from Snap/Game data, so
  // ending the game is just a flag + timestamp, not a data-generation
  // step of its own.

  function endGame() {
    cache.game = { ...cache.game, ended: true, endedAt: new Date().toISOString() };
    cacheGameDayData(gameId, cache); // set locally FIRST — never block on the network
    endGameConfirming = false;
    renderGameDay();
    updateGame(teamId, gameId, { ended: true, endedAt: cache.game.endedAt }).catch(() => { /* cached locally; next load/sync picks it up */ });
  }

  // ---------- undo ----------

  function undoLast() {
    const live = snaps.filter((s) => !s.voided);
    if (live.length === 0) return;
    const last = live[live.length - 1];
    last.voided = true;
    snaps = queueSnapLocally(gameId, last);
    saveSnap(teamId, gameId, last).catch(() => {});
    renderGameDay();
    tryFlush();
  }

  // ---------- quick stats ----------

  function renderStatsScreen(el, stats) {
    let statsTab = 'players';
    render();

    function render() {
      el.innerHTML = `
        <div class="row" style="margin-bottom: var(--space-2);">
          <button class="nav-tab ${statsTab === 'players' ? 'active' : ''}" data-stats-tab="players">Players</button>
          <button class="nav-tab ${statsTab === 'plays' ? 'active' : ''}" data-stats-tab="plays">Plays</button>
        </div>
        <div id="gd-stats-list"></div>
      `;
      el.querySelectorAll('[data-stats-tab]').forEach((btn) => {
        btn.addEventListener('click', () => { statsTab = btn.dataset.statsTab; render(); });
      });
      const list = el.querySelector('#gd-stats-list');
      if (statsTab === 'players') return renderPlayers(list);
      return renderPlays(list);
    }

    function playerName(id) {
      return cache.players.find((p) => p.id === id)?.firstName || 'Unknown';
    }

    function renderPlayers(el2) {
      const ids = new Set([...Object.keys(stats.passing), ...Object.keys(stats.receiving), ...Object.keys(stats.rushing)]);
      if (ids.size === 0) { el2.innerHTML = '<p class="hint">No stats yet.</p>'; return; }
      el2.innerHTML = [...ids].map((id) => {
        const rec = stats.receiving[id];
        const rush = stats.rushing[id];
        const pass = stats.passing[id];
        return `
          <div class="card">
            <h2 style="margin-bottom:6px;">${escapeHtml(playerName(id))}</h2>
            ${pass ? `<p style="margin:0;">Passing: ${pass.completions}/${pass.attempts}, ${pass.passingYards} yds, ${pass.touchdowns} TD</p>` : ''}
            ${rec ? `<p style="margin:0;">Receiving: ${rec.targets} targets, ${rec.catches} catches, ${rec.drops} drops, ${rec.receivingYards} yds${rec.touchdowns ? `, ${rec.touchdowns} TD` : ''}</p>` : ''}
            ${rush ? `<p style="margin:0;">Rushing: ${rush.carries} carries, ${rush.rushingYards} yds${rush.touchdowns ? `, ${rush.touchdowns} TD` : ''}</p>` : ''}
          </div>
        `;
      }).join('');
    }

    function renderPlays(el2) {
      const playIds = Object.keys(stats.plays);
      if (playIds.length === 0) { el2.innerHTML = '<p class="hint">No plays logged yet.</p>'; return; }
      el2.innerHTML = playIds.map((id) => {
        const p = stats.plays[id];
        const play = cache.playsById[id]?.play;
        return `
          <div class="card">
            <h2 style="margin-bottom:6px;">${escapeHtml(play?.name || id)}</h2>
            <p style="margin:0;">${p.timesCalled} call${p.timesCalled === 1 ? '' : 's'} &middot; ${p.averageGain?.toFixed(1) ?? '0'} avg yds${p.touchdowns ? ` &middot; ${p.touchdowns} TD` : ''}</p>
            <p class="hint" style="margin:2px 0 0 0;">Sample size: ${p.timesCalled}${p.completionRate != null ? ` &middot; ${(p.completionRate * 100).toFixed(0)}% comp` : ''}</p>
          </div>
        `;
      }).join('');
    }
  }

  function toResult(snap) {
    return {
      type: snap.resultType,
      yards: snap.yards,
      touchdown: snap.touchdown,
      crossedMidfield: snap.crossedMidfield,
      turnover: snap.turnover,
    };
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
