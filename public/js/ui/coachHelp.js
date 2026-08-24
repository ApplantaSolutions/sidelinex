// Centralized "?" contextual help for the coach side of the app — one
// place to add a topic, one shared overlay implementation, one shared
// wiring function every view calls after rendering. Exists specifically
// so every screen can get a help button without each view file
// reinventing overlay-creation code (and risking the exact "orphaned
// overlay left on screen after navigating away" bug class already found
// and fixed once in fieldDesigner.js's own Help button this session).

const TOPICS = {
  home: {
    title: 'Home — Team Code & Season',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.75;">
        <li><b>Team Code</b> is what players and assistant coaches use to log in — text or say it to anyone joining your team. It never changes.</li>
        <li><b>Season</b> and <b>League Rules</b> are informational for now — they'll drive more features later.</li>
      </ul>
    `,
  },
  roster: {
    title: 'Roster — Adding & Removing Players',
    body: `
      <ol style="padding-left:20px; margin:0; line-height:1.9;">
        <li>Tap <b>+ Add Player</b>.</li>
        <li>Fill in their name (jersey number optional) and tap <b>Add Player</b>.</li>
        <li>Their <b>access code</b> appears once — write it down immediately, it can never be shown again. Give it to them along with your Team Code so they can log in.</li>
        <li>Made a mistake, or a code never got written down? Tap <b>Remove</b> next to that player, then add them again fresh with a new code.</li>
      </ol>
    `,
  },
  playbook: {
    title: 'Playbook — Building Plays',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li><b>+ Add Play</b> starts a new play — you'll name it, give it a wristband call number, and use the Play Designer to draw it (the Designer has its own "?" for that part).</li>
        <li><b>Offense / Defense</b> tabs switch which set of plays you're viewing.</li>
        <li><b>Search</b> and the filter chips help you find a play fast once you have a lot of them.</li>
        <li>Tap any play card to open and edit it. Archiving (inside a play) hides it from this list without deleting it — you can restore it any time.</li>
      </ul>
    `,
  },
  games: {
    title: 'Games — The 3-Step Weekly Flow',
    body: `
      <p style="margin:0 0 10px 0;">Each Game you create walks through 3 steps, in whatever order works for you:</p>
      <ol style="padding-left:20px; margin:0; line-height:1.9;">
        <li><b>Weekly Roles</b> — say who's playing which spot (WR1, QB, etc.) this week.</li>
        <li><b>Game Plan</b> — pick which plays from your Playbook you're using this game, and put them in order.</li>
        <li><b>Wristbands</b> — print physical call cards once the plan is set.</li>
      </ol>
      <p class="hint" style="margin:10px 0 0 0;">Tap <b>+ New Game</b> to start, or tap an existing game to keep working on it.</p>
    `,
  },
  weeklyRoles: {
    title: 'Weekly Roles — Who Plays What This Week',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li>Each row is a spot your Playbook actually uses (WR1, QB, etc.) — you never have to type these, they come straight from your plays.</li>
        <li>Tap a player's name under a spot to assign them. Tap again to un-assign.</li>
        <li>This is <b>per game</b> — next week, open that game's Weekly Roles and reassign without touching your Playbook at all.</li>
        <li>If the same player is assigned to two spots on the same side, you'll see a warning — fix it or leave it, your call.</li>
        <li>Don't forget to tap <b>Save Weekly Roles</b> when you're done.</li>
      </ul>
    `,
  },
  gamePlan: {
    title: 'Game Plan — Picking This Game\'s Plays',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li>Tap <b>+ Add Plays</b> to browse your Playbook (search or filter by category) and add plays to this game.</li>
        <li>Use <b>&uarr; &darr;</b> next to a play to reorder your list — this is the order wristbands print in too.</li>
        <li><b>Mark Core</b> flags a play as one of your must-have calls for this specific game.</li>
        <li>Everything here just points at your real Playbook plays — editing a play in the Playbook updates it everywhere it's used, automatically.</li>
      </ul>
    `,
  },
  wristbands: {
    title: 'Wristbands — Printing Call Cards',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li><b>Team/General</b> is a plain card with every play. <b>QB</b> adds Primary/Secondary reads. <b>Player-Specific</b> highlights just that player's job on each play.</li>
        <li>Set your actual wristband insert's width/height/margin under <b>Insert Template</b> — it's remembered next time.</li>
        <li>Two plays sharing the same call number blocks printing entirely — fix the duplicate in the Playbook first.</li>
        <li>When you print, set the print dialog's <b>Scale to "Actual size" or 100%"</b> — not "Fit to page" — or the physical size will be wrong.</li>
      </ul>
    `,
  },
  gameDay: {
    title: 'Game Day — Fast Live Logging',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li>Tap a play to call it, then tap a result (COMPLETE/RUN/etc). Target/passer/carrier are already guessed from Weekly Roles — tap a different name only if the guess is wrong.</li>
        <li>Tapping a yardage chip logs the play immediately — no separate save button on the fast path. INCOMPLETE and DROP log with one tap.</li>
        <li>Touchdown and Crossed Midfield are checkboxes you can tick before tapping yardage, if either applies.</li>
        <li>Defense chips (MAN, ZONE, PRESSURE, etc.) at the top of the play list are optional and stick until you change them — tap once, they apply to every snap until you tap a different one.</li>
        <li><b>&#8617; Undo Last</b> is always available — it reverses the state and every stat automatically, correctly, every time.</li>
        <li><b>Quick Stats</b> shows live Player and Play numbers — sample size is always shown next to any rate, so one good play never looks like proof.</li>
        <li>Everything for this game is cached to your phone at Start — a bad signal won't stop you from logging plays; they sync automatically once you're back online.</li>
      </ul>
    `,
  },
  diagramUpload: {
    title: 'Diagram Upload',
    body: `
      <p style="margin:0;">Optional. If you draw the play using the Play Designer below, you likely don't need an uploaded photo at all — but if you have a hand-drawn diagram from a whiteboard or paper, upload it here and it'll show wherever this play is viewed.</p>
    `,
  },
  aiAnalyzer: {
    title: 'AI Play Analyzer',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li>Tap <b>ANALYZE PLAY</b> to get advisory strengths, weaknesses, best situations, and a Man/Zone/Pressure fit — each with a plain-language reason, never a made-up statistic.</li>
        <li><b>SidelineX Suggests</b> shows tags/metadata it can reasonably infer — every suggestion is a chip you can leave selected or tap off before applying.</li>
        <li>It only ever fills in fields you left blank — anything you already typed or picked stays exactly as you set it.</li>
        <li>You always make the final call — this is advisory, not automatic.</li>
      </ul>
    `,
  },
  opponentScout: {
    title: 'Opponent Scout',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li>Everything here is tap-to-select — typing is only needed for the opponent's name and short notes.</li>
        <li><b>Base Look</b> and tags are pregame scouting/assumptions — they're always kept separate from what's actually observed live on game day.</li>
        <li><b>Playmakers</b> are your own scouting observations, not objective ratings — labeled that way on purpose.</li>
        <li><b>Saved Defensive Alignments</b> are a simple visual reference: tap the field to place a defender, drag to adjust, tap &minus; Remove Defender to delete one.</li>
        <li>Scouting data is coach-only — players never see it, even in Player Mode.</li>
        <li>Once attached to a game, the Sideline Advisor blends this with what's actually observed live — and always trusts today's real snaps over stale pregame scouting when the two disagree.</li>
      </ul>
    `,
  },
  scoutIntel: {
    title: 'Scout Intel — What Are They Doing?',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li><b>TODAY</b> counts every defensive look chip you've tapped so far this game — always a real count, never a percentage.</li>
        <li><b>RECENT</b> shows the last few tracked snaps in order, so a run of the same look jumps out fast.</li>
        <li><b>WATCH</b> lists playmakers from your attached opponent scout, if any — your own pregame observations, for quick reference mid-game.</li>
        <li>No opponent scout attached yet? Attach one from this game's Scout tab to see it here.</li>
      </ul>
    `,
  },
  practice: {
    title: 'Practice Planner',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li><b>Practice Ideas</b> pulled from Postgame Analytics show up here automatically — tap <b>+ Add to Practice</b> to turn one into a real agenda block.</li>
        <li>Each block: set a duration, an optional focus area, attach real Playbook plays (never a copy — tapping one opens the real diagram), and choose who it's for (whole team, specific players, or a role like WR1/QB — resolved automatically from Weekly Roles, no retyping names).</li>
        <li>&uarr;/&darr; reorders blocks. Scheduled vs. planned time is always shown at the top — going over isn't blocked, just visible.</li>
        <li><b>Attendance</b> is one tap per player. <b>Evaluate</b> next to a player opens a short, private coach observation — never shown to players.</li>
      </ul>
    `,
  },
  playerDevelopment: {
    title: 'Player Development',
    body: `
      <p style="margin:0;">Practice attendance, assignments, and your own private coach observations are kept clearly separate from real Game Statistics below them — they're not the same kind of measurement, and this view never blends them into one score. Coach-only — players never see this page or your observations.</p>
    `,
  },
  seasonSelfScout: {
    title: 'Season Self-Scout',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li>Combines every <b>completed</b> game's real data into season totals — the same numbers each Postgame Report already shows, just added together.</li>
        <li>Trends only show once at least 2 games of real data exist for that play or player — a single game is never shown as a "trend."</li>
        <li>Games still in progress aren't included — only ones you've tapped &#127937; End Game on.</li>
      </ul>
    `,
  },
  postgameReport: {
    title: 'Postgame Report',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li>Tap a section header to expand or collapse it — Summary opens first, everything else stays glanceable until you need it.</li>
        <li>Every number here is computed fresh from what was actually logged — nothing is stored separately, so reopening this later always matches the real data.</li>
        <li><b>Self-Scout</b> looks for real patterns (call frequency, situational tendencies, Advisor vs. your calls) — always phrased as "potential tendency," never as certainty.</li>
        <li><b>AI Coach Notes</b> is optional and only ever restates the real numbers already shown above — if it's unavailable, everything else on this page still works.</li>
        <li><b>Practice Ideas</b> are suggestions from this game's data — tap + Add to save one for later; nothing is decided for you.</li>
        <li>This report is coach-only — players never see it.</li>
      </ul>
    `,
  },
  sidelineAdvisor: {
    title: 'Sideline Advisor — Play Suggestions',
    body: `
      <ul style="padding-left:20px; margin:0; line-height:1.9;">
        <li>These 2-4 plays are ranked using REAL data from this game — repetition, defensive looks you've tagged, and player/play stats so far. Nothing here is guessed.</li>
        <li><b>Confidence</b> (HIGH/MEDIUM/LIMITED) reflects how much real data backs a suggestion, never a fake percentage. LIMITED just means there isn't much history yet — not that the play is bad.</li>
        <li>The short reasons under each play are always real and shown instantly. An optional AI sentence may appear a moment later — if it doesn't, the reasons alone are still trustworthy.</li>
        <li>Filter chips (RUN, PASS, SAFE, BEAT MAN, etc.) narrow the list instantly to only plays matching that need.</li>
        <li><b>CALL THIS PLAY</b> just takes you to that play's result screen — it never calls or submits anything on its own. You always make the final call.</li>
      </ul>
    `,
  },
};

function ensureOverlayStyleInjected() {
  if (document.getElementById('coach-help-style')) return;
  const style = document.createElement('style');
  style.id = 'coach-help-style';
  style.textContent = `
    .coach-help-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:200; display:flex; align-items:center; justify-content:center; padding:var(--space-2); }
    .coach-help-card { max-width:440px; max-height:85vh; overflow-y:auto; }
    .coach-help-btn { border:1.5px solid var(--sx-gold-border); color:var(--sx-gold); background:transparent; border-radius:50%; width:28px; height:28px; min-height:0; font-weight:800; line-height:1; padding:0; flex-shrink:0; }
  `;
  document.head.appendChild(style);
}

/** A small "?" button — drop this HTML anywhere a section needs help. */
export function helpButtonHtml(topicId, label = '?') {
  return `<button type="button" class="coach-help-btn" data-help-topic="${topicId}" aria-label="Help">${label}</button>`;
}

/**
 * Wires every [data-help-topic] button inside `root` to open its overlay.
 * Call this once after any render() that includes help buttons — cheap
 * and idempotent (just attaches click listeners to whatever's in the DOM
 * right now), matching the pattern every other button in this app uses.
 */
export function wireCoachHelpButtons(root) {
  ensureOverlayStyleInjected();
  root.querySelectorAll('[data-help-topic]').forEach((btn) => {
    btn.addEventListener('click', () => showCoachHelp(btn.dataset.helpTopic));
  });
}

let openOverlay = null;

export function showCoachHelp(topicId) {
  const topic = TOPICS[topicId];
  if (!topic || openOverlay) return; // never stack a second overlay
  ensureOverlayStyleInjected();
  const overlay = document.createElement('div');
  overlay.className = 'coach-help-overlay';
  overlay.innerHTML = `
    <div class="card card-gold coach-help-card">
      <h2>${topic.title}</h2>
      ${topic.body}
      <button type="button" class="btn btn-primary btn-large" id="coach-help-close" style="margin-top:var(--space-2); width:100%;">Got It</button>
    </div>
  `;
  document.body.appendChild(overlay);
  openOverlay = overlay;
  const close = () => { overlay.remove(); if (openOverlay === overlay) openOverlay = null; };
  overlay.querySelector('#coach-help-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

/** Closes any open help overlay — call from a view's teardown so
 * navigating away never leaves one orphaned on screen. */
export function closeCoachHelp() {
  if (openOverlay) {
    openOverlay.remove();
    openOverlay = null;
  }
}
