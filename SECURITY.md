# Security

## No server credentials in this repository

- The **Firebase Admin service account** is read from the
  `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable (set in the Netlify site's
  environment, raw JSON or base64) — never committed. See
  `netlify-functions/netlify/functions/_lib/firebaseAdmin.js`.
- The **Anthropic API key** is read from the `ANTHROPIC_API_KEY` environment
  variable, server-side only, in the 3 AI functions. It never reaches the
  browser.
- `.env` / `.env.local` are git-ignored.

## The committed Firebase client config is a placeholder

`public/js/firebase-config.js` in this repo contains placeholder values. Firebase's
**client** config (`apiKey`, `projectId`, `appId`, …) is not a secret by
design — it identifies the project to the SDK and grants nothing. Real access
control is:

1. `firestore.rules` / `storage.rules`, enforced server-side, keyed off
   custom-token claims (`teamId`, `role`, `playerId`) that **only** the Netlify
   `login` function can mint;
2. the Firebase project's **Authorized Domains** list;
3. credential hashes that have **no client read path at all**.

The live beta (`https://sidelinex-beta.web.app`) is deployed with its own real
client config, which is not committed. Replacing the placeholders with a real
project's config is the only step needed to run against live Firebase.

## Authorization model

Every Firestore access is gated by `firestore.rules`. The rules never read a
client-supplied document field to make an access decision — only
`request.auth.token`. Scouting reports (`scouts`), development observations
(`players/{id}/evaluations`), and bridging practice ideas (`practiceIdeas`) are
coach-only for **read** as well as write.

Validated at every milestone with real minted coach + player ID tokens against
the real Firestore REST API (not just unit tests), on a throwaway team that is
then recursively deleted and confirmed gone. See `docs/PROJECT-STATUS.md` §5.

## AI output is validated before the client sees it

Every AI response's numeric claims are checked server-side against the real input
data. An invented number rejects the entire response; the deterministic feature
it supports keeps working on its own.

## Reporting

This is a portfolio repository. If you find a security-relevant issue in the code,
open a GitHub issue describing the class of problem — not a working exploit.
