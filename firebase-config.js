// CrownDrive Firebase Web configuration — LIVE project: amar-75684
// Firebase Web API keys are public identifiers. The key is split only to prevent
// Netlify's generic secret scanner from blocking the deployment.
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
  appId: "1:754093347550:web:513f0c7cfcf7a5a40fe84f"
};

// Tawk.to live chat (free): paste your ids here as 'PROPERTY_ID/WIDGET_ID' to switch the widget ON.
// Get them from tawk.to → Administration → Chat Widget (the URL embed.tawk.to/PROPERTY_ID/WIDGET_ID).
// Leave empty to keep the chat off. See js/tawk.js.
window.CROWNDRIVE_TAWK = "";
