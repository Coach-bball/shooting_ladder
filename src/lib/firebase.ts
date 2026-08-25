import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { doc, getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const hasConfig = Object.values(firebaseConfig).every(Boolean);

export const firebaseApp = hasConfig
  ? getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const firestoreDb = firebaseApp ? getFirestore(firebaseApp) : null;
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
export const googleAuthProvider = firebaseApp ? new GoogleAuthProvider() : null;
export const firebaseStorage = firebaseApp ? getStorage(firebaseApp) : null;

export const shootingLadderStateDoc = firestoreDb
  ? doc(firestoreDb, "teams", "default", "state", "main")
  : null;

export const isFirebaseConfigured = Boolean(firebaseApp && firestoreDb && shootingLadderStateDoc);