import { loginAsCoach, loginAsPlayer, getRosterForTeamCode } from '../../auth.js';

// A small local state machine for the login flow's steps, kept in this
// module rather than a global — the login view is self-contained.
const STEP = {
  TEAM_CODE: 'team_code',
  ROLE_PICK: 'role_pick',
  COACH_CODE: 'coach_code',
  PLAYER_PICK: 'player_pick',
  PLAYER_CODE: 'player_code',
};

export function renderLoginView(root, onDone) {
  const state = { step: STEP.TEAM_CODE, teamCode: '', teamName: '', roster: [], selectedPlayer: null };
  render();

  function render() {
    if (state.step === STEP.TEAM_CODE) return renderTeamCodeStep();
    if (state.step === STEP.ROLE_PICK) return renderRolePickStep();
    if (state.step === STEP.COACH_CODE) return renderCoachCodeStep();
    if (state.step === STEP.PLAYER_PICK) return renderPlayerPickStep();
    if (state.step === STEP.PLAYER_CODE) return renderPlayerCodeStep();
  }

  function renderTeamCodeStep() {
    root.innerHTML = `
      <section class="screen">
        <h1>Log In</h1>
        <p class="hint">Enter the Team Code your coach shared with you.</p>
        <form id="team-code-form" class="stack">
          <label class="field">
            <span>Team Code</span>
            <input type="text" name="teamCode" required autocomplete="off" autocapitalize="characters"
                   maxlength="6" class="code-input" placeholder="ABC123" />
          </label>
          <button type="submit" class="btn btn-primary btn-large">Continue</button>
          <p id="team-code-error" class="error" hidden></p>
        </form>
      </section>
    `;
    const form = root.querySelector('#team-code-form');
    const errorEl = root.querySelector('#team-code-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      const teamCode = new FormData(form).get('teamCode').trim().toUpperCase();
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Checking...';
      try {
        const { teamName, roster } = await getRosterForTeamCode(teamCode);
        state.teamCode = teamCode;
        state.teamName = teamName;
        state.roster = roster;
        state.step = STEP.ROLE_PICK;
        render();
      } catch (err) {
        errorEl.textContent = err.message || 'Team code not recognized.';
        errorEl.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue';
      }
    });
  }

  function renderRolePickStep() {
    root.innerHTML = `
      <section class="screen">
        <h1>${escapeHtml(state.teamName)}</h1>
        <p class="hint">Who's logging in?</p>
        <div class="stack">
          <button id="pick-coach" class="btn btn-secondary btn-large">I'm the Coach</button>
          <button id="pick-player" class="btn btn-secondary btn-large">I'm a Player</button>
          <button id="back-team-code" class="btn btn-link">Use a different Team Code</button>
        </div>
      </section>
    `;
    root.querySelector('#pick-coach').addEventListener('click', () => {
      state.step = STEP.COACH_CODE;
      render();
    });
    root.querySelector('#pick-player').addEventListener('click', () => {
      state.step = STEP.PLAYER_PICK;
      render();
    });
    root.querySelector('#back-team-code').addEventListener('click', () => {
      state.step = STEP.TEAM_CODE;
      render();
    });
  }

  function renderCoachCodeStep() {
    root.innerHTML = `
      <section class="screen">
        <h1>Coach Login</h1>
        <form id="coach-code-form" class="stack">
          <label class="field">
            <span>Your Access Code</span>
            <input type="password" name="accessCode" required inputmode="numeric" class="code-input" autocomplete="off" />
          </label>
          <button type="submit" class="btn btn-primary btn-large">Log In</button>
          <button type="button" id="back-role" class="btn btn-link">Back</button>
          <p id="coach-code-error" class="error" hidden></p>
        </form>
      </section>
    `;
    const form = root.querySelector('#coach-code-form');
    const errorEl = root.querySelector('#coach-code-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      const accessCode = new FormData(form).get('accessCode');
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in...';
      try {
        const { teamId } = await loginAsCoach({ teamCode: state.teamCode, accessCode });
        onDone({ teamId, role: 'coach' });
      } catch (err) {
        errorEl.textContent = err.message || 'Incorrect access code.';
        errorEl.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Log In';
      }
    });
    root.querySelector('#back-role').addEventListener('click', () => {
      state.step = STEP.ROLE_PICK;
      render();
    });
  }

  function renderPlayerPickStep() {
    const rosterButtons = state.roster
      .map(
        (p) => `<button class="btn btn-secondary btn-large roster-btn" data-player-id="${p.id}">
          #${p.jerseyNumber ?? '--'} ${escapeHtml(p.firstName)}
        </button>`
      )
      .join('');
    root.innerHTML = `
      <section class="screen">
        <h1>Which one are you?</h1>
        <div class="stack roster-grid">
          ${rosterButtons || '<p class="hint">No players on this roster yet — ask your coach.</p>'}
        </div>
        <button type="button" id="back-role" class="btn btn-link">Back</button>
      </section>
    `;
    root.querySelectorAll('.roster-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const playerId = btn.dataset.playerId;
        state.selectedPlayer = state.roster.find((p) => p.id === playerId);
        state.step = STEP.PLAYER_CODE;
        render();
      });
    });
    root.querySelector('#back-role').addEventListener('click', () => {
      state.step = STEP.ROLE_PICK;
      render();
    });
  }

  function renderPlayerCodeStep() {
    root.innerHTML = `
      <section class="screen">
        <h1>Hi, ${escapeHtml(state.selectedPlayer.firstName)}!</h1>
        <p class="hint">Enter your access code.</p>
        <form id="player-code-form" class="stack">
          <label class="field">
            <span>Your Access Code</span>
            <input type="password" name="accessCode" required inputmode="numeric" class="code-input" autocomplete="off" />
          </label>
          <button type="submit" class="btn btn-primary btn-large">Log In</button>
          <button type="button" id="back-pick" class="btn btn-link">Not me</button>
          <p id="player-code-error" class="error" hidden></p>
        </form>
      </section>
    `;
    const form = root.querySelector('#player-code-form');
    const errorEl = root.querySelector('#player-code-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      const accessCode = new FormData(form).get('accessCode');
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in...';
      try {
        const { teamId, playerId } = await loginAsPlayer({
          teamCode: state.teamCode,
          playerId: state.selectedPlayer.id,
          accessCode,
        });
        onDone({ teamId, role: 'player', playerId });
      } catch (err) {
        errorEl.textContent = err.message || 'Incorrect access code.';
        errorEl.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Log In';
      }
    });
    root.querySelector('#back-pick').addEventListener('click', () => {
      state.step = STEP.PLAYER_PICK;
      render();
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
