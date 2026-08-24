// Loads the Firebase SDK from Google's CDN as native ES modules — no npm
// install, no bundler, no build step for the client app. Keeps the local
// project footprint to just this repo's own source files.
//
// Version pinned deliberately; bump it here (one line) when you want a
// newer SDK, rather than letting it float.
const SDK_VERSION = '11.0.2';

const { initializeApp } = await import(
  `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`
);
const { getAuth, signInWithCustomToken, onAuthStateChanged, signOut } = await import(
  `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`
);
const { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, where, orderBy, getDocs } = await import(
  `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`
);
// No firebase-functions import — the 4 auth-critical Cloud Functions are
// served from Netlify Functions instead (see auth.js), since the Firebase
// Blaze billing account is blocked. Firestore/Auth/Hosting stay on
// Firebase as normal; only those 4 functions moved.

import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  signInWithCustomToken,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
};
