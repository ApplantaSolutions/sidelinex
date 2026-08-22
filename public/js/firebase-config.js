// Firebase client configuration.
//
// This object is SAFE to be public — Firebase's client config (apiKey,
// projectId, etc.) is not a secret; real security comes entirely from
// firestore.rules and the server-side login Cloud Function, both already
// built. Do not treat these values as sensitive.
//
// REPLACE the placeholders below with the real values from:
// Firebase Console -> Project Settings -> General -> Your apps -> Web app
// (or `firebase apps:sdkconfig web` once the project exists and you're
// logged in).

export const firebaseConfig = {
  apiKey: 'REPLACE_WITH_REAL_API_KEY',
  authDomain: 'REPLACE_WITH_REAL_PROJECT_ID.firebaseapp.com',
  projectId: 'REPLACE_WITH_REAL_PROJECT_ID',
  storageBucket: 'REPLACE_WITH_REAL_PROJECT_ID.appspot.com',
  messagingSenderId: 'REPLACE_WITH_REAL_SENDER_ID',
  appId: 'REPLACE_WITH_REAL_APP_ID',
};
