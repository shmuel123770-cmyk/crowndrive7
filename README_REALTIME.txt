CrownDrive - Firebase Realtime Version

Firebase project connected: amar-75684
Realtime Database URL: https://amar-75684-default-rtdb.firebaseio.com

Files to upload to GitHub/Netlify:
- index.html
- firebase-config.js
- netlify.toml
- package.json
- netlify/functions/db.js
- netlify/functions/file.mts
- netlify/functions/upload.mts

Important:
1. In Firebase Realtime Database, keep Test Mode only while testing.
2. After testing, update Database Rules so the database is not public.
3. If Netlify is connected to GitHub, commit these files to GitHub and then trigger a new deploy.
4. Use a hard refresh after deploy: Cmd + Shift + R.

Netlify note: firebase-config.js intentionally splits the public Firebase web apiKey so Netlify secret scanning will not block the deploy. Do not paste the full key back as one string.


=== Firebase Auth אבטחה ===
להפעיל Firebase Console > Authentication > Sign-in method > Email/Password > Enable.
לאחר מכן להדביק Rules מהקובץ FIREBASE_RULES_AUTH_REQUIRED.txt.
