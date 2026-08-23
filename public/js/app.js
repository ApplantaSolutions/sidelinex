import { getCurrentClaims } from './auth.js';
import { isDevMode } from './data.js';
import { renderCreateTeamView } from './views/setup/createTeam.js';
import { renderLoginView } from './views/login/login.js';
import { renderDashboardView } from './views/dashboard/dashboard.js';

const appRoot = document.getElementById('app');

async function start() {
  if (isDevMode) {
    // Local preview only — see public/js/data.js. Skips real Firebase Auth
    // entirely and goes straight to the coach dashboard against in-memory
    // mock data, so the UI can be reviewed while Milestone 1's auth Cloud
    // Functions are blocked. This can NEVER read or write real Firestore
    // data — data.js swaps in a pure in-memory mock module, not a
    // permissions bypass, and real security still comes entirely from
    // firestore.rules regardless of any client-side flag. MUST be removed
    // (or gated behind a build-time flag) before any real public beta —
    // see docs/DESIGN-PRINCIPLES.md's "Dev Preview Mode Safety" section.
    console.warn('[SidelineX] DEV PREVIEW MODE — showing mock data only, not connected to any real team.');
    showDashboard({ teamId: 'dev-team-1', role: 'coach' });
    return;
  }

  const claims = await getCurrentClaims();
  if (claims && claims.teamId && claims.role) {
    showDashboard(claims);
    return;
  }
  showEntry();
}

function showEntry() {
  appRoot.innerHTML = `
    <section class="screen entry">
      <div class="sx-mark" style="margin: 0 auto var(--space-2) auto;">SX</div>
      <h1>Sideline<span style="color:var(--sx-gold)">X</span></h1>
      <p class="hint">Game-day play command center.</p>
      <div class="stack">
        <button id="go-login" class="btn btn-primary btn-large">Log In</button>
        <button id="go-create" class="btn btn-secondary btn-large">Create a New Team</button>
      </div>
    </section>
  `;
  appRoot.querySelector('#go-login').addEventListener('click', () => {
    renderLoginView(appRoot, (claims) => showDashboard(claims));
  });
  appRoot.querySelector('#go-create').addEventListener('click', () => {
    renderCreateTeamView(appRoot, ({ teamId }) => {
      showDashboard({ teamId, role: 'coach' });
    });
  });
}

async function showDashboard(claims) {
  await renderDashboardView(appRoot, claims, () => showEntry());
}

start();
