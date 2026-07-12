# CrownDrive V2 — הפעלה בטוחה

## לפני פריסה
1. גבה את Realtime Database ואת Storage.
2. פרוס תחילה באתר Staging נפרד.
3. ב-Netlify הוסף משתני סביבה:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — JSON מלא של Service Account (סוד; לא להעלות ל-GitHub).
   - `FIREBASE_DATABASE_URL` — `https://amar-75684-default-rtdb.firebaseio.com`
   - `FIREBASE_STORAGE_BUCKET` — `amar-75684.firebasestorage.app`
4. התקן dependencies דרך Netlify (`npm install` מתבצע אוטומטית).
5. פרסם את `FIREBASE_DATABASE_RULES_V2.json` ב-Realtime Database Rules.
6. פרסם את `FIREBASE_STORAGE_RULES_V2.txt` ב-Storage Rules.

## העברת נתונים
היכנס כמנהל ב-Staging ולחץ "בדיקת והעברת נתונים ישנים". הפעולה מעתיקה בלבד מ-`crowndrive-live/state/data`; היא אינה מוחקת את הנתונים הישנים.

## אבטחת קבצים
הדפדפן אינו קורא או כותב ישירות ל-Storage. Netlify Functions בודקות Firebase ID token והרשאות, ומחזירות כתובת חתומה לזמן קצר.

## בדיקות חובה לפני חי
- הרשמה/כניסה/יציאה ורענון רגיל ובסתר.
- שוכר: אימות מייל, העלאת מסמכים, הזמנה, תשלום והודעות.
- בעל רכב: הוספת רכב, אישור/דחייה/סיום הזמנה.
- מנהל: צפייה במשתמשים ואישור אימות.
- ניסיון משתמש לא מורשה לקרוא מסמך של משתמש אחר חייב להיכשל.
