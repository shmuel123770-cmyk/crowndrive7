Crown Drive - חיבור Database (Netlify Database)

חשוב: אין צורך להגדיר ידנית connection string.
Netlify Database מזריק אוטומטית את מחרוזת החיבור הנכונה (קריאה+כתיבה) לכל דיפלוי:
- Production deploy → מסד הנתונים הראשי (production/main).
- Deploy preview → ענף מבודד עם עותק של נתוני הפרודקשן.

הפונקציה db.mts משתמשת ב-getConnectionString() מ-@netlify/database שקורא את
החיבור המנוהל הזה, כך שאין צורך לגעת ב-Environment Variables.

השגיאה "DB_NOT_READY - permission denied for schema public":
הסיבה הנפוצה היא NETLIFY_DB_URL שהוגדר ידנית עם מחרוזת חיבור לקריאה בלבד
(read-only). ערך ידני כזה דורס את החיבור המנוהל של Netlify וגורם לשגיאה.

מה לעשות:
1. Netlify → Project crowndrive7 → Project configuration → Environment variables.
2. אם קיים משתנה NETLIFY_DB_URL שהוגדר ידנית — למחוק אותו (Delete/Unset).
   כך Netlify יספק שוב את החיבור המנוהל עם הרשאות קריאה+כתיבה.
3. Trigger deploy ולחכות ל-Published.

סכימת הטבלאות (crown_records / crown_auth / crown_sessions) נוצרת כעת דרך migration
בתיקייה netlify/database/migrations/, ומיושמת אוטומטית על ידי Netlify בזמן הדיפלוי.
הפונקציה כבר לא מריצה CREATE TABLE בזמן ריצה, ולכן היא צריכה רק הרשאות קריאה+כתיבה
לטבלאות — לא הרשאות בעלות (owner) על schema public.
