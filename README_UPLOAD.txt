Crown Drive - גרסת פרסום מתוקנת

מה יש כאן:
- index.html
- package.json
- manifest.json
- service-worker.js
- icon-192.png
- icon-512.png
- netlify.toml
- netlify/functions/db.mts
- netlify/functions/upload.mts
- netlify/functions/file.mts

מה תוקן:
1. הודעת השגיאה "error decoding lambda response / unexpected end of JSON input" תוקנה על ידי החזרת תשובות Lambda תקניות מהפונקציות.
2. כניסת מנהל נשארה כמו שביקשת: נכנסים דרך "בעל רכב" עם הפרטים שלך.
3. אין כפתור מנהל גלוי ואין #admin.
4. תקנון + מדיניות פרטיות + הסבר מי רואה רישיון נשארו באתר.
5. הרשאות בסיסיות בצד השרת נשארו: שוכר רואה רק שלו, בעל רכב רק שלו, מנהל הכול.
6. תמונות נשמרות ב-Netlify Blobs דרך upload/file.

פרטי מנהל ברירת מחדל:
email: shmuel123770@icloud.com
password: amarZ770@

אפשר גם להגדיר ADMIN_EMAIL ו-ADMIN_PASS ב-Netlify Environment Variables אם תרצה להחליף בלי לערוך קוד.

העלאה:
1. חלץ את ה-ZIP.
2. העלה את כל הקבצים והתיקייה netlify ל-GitHub repository crowndrive7.
3. Commit changes.
4. חכה ב-Netlify ל-Published.
