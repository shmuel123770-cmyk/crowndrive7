Crown Drive - גרסת Pro Foundation

מה יש בחבילה:
- index.html - האתר המעודכן
- netlify/functions/db.mts - מסד נתונים + התחברות + מיילים
- package.json - dependencies ל-Netlify
- manifest.json + service-worker.js + icons - תמיכה בסיסית ב-PWA

העלאה:
1. GitHub -> crowndrive7 -> Add file -> Upload files
2. העלה את כל הקבצים והתיקיות מהתיקייה הזאת
3. Commit changes
4. חכה ל-Netlify Published

מומלץ ב-Netlify -> Environment variables להוסיף:
ADMIN_EMAIL=your admin email
ADMIN_PASS=your admin password
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=Crown Drive <no-reply@crowndrive770.com>
