import { getCurrentClaims } from './auth.js';
import { renderCreateTeamView } from './views/setup/createTeam.js';
import { renderLoginView } from './views/login/login.js';
import { renderDashboardView } from './views/dashboard/dashboard.js';

const root = document.getElementById('app');

async function start() {
  const claims = await getCurrentClaims();
  if (claims && claims.teamId && claims.role) {
    showDashboard(claims);
    return;
  }
  showEntry();
}

function showEntry() {
  root.innerHTML = `
    <section class="screen entry">
      <h1>SidelineX</h1>
      <p class="hint">Game-day play command center.</p>
      <div class="stack">
        <button id="go-login" class="btn btn-primary btn-large">Log In</button>
        <button id="go-create" class="btn btn-secondary btn-large">Create a New Team</button>
      </div>
    </section>
  `;
  root.querySelector('#go-login').addEventListener('click', () => {
    renderLoginView(root, (claims) => showDashboard(claims));
  });
  root.querySelector('#go-create').addEventListener('click', () => {
    renderCreateTeamView(root, ({ teamId, teamCode }) => {
      showDashboard({ teamId, role: 'coach' });
    });
  });
}

async function showDashboard(claims) {
  await renderDashboardView(root, claims, () => showEntry());
}

start();
