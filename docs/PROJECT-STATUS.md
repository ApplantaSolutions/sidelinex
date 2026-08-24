# SidelineX — Project Status

**Last updated:** 2026-08-24, at the close of the "Practice Planner + Player
Development V1" milestone and a full project checkpoint.
**Read this first.** `README.md` and `DESIGN-PRINCIPLES.md` in this same
`docs/` folder predate almost everything below — they still describe
"Milestone 1 — project foundation." This file is the current source of
truth; treat the other two as historical/architectural background only,
not as an accurate feature list.

---

## 1. What SidelineX Is

A mobile-first coaching command center for NFL FLAG football, built for
Coach Chosen One Sports (5v5, format-configurable to 6v6/7v7). It is a
single owner (coach) + roster (players) app per team: coaches build a
Playbook, plan games and practices, log live snaps on the sideline, get
deterministic AI-assisted play-calling help, scout opponents, review
postgame analytics, and run practices connected to real game data.
Players get a read-only, personalized view of their own assignments and
practice prep.

No local database, no Docker, no bundler, no mobile SDK. Firebase
(Auth + Firestore + Hosting) is the backend; 4 auth-critical functions
that would normally be Firebase Cloud Functions instead run on Netlify
Functions (see §3 for why); the client is vanilla JS ES modules loaded
directly by the browser, no build step.

## 2. Architecture / Hosting Overview

```
sidelinex/                       ← this repo (git, branch: master)
├── firebase.json / .firebaserc / firestore.rules / firestore.indexes.json
├── public/                      ← Firebase Hosting root — the entire client app
│   └── js/
│       ├── auth.js              ← calls the 4 Netlify Functions + Firebase custom-token sign-in
│       ├── data.js              ← THE ONLY place real-vs-mock data layer is chosen (?dev=1)
│       ├── data-real.js         ← aggregates all real Firestore models
│       ├── models/              ← thin Firestore read/write accessors, one file per collection family
│       ├── dev/mock/            ← in-memory mock layer for ?dev=1 preview (zero Firebase imports)
│       ├── gameday/             ← Game Day + Sideline Advisor pure engines
│       ├── postgame/            ← Postgame Analytics + Season Self-Scout pure engines
│       ├── scouting/            ← Opponent Scouting taxonomy + pure engine
│       ├── practice/            ← Practice Planner pure logic + focus-area taxonomy
│       ├── playbook/            ← Play Designer, defense animation, viewers, static SVG renderer
│       ├── ui/coachHelp.js      ← centralized "?" contextual help system
│       └── views/{dashboard,playbook,games,scouting,practice}/
├── netlify-functions/           ← 7 Netlify Functions (see §3) — SEPARATE Netlify site, deployed independently
│   └── netlify/functions/
├── functions/                   ← LEGACY, currently unused: the original 4 Cloud Functions this
│                                   project would use if/when Firebase Blaze billing is unblocked.
│                                   Source kept in sync in spirit but not maintained function-by-function;
│                                   Netlify Functions are the live implementation. See §3.
└── docs/
    ├── PROJECT-STATUS.md        ← this file
    ├── DESIGN-PRINCIPLES.md     ← architecture principles (still accurate, read alongside this file)
    └── FIREBASE-SETUP.md
```

## 3. Firebase Project / Netlify Role

- **Firebase project:** `sidelinex-beta` — Firestore (Native mode) + Auth + Hosting.
  Live: **https://sidelinex-beta.web.app**
- **Why Netlify exists at all:** the Firebase project's Blaze (pay-as-you-go)
  billing plan is blocked (external account issue, unresolved as of this
  writing), which blocks Firebase Cloud Functions. The 4 auth-critical
  functions (`createTeam`, `login`, `addPlayer`, `getRosterPicker`) were
  ported to **Netlify Functions** instead — a separate Netlify site,
  `sidelinex-functions`, deployed independently via its own
  `netlify-functions/` directory and `netlify deploy --prod`.
  Live: **https://sidelinex-functions.netlify.app**
- Firestore, Firebase Auth (custom-token sign-in), and Firebase Hosting are
  **unaffected** by the Blaze block and work normally.
- 3 more Netlify Functions were added for AI features (all coach-only,
  server-side, `ANTHROPIC_API_KEY` never touches the browser):
  `analyzePlay` (AI Play Analyzer), `sidelineAdvisorExplain` (Sideline
  Advisor's AI explanation layer), `postgameSummary` (optional Postgame AI
  summary). **7 Netlify Functions live in total.**
- **If Blaze ever gets unblocked:** only `auth.js`'s `FUNCTIONS_BASE_URL`
  and its two fetch helpers would need to change back to
  `httpsCallable` — every function's business logic and security checks
  are already identical between `functions/` (legacy) and
  `netlify-functions/` (live).
- **Deploy commands** (always pass `--project` explicitly — see the
  "known environment quirk" in §11 about why):
  ```
  cd sidelinex && firebase deploy --only firestore:rules --project sidelinex-beta
  cd sidelinex && firebase deploy --only hosting --project sidelinex-beta
  cd sidelinex/netlify-functions && netlify deploy --prod
  ```

## 4. Data Model — Major Collections & Relationships

All under `teams/{teamId}/`:

| Collection | Written by | Read by | Notes |
|---|---|---|---|
| `seasons`, `ruleConfig` | coach | team | league rules are config, never hardcoded |
| `players/{id}` | coach | team | roster; `profile/self` subdoc is player-writable |
| `players/{id}/evaluations/{id}` | coach | **coach only** | Practice Planner V1 — private dev. observations |
| `players/{id}/checklist/current` | coach or self | coach or self | Game Ready Checklist — player's own prep status |
| `plays/{id}` + `versions/{id}` | coach | team | the Playbook; one play entity powers every feature, never copied |
| `games/{id}` | coach | team | `scoutId`, `ended`/`endedAt` live here |
| `games/{id}/weeklyRoles`, `gamePlan` | coach | team | slot→player mapping, per-game play selection |
| `games/{id}/gameDayMeta` | coach | team | started flag, starting possession |
| `games/{id}/snaps/{id}` | coach | team | THE source of truth every stat/analysis is derived from |
| `games/{id}/recommendations/{id}` | coach | team | Sideline Advisor self-scouting log (shown vs. called) |
| `scouts/{id}` | coach | **coach only** | Opponent Scouting — deliberately not team-readable |
| `practiceIdeas/{id}` | coach | **coach only** | bridges Postgame → Practice Planner |
| `practices/{id}` | coach | team | agenda/attendance/assignments — team information |
| `customFocusAreas/{id}` | coach | team | Practice Planner's extensible drill/focus tags |

**Nothing is ever duplicated across collections.** Plays are referenced by
id everywhere (Game Plan, Practice blocks) never copied. Every derived
number (stats, coverage splits, self-scout tendencies, postgame reports,
season rollups) is **recomputed live from `snaps` every time it's
needed** — never stored — so reopening a report always matches the real
data and can never drift.

## 5. Security Model

Enforced entirely in `firestore.rules`, keyed off `request.auth.token`
(`teamId`, `role`, `playerId?`) minted server-side by the `login`
function — **never** trusted from client-sent document fields.

- **`isTeamMember`** (coach or player, same team): read access to
  football planning/gameplay data that's legitimately useful to both —
  plays, games, weekly roles, game plan, snaps, recommendations,
  practices.
- **`isCoach`**: write access to all of the above, plus **both read and
  write** on anything explicitly private: `scouts`, `practiceIdeas`,
  `players/{id}/evaluations`.
- **`isSelf`**: a player may read/write only their *own*
  `profile/self` and `checklist/current` — never another player's.
- Credential hashes (`coachCredentials`, `playerCredentials`) have **no
  client read path at all** — only the Netlify Functions' Admin SDK
  (which bypasses rules) ever touches them.
- **Deliberate, product-driven deviation from the "team-member-read"
  default:** `scouts`, `practiceIdeas`, and `evaluations` are coach-only
  for READ too, not just write — scouting reports and development
  observations are explicitly not auto-exposed to Player Mode. This was
  a conscious per-milestone product decision, re-confirmed and
  re-validated live at every stage since Opponent Scouting V1.
- **Validation method used at every milestone (not just unit tests):**
  mint REAL coach + player Firebase ID tokens via the live Netlify
  functions + Identity Toolkit REST API, then hit the Firestore REST API
  directly to prove read/write behavior server-side. A throwaway team is
  always created, exercised, and then deleted (`firebase
  firestore:delete ... --recursive --force`), with an admin-token GET
  confirming 404 afterward. This is the standard this project holds
  itself to — spot-check it again before trusting any future security
  change.

## 6. Completed Features (by milestone, chronological)

1. **Milestone 1 — Foundation:** Team/Season bootstrap, Team Code +
   individual access-code auth (coach/player), provisional rule config.
2. **Milestone 2 — Playbook core + Play Designer V1:** guided
   step-by-step play builder, formations, routes with timing, no gesture
   ambiguity.
3. **Netlify Functions migration:** `createTeam`/`login`/`addPlayer`/
   `getRosterPicker` ported off blocked Firebase Cloud Functions.
4. **Coach-side contextual help system** (`ui/coachHelp.js`) — a "?"
   button + overlay on every major screen.
5. **Play Intelligence V1:** duplicate wristband-code hard block; product
   rule "if SidelineX already knows it, don't ask the coach to type it
   again" applied to Play Create/Edit; defensive players in Play
   Designer/Watch Play (MAN/ZONE/PRESSURE/CUSTOM looks, reaction-lag
   model with real leverage offset so a defender is shown running
   *alongside* the receiver, never on top of them, to visually explain
   why the primary target is open); multi-look defense (`design.defense.
   looks`) so Man AND Zone can both be built for one play and switched
   non-destructively; AI Play Analyzer (`analyzePlay` function) —
   strengths/weaknesses/best situations/coverage fit, HIGH/MEDIUM/LIMITED
   confidence only, never a fabricated number, server-side sanitized.
6. **Game Day Mode + Live Stats V1:** fast 2–3 tap snap logging; a single
   pure `applyResult(state, result, ruleConfig)` state-transition engine
   everything else builds on; live-derived stats (never separately
   stored); persistent Undo Last that recomputes state+stats correctly
   every time; local-first offline queue with idempotent client-generated
   snap IDs (`setDoc`, never `addDoc` — a retried sync can never
   duplicate a snap); turnover tracking (added this session — was
   previously hardcoded `false` and never actually capturable).
7. **Sideline Advisor V1:** deterministic filtering → transparent ranking
   → real stats/context → *optional* AI explanation. The AI layer
   (`sidelineAdvisorExplain`) only ever paraphrases already-ranked,
   already-computed reasons — it cannot choose or score plays, and every
   number in its output is server-side checked against the real input
   data (any invented number rejects the whole response, silently
   falling back to the deterministic reasons already on screen). Quick
   filter chips re-rank instantly. Every recommendation set is logged
   (`recommendations`) against what the coach actually called next, for
   self-scouting — explicitly not a "coach was wrong" scoreboard.
8. **Opponent Scouting + Defensive Intelligence V1:** chip/dropdown-only
   scout profiles (base look, tendency tags, rusher tags, playmaker
   cards, a simple visual defensive-alignment editor reusing the Play
   Designer's exact `{mode, defenders}` data shape, situational
   tendencies). Game Day's "Scout Intel" tab shows TODAY's tracked-look
   counts + RECENT sequence + WATCH playmakers — glanceable, no
   dashboard. The Advisor blends scouting in: **real current-game
   evidence always outranks stale pregame scouting** once enough live
   snaps exist, and states the conflict explicitly when it happens
   ("Pregame scouting suggested Man, but Zone has been observed on 6 of
   the last 8 tracked snaps").
9. **Postgame Analytics + Self-Scout V1:** confirmed END GAME → a fully
   *computed, never stored* Postgame Report (glanceable summary → Players
   → Plays → Defense → Self-Scout → Practice Ideas, expandable sections).
   Opportunity-vs-production framing (real target-share math, never a
   fake conclusion). Advisor-vs-Coach comparison using real logged
   yardage on overrides. Deterministic WORKED/REVIEW categorization with
   named, transparent sample-size thresholds. Optional AI paragraph
   (`postgameSummary`) with the same anti-fabrication server-side guard.
   Season Self-Scout rolls up every ended game by feeding more snaps into
   the exact same functions a single game's report uses (architecture
   directly supports Game → Season → future multi-season with **no**
   parallel aggregation logic to drift).
10. **Practice Planner + Player Development V1** (this session's final
    milestone): Practice Ideas (from Postgame, provenance-tagged
    `postgame`/`coach_manual`) flow into real practice agenda blocks
    (duration math, reorder, mark-complete); existing Playbook plays
    attach by reference only, never duplicated; assignments resolve to
    real players via Weekly Roles (whole team / specific players / role
    label) with zero retyping; one-tap attendance; short, neutral-
    vocabulary coach evaluations (execution/effort/understanding — never
    "bad"/"weak"/"elite") kept in a fully coach-only collection, strictly
    separate from real Game Statistics in the Player Development view
    (never blended into one score); Player Mode's "My Practice" shows
    only what's relevant to that one player and can open the real "Watch
    My Job" viewer directly from an assigned play; a 4-item Game Ready
    Checklist where only genuinely-verifiable actions (watching Watch My
    Job) get auto-marked — everything else is honest player self-report.

## 7. Current Milestone Status

**Practice Planner + Player Development V1 is complete, tested, and
deployed to `sidelinex-beta`.** This was the last planned milestone for
this work session — see §14 for the recommended next one.

## 8. Automated Test Counts (as of this checkpoint)

| Suite | Count | Invocation |
|---|---|---|
| Client pure-logic (scouting + gameday + playbook + postgame + practice) | 240 | `node --test public/js/scouting/*.test.js public/js/gameday/*.test.js public/js/playbook/*.test.js public/js/postgame/*.test.js public/js/practice/*.test.js` |
| `auth.js` call-logic walkthrough | 1 | `node --experimental-test-module-mocks --test public/js/auth.test.js` (flag required — see §11) |
| Netlify Functions (`netlify-functions/`) | 68 | `cd netlify-functions && npm test` |
| Legacy Cloud Functions helpers (`functions/`, currently unused) | 12 | `cd functions && node --test test/helpers.test.js` (see §11 — `npm test`'s directory form doesn't work here) |
| **Total** | **321** | all passing at this checkpoint |

Plus, at every milestone since Sideline Advisor V1, a live production
security + functional acceptance test was run against real Firestore with
real minted tokens (never just unit tests) — see §5. The most recent ones
(Postgame: 28/28, Practice Planner: 27/27) are the template for validating
any future change to security rules or derived-data correctness.

## 9. Permanent Design Principles

Restated here because they govern every future screen, not just past ones:

- **GLANCEABLE FIRST. DETAILED SECOND.**
- **IF SIDELINEX ALREADY KNOWS IT, DON'T ASK THE COACH TO TYPE IT AGAIN.**
- **AI ADVISES. COACH DECIDES.** — no feature anywhere auto-calls a play,
  auto-schedules a practice item, or auto-completes a checklist item it
  can't actually verify.
- **REAL CURRENT-GAME EVIDENCE OUTRANKS STALE ASSUMPTIONS.**
- **NO FAKE CERTAINTY — ALWAYS RESPECT SAMPLE SIZE.** Every rate/average
  anywhere in the app is shown with its real denominator; "LIMITED
  SAMPLE" language is used rather than implying false confidence; no
  screen anywhere states a raw fabricated percentage the underlying data
  doesn't actually support.
- Measured game data and subjective coaching observations are always
  structurally and visually separate — never blended into one score.
- Defense gets equal architectural treatment to offense.
- One structured `Play` entity powers every feature — never duplicated.
- Every AI call is server-side only, coach-only, and has its numeric
  output validated against the real input data before the client ever
  sees it. If an AI call fails or is rejected, the deterministic feature
  it supports must keep working completely on its own.

See `docs/DESIGN-PRINCIPLES.md` for the original, still-accurate longer
version of these.

## 10. Known Limitations (honest, current, not exhaustive)

- **Cross-device / multi-coach concurrent editing is out of scope.**
  Game Day's local-first queue only knows about writes made on the
  device that made them; two assistant coaches logging the same game
  simultaneously could conflict on order. Documented in
  `gameday/localQueue.js`.
- **Weekly-Roles-based role resolution for Practice Planner is a
  documented interpretation, not a perfect model:** a Practice isn't
  tied to one specific Game, so "role" assignments (WR1, QB, etc.) and
  Player Mode's "Watch My Job" both resolve using the **most recent
  game's** Weekly Roles as a stand-in context. Reasonable in a youth
  league where roles are fairly stable week-to-week, but not a
  historically-accurate snapshot if roles changed significantly between
  when a practice happened and now.
- **`?dev=1` preview mode must be removed or hardened before any real
  public beta** — currently gated only by a URL parameter (see
  `DESIGN-PRINCIPLES.md`'s "Dev Preview Mode Safety" section — still
  accurate and still unresolved).
- **The optional AI layers (Play Analyzer, Sideline Advisor explanation,
  Postgame summary) can and do sometimes return null** (anti-fabrication
  rejection or a transient API failure) — this is by design, not a bug,
  but it means a coach may occasionally see fewer AI sentences than
  expected. The deterministic features never depend on these succeeding.
- **No root-level `package.json`/test runner** ties every test suite
  together in one command — see §8's table for the 4 separate
  invocations currently required.

## 11. Known Environment Quirks (not bugs, but easy to trip on)

- **`firebase` CLI project resolution is unreliable when invoked from a
  git-bash-style path** (`/c/Users/...`) in this environment — it can
  silently fall back to a stale cached project for a parent directory
  instead of reading the correct local `.firebaserc`. **Always pass
  `--project sidelinex-beta` explicitly on every `firebase` command**,
  and do a read-only confirmation (e.g. `firebase firestore:databases:list
  --project sidelinex-beta`) before any write. This caused one real
  incident this session (rules briefly deployed to the wrong Firebase
  project) — fully remediated, but the underlying CLI quirk is still
  present and unexplained; treat it as environment-specific, not fixed.
- **`node --test test/` (directory form) fails on this Windows/Git-Bash
  setup** — always list test files explicitly, e.g. `node --test
  test/foo.test.js test/bar.test.js`.
- **`auth.test.js` requires `node --experimental-test-module-mocks`** —
  it uses `mock.module()`, unavailable without that flag.
- **Firestore's REST API does a full document REPLACE on `PATCH` unless
  `updateMask.fieldPaths` is given** — the real app code is unaffected
  (it always goes through the Firebase JS SDK's `setDoc(ref, data,
  {merge:true})`, which handles this correctly), but any future adhoc
  REST-based test script must add `updateMask.fieldPaths` explicitly for
  a partial update, or it will silently wipe other fields on that
  document. Caught and fixed twice this session in test scripts only —
  never shipped in application code.

## 12. Remaining Manual Tests (Edge/browser — not verified this session)

No browser automation tool (Playwright, Chrome extension, etc.) has been
available in this Claude Code session at any point since Sideline Advisor
V1. Every feature since then has been validated via automated unit tests
+ live server-side security/functional tests against real Firestore, but
**none of it has been visually confirmed in an actual browser.** Before
trusting this in front of real players/parents, manually check in Edge
(and ideally a real phone):

- Full coach flow: create team → roster → Playbook → Weekly Roles → Game
  Plan → Wristbands → Game Day (including defense chips, Sideline
  Advisor cards + filter chips, Scout Intel tab, End Game confirmation)
  → Postgame Report (expandable sections, AI Coach Notes button) →
  Practice Planner (block add/reorder/edit, attendance, evaluation form)
  → Player Development view.
- Full player flow: login → Playbook (read-only) → My Plays (Watch Play /
  Watch My Job animation) → My Practice (checklist, Watch My Job from an
  assigned practice play).
- Opponent Scout's visual defensive-alignment editor (tap-to-place,
  drag-to-move, remove-mode toggle) — this is the one genuinely
  hand-built drag interaction in the whole app and has zero automated
  coverage of the actual pointer events.
- Phone-width layout everywhere, especially the Postgame Report's
  accordion sections and the Practice block editor's several chip rows.

## 13. Unresolved Bugs/Blockers

**None identified in shipped code as of this checkpoint.** The only
standing external blocker is the Firebase Blaze billing block described
in §3, which has a fully-working alternate path (Netlify Functions) and
is not blocking any current functionality — it only matters if/when
Cloud Functions are wanted back.

## 14. Future Roadmap — Intentionally NOT Built Yet

Recorded so a future session doesn't accidentally re-derive or
second-guess these as new ideas — they were considered and deliberately
deferred, not missed:

- Richer player profiles / personalization (avatar, nickname, personal
  goals — the `profile/self` Firestore document already exists and is
  already player-writable per the rules; no UI was ever built for it).
- Gamification: stars, badges, streaks, preparation rewards, quizzes.
- "Help Me Understand This" — an in-context AI explainer for players.
- Player learning confirmation / quizzes.
- Team messaging / announcements.
- Richer drill/practice content (beyond the lightweight 10-item built-in
  focus-area list + custom team additions).
- Advanced player development analytics (trend lines over many practices,
  not just the current attendance/assignment/observation list).
- Advanced season analytics beyond the current Season Self-Scout rollup
  (e.g. cross-season comparison, once multiple seasons exist).
- High-school/college scaling considerations (this app's whole data
  model, rule config, and UX language currently assume one small youth
  team).
- Multi-team / organization administration (one coach, one team, one
  roster is the whole current model — no org-level anything).
- Film/video upload and computer-vision analysis.
- Film-assisted open-receiver / read detection.
- Film-derived defensive scouting (the `scouts` collection's `source`
  field already reserves `'film_derived'` as a future value alongside
  today's `'coach_manual'`/`'postgame'` — schema is ready, nothing else is).
- Deeper AI game-planning intelligence beyond the current
  deterministic-ranks/AI-explains split.

**Do not build any of the above without explicit direction** — they are
recorded as known future intent, not queued work.

## 15. Exact Recommended Next Milestone

When work on SidelineX resumes, the recommended next step (in the same
spirit as every milestone this session — deterministic-first, minimal
typing, glanceable, coach decides) is:

**Film Intelligence V1 — architecture only, still no computer vision.**
Every collection touched this session already carries a `source` field
convention (`coach_manual` / `postgame` / reserved `film_derived`)
specifically so this can slot in without a schema migration. The
recommended first slice is **not** video upload or CV — it's building the
clean human-in-the-loop workflow the roadmap describes: "Upload game film
→ identify/confirm plays → AI-assisted defensive observations → coach
reviews → scouting database," starting with just the confirm/review UI
against manually-entered observations (no video processing at all), so
the human workflow and data model are proven before any heavy video
dependency is added. Confirm this plan with the user before starting, as
with every milestone.

If that's not the direction wanted instead, the next-most-ready pieces
are: (a) the `?dev=1` hardening noted in §10, since it's a real
pre-launch blocker, or (b) building real UI for the already-rules-ready
`profile/self` player personalization mentioned in §14.
