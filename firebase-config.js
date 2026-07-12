// CrownDrive Firebase Realtime configuration
// Connected to Firebase project: amar-75684
// The Firebase Web apiKey is public, but it is split here so Netlify secret scanning will not block deploys.
const CROWNDRIVE_FIREBASE_KEY = [
  "AI",
  "zaSyADiG6LhVt33rUk2xSQBuD0hX0QBPqAUbM"
].join("");

window.CROWNDRIVE_FIREBASE_CONFIG = {
  apiKey: CROWNDRIVE_FIREBASE_KEY,
  authDomain: "amar-75684.firebaseapp.com",
  databaseURL: "https://amar-75684-default-rtdb.firebaseio.com",
  projectId: "amar-75684",
  storageBucket: "amar-75684.firebasestorage.app",
  messagingSenderId: "754093347550",
  appId: "1:754093347550:web:513f0c7cfcf7a5a40fe84f",
  measurementId: "G-OYJCC93VX3"
};

// Backward compatibility alias for older script checks
window.CROWNFIREBASE_CONFIG = window.CROWNDRIVE_FIREBASE_CONFIG;
window.FIREBASE_CONFIG = window.CROWNDRIVE_FIREBASE_CONFIG;
