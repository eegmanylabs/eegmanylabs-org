// Firebase initialisation. Nothing outside src/data imports this file or the Firebase SDK.
import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { config } from "@/app/config";

export const app = initializeApp(config.firebase);

// initializeAuth instead of getAuth keeps the pop-up machinery, and with it Google's helper
// script, out of the page unless Google sign-in is built in.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  ...(config.googleSignIn ? { popupRedirectResolver: browserPopupRedirectResolver } : {}),
});

// A persistent cache in IndexedDB, shared and kept consistent across browser tabs.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const functions = getFunctions(app, config.functionsRegion);

if (config.emulators) {
  const { host, auth: authPort, firestore, functions: functionsPort } = config.emulators;
  connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, firestore);
  connectFunctionsEmulator(functions, host, functionsPort);
}
