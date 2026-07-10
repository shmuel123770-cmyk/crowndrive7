Crown Drive - תיקון חיבור Database

אם האתר מחזיר DB_NOT_READY עם הודעה על connectionString:
1. Netlify → Project crowndrive7 → Database.
2. לפתוח את branch: production.
3. ללחוץ Copy connection string.
4. Project configuration → Environment variables.
5. להוסיף:
   Key: NETLIFY_DB_URL
   Value: connection string שהעתקת
6. Save ואז Trigger deploy / Upload to GitHub and wait Published.

הקובץ db.mts בגרסה הזאת קורא קודם NETLIFY_DB_URL / DATABASE_URL / NETLIFY_DATABASE_URL, ורק אחר כך מנסה את getConnectionString().
