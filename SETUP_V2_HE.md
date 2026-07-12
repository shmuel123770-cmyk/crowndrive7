# CrownDrive V2 — התקנה צעד־אחר־צעד

## 1. לא להעלות מיד לאתר החי
פרוס קודם ב־`crowndrive-staging`. הקובץ מחובר כרגע לפרויקט Firebase החי בקובץ `firebase-config.js`; לצורך Staging החלף אותו ב־config של פרויקט הבדיקה.

## 2. גיבוי
לפני כל שינוי:
- Realtime Database → Export JSON
- שמור עותק של ה־repository וה־ZIP הקודם

## 3. משתני סביבה ב־Netlify
באתר ה־Staging: **Project configuration → Environment variables** והוסף:

- `FIREBASE_SERVICE_ACCOUNT_JSON` — תוכן JSON מלא של Service Account. זה סוד; לעולם לא להעלות ל־GitHub.
- `FIREBASE_DATABASE_URL` — לדוגמה `https://amar-75684-default-rtdb.firebaseio.com`
- `FIREBASE_STORAGE_BUCKET` — לדוגמה `amar-75684.firebasestorage.app`

יצירת Service Account:
Firebase → Project settings → Service accounts → Generate new private key. העתק את תוכן הקובץ למשתנה Netlify ומחק את הקובץ המקומי לאחר מכן.

## 4. כללי Realtime Database
העתק את כל התוכן של `FIREBASE_DATABASE_RULES_V2.json` אל:
Realtime Database → Rules → Publish.

הכללים חוסמים כל כתיבה ישירה מהדפדפן. כל שינוי עסקי עובר דרך Netlify Functions עם בדיקת Firebase ID token והרשאות.

## 5. כללי Storage
העתק את `FIREBASE_STORAGE_RULES_V2.txt` אל Storage → Rules → Publish.

הדפדפן לא מקבל גישה ישירה ל־Storage. קישורי העלאה וקריאה נחתמים לזמן קצר בשרת.

## 6. CORS להעלאות חתומות
העלה את `storage-cors.json` ל־Cloud Storage bucket באמצעות Google Cloud Shell:

```bash
gcloud storage buckets update gs://YOUR_BUCKET --cors-file=storage-cors.json
```

החלף `YOUR_BUCKET` בשם המדויק של ה־bucket. אם כתובת ה־Staging שלך שונה, הוסף אותה לקובץ לפני הפקודה.

## 7. מנהל
ב־Realtime Database צור:

```text
admins/{FIREBASE_UID} = true
```

הערך חייב להיות Boolean אמיתי.

## 8. פריסה
העלה את כל תוכן התיקייה לשורש `main`. Netlify מריץ אוטומטית:

```bash
npm run check && npm test
```

פריסה תיכשל אם קיימים מאזיני Auth כפולים, כתיבה ישירה למסד, שגיאת תחביר או קובץ שרת חסר.

## 9. העברת הנתונים הישנים
היכנס כמנהל ב־Staging ולחץ **העברת נתונים ישנים**.

הכלי:
- קורא מ־`crowndrive-live/state/data`
- מנסה להתאים משתמשים ל־Firebase Auth לפי UID או מייל
- מעתיק רק רשומות שאינן קיימות במבנה החדש
- אינו מוחק או משנה את הנתונים הישנים

לאחר ההעברה בדוק ידנית את מספר המשתמשים, הרכבים וההזמנות.

## 10. בדיקות תפקידים לפני חי
צור שלושה חשבונות בדיקה:
- שוכר
- בעל רכב
- מנהל

בדוק:
1. הרשמה, כניסה, יציאה ורענון בחלון רגיל ובסתר.
2. אימות מייל, רישיון קדמי/אחורי וסלפי.
3. אישור אימות על ידי מנהל.
4. הוספת רכב, תמונה אוטומטית, גיל מינימלי, מסירה וכתובת פרטית.
5. בקשת הזמנה, אישור/דחייה והודעות.
6. הוכחת תשלום ותיעוד לפני נסיעה.
7. תיעוד החזרה וסיום הזמנה.
8. דירוג רכב ושני הצדדים.
9. לאחר סיום הזמנה: בעל הרכב אינו יכול עוד לפתוח את מסמכי השוכר.
10. משתמש שאינו צד להזמנה אינו יכול לקרוא מסמכים, תשלום, כתובת או הודעות.

## 11. מעבר לאתר החי
רק אחרי שכל הבדיקות עוברות:
- ודא ש־`firebase-config.js` מצביע לפרויקט החי
- פרסם את Rules V2 בפרויקט החי
- הגדר את משתני Netlify באתר החי
- בצע Deploy without cache
- השאר את הגיבוי הישן לפחות 30 יום
