// Firebase client configuration.
//
// This object is SAFE to be public — Firebase's client config (apiKey,
// projectId, ...) is NOT a secret. It only identifies the project to the
// SDK; it grants nothing. All access control lives in firestore.rules /
// storage.rules (enforced server-side, keyed off custom-token claims that
// only the Netlify `login` function can mint) plus the project's
// Authorized Domains list. See SECURITY.md.
//
// The values below are PLACEHOLDERS in this public repository. To run
// SidelineX against a real Firebase project, replace them with that
// project's web config (Firebase Console -> Project Settings -> General
// -> Your apps -> Web app, or `firebase apps:sdkconfig web`). The live
// beta at https://sidelinex-beta.web.app is deployed with its own real
// config, which is not committed here. The offline preview (?dev=1) never
// contacts Firebase and works with these placeholders as-is.

export const firebaseConfig = {
  apiKey: 'REPLACE_WITH_YOUR_FIREBASE_WEB_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000000000',
};
