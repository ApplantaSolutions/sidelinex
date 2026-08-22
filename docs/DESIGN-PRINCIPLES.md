# SidelineX — Design Principles

Recorded as project-wide, not milestone-specific — every future screen
(Playbook, Weekly Roles, Player Mode, Game Plan, Game Day, Stats, Practice)
should be checked against these before it's considered done.

## Glanceable First, Detailed Second

SidelineX should prioritize, in this order:

1. **Readable text** — no cramped type, no low-contrast gray-on-gray.
2. **Large, useful touch targets** — minimum ~52px tap height on anything
   interactive (`--tap-min` in `styles.css`); never a target so small it
   requires careful aim.
3. **Strong visual hierarchy** — a screen's most important fact (a code, a
   result, a name) should be the biggest, boldest thing on it.
4. **Minimal scrolling** — a screen should mostly fit without scrolling on
   a typical phone.
5. **Minimal typing** — prefer selection (buttons, pickers, quick-pick
   chips) over free-text entry wherever the set of real answers is small.
6. **Fast mobile use** — every flow should assume the user is standing up,
   possibly outdoors, possibly in a hurry.

This is why, for example, the player login flow (`js/views/login/login.js`)
has the player *pick their name from a list* rather than type it, and why
the coach dashboard shows the Team Code and rule config as large, bold
numbers rather than a dense settings table.

## Architecture Principles Carried Into Every Milestone

(Restated from the approved architecture review — not new, kept here so
future milestones don't have to re-derive them.)

1. One structured `Play` entity will power coach, player, game-day,
   wristband, assignments, and analytics experiences — no duplicated copies.
2. League rules are configurable data (`ruleConfig` documents), never
   hardcoded assumptions in application logic.
3. AI advises; the coach decides. The AI never selects a play automatically.
4. AI never fabricates statistics, probabilities, or confidence.
5. Measured data is kept structurally separate from subjective coaching
   observations.
6. Game Day Mode prioritizes speed over feature density, always.
7. Player views derive from structured assignments (slot-based, see
   `firestore.rules`'s player/coach separation) rather than duplicate data.
8. Defense receives equal architectural treatment to offense.
9. Practice and player development connect directly to game preparation.
10. Offline capability is architected for from the start; PWA packaging is
    a deliberately final phase.
11. Build first for the real-world Milestone 1 beta team without
    preventing later expansion to other teams/coaches.

## Coach-Owned vs. Player-Editable Data

Enforced at the schema and security-rule level starting in Milestone 1,
even though the player-editable UI doesn't exist yet:

- `teams/{id}/players/{playerId}` and every sibling coach-only collection
  added in later milestones (weekly roles, evaluations, attendance, stats,
  assignments, coaching notes) — **coach-writable only, always.**
- `teams/{id}/players/{playerId}/profile/self` — reserved for
  player-editable fields (avatar, nickname, personal goals). A player may
  only ever write their own. Not built as a UI yet; the permission
  boundary is real starting now so it never needs retrofitting.
