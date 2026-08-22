# Firebase Project Setup — Handoff

Everything in this repo is written and ready. One step genuinely requires
you personally, because it's an interactive browser login I cannot complete:

## The one blocking step

`firebase-tools` (already installed on this machine) is signed in as
`dev@applanta.app`, but that session has expired. Run this once:

```
firebase login --reauth
```

It'll open a browser window for you to confirm — takes about 30 seconds.

## After you're re-authenticated, either:

**Option A — let me finish it.** Tell me you've re-authenticated and I can
run the rest from here: `firebase projects:create`, enabling
Firestore/Auth/Functions/Hosting via the CLI, `firebase deploy` for rules
and functions, and pulling the real client config into
`public/js/firebase-config.js`.

**Option B — do it yourself via the Firebase Console** (console.firebase.google.com):
1. Create a new project (any name, e.g. "sidelinex-beta").
2. Enable **Firestore** (production mode — the real rules in
   `firestore.rules` will be deployed on top, so "production mode" default
   deny is correct and expected).
3. Enable **Authentication** — no sign-in providers need to be turned on;
   this app only ever uses custom tokens minted by the `login` Cloud
   Function, which requires no provider configuration in the console.
4. Enable **Hosting**.
5. Under Project Settings → General → Your apps, add a **Web app** and
   copy its config object into `public/js/firebase-config.js` (replacing
   the placeholders). This config is safe to be public — it is not a
   secret.
6. Update `.firebaserc`'s `"default"` value to your real project ID.
7. From this repo: `firebase deploy --only firestore:rules,hosting,functions`

Either way, nothing else in the codebase needs to change — the whole app
was built against `DATABASE`-agnostic Firestore/Auth/Functions calls with
no project-specific assumptions baked in anywhere.
