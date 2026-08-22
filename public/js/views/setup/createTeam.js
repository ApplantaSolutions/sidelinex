import { createTeam } from '../../auth.js';

export function renderCreateTeamView(root, onDone) {
  root.innerHTML = `
    <section class="screen">
      <h1>Create Your Team</h1>
      <p class="hint">This sets up SidelineX for your team. You'll get a Team Code to share with players and coaches.</p>
      <form id="create-team-form" class="stack">
        <label class="field">
          <span>Team Name</span>
          <input type="text" name="teamName" required autocomplete="off" placeholder="e.g. Chosen One Sports 7th Grade" />
        </label>
        <label class="field">
          <span>Format</span>
          <select name="format" required>
            <option value="5v5" selected>5v5</option>
            <option value="6v6">6v6</option>
            <option value="7v7">7v7</option>
          </select>
        </label>
        <label class="field">
          <span>Your Coach Access Code</span>
          <input type="text" name="coachAccessCode" required minlength="4" inputmode="numeric" placeholder="Pick a 4+ digit code" />
        </label>
        <button type="submit" class="btn btn-primary btn-large">Create Team</button>
        <p id="create-team-error" class="error" hidden></p>
      </form>
    </section>
  `;

  const form = root.querySelector('#create-team-form');
  const errorEl = root.querySelector('#create-team-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
      const { teamId, teamCode, seasonId } = await createTeam({
        teamName: formData.get('teamName'),
        format: formData.get('format'),
        coachAccessCode: formData.get('coachAccessCode'),
      });
      onDone({ teamId, teamCode, seasonId });
    } catch (err) {
      errorEl.textContent = err.message || 'Something went wrong creating the team.';
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Team';
    }
  });
}
