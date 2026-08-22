# SidelineX

A mobile-first coaching command center for NFL FLAG football — starting
with Coach Chosen One Sports (5v5, expandable to 6v6/7v7). Built as a
lightweight, cloud-first web app (Firebase) with no local database, no
Docker, no bundler, and no mobile SDK.

**Status: Milestone 1 — project foundation.** See
`docs/FIREBASE-SETUP.md` for the one remaining manual step (re-authenticating
`firebase-tools`) before this can be deployed to a real project.

## What exists right now

- Team + Season creation (coach-only bootstrap flow)
- Provisional configurable league drive-rule config (4 downs to midfield,
  3 more to score — a default, not a hardcoded assumption; see
  `functions/index.js`'s `createTeam`)
- Secure Team Code + individual access-code authentication for both Coach
  and Player roles, via Firebase custom auth tokens minted server-side
  (`functions/index.js`) — no email/phone collected, no client-side
  credential comparison
- Coach dashboard: team info, rule config, roster, add-player flow
- Player dashboard: minimal placeholder (My Plays / My Assignments arrive
  in a later milestone, once the Playbook exists)
- Firestore security rules enforcing the coach-owned vs. player-editable
  data separation from day one (`firestore.rules`)

## What does not exist yet (by design — later milestones)

Playbook, Weekly Roles, Player Mode Lite (beyond the login shell above),
Game Plan builder, the drive/rule state engine, Game Day Mode, snap
logging, the deterministic Sideline Advisor, Practice Lite, League Rules
search, offline sync, PWA installability. See `docs/DESIGN-PRINCIPLES.md`
for the full architecture principles this is all being built against.

## Project structure

```
sidelinex/
├── firebase.json / .firebaserc / firestore.rules / firestore.indexes.json
├── public/                 ← Firebase Hosting root, vanilla JS, no build step
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── firebase-config.js   ← placeholder, fill in real values (see docs/FIREBASE-SETUP.md)
│       ├── firebase-init.js     ← loads Firebase SDK from CDN, no npm install for the client
│       ├── auth.js
│       ├── app.js               ← router/entry point
│       ├── models/              ← thin Firestore read accessors
│       └── views/{setup,login,dashboard}/
├── functions/               ← 4 small Cloud Functions: createTeam, addPlayer, login, getRosterPicker
│   ├── index.js
│   ├── lib/helpers.js       ← pure logic, unit-tested with Node's built-in test runner
│   └── test/helpers.test.js
└── docs/
    ├── DESIGN-PRINCIPLES.md
    └── FIREBASE-SETUP.md
```

## Local development

No local database, no emulator suite, no Docker — this project talks
directly to a real (free-tier) Firebase project. See
`docs/FIREBASE-SETUP.md` to provision one.

```
cd functions && npm install && npm test    # unit tests for the pure helper logic
```

The `public/` app has no build step — once a real Firebase project exists
and `firebase-config.js` is filled in, `firebase deploy` publishes it as-is.
