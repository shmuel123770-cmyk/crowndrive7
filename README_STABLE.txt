Crown Drive - stable build

This build uses Netlify Blobs as the live backend for records/auth/sessions.
It does NOT use NETLIFY_DB_URL, so a wrong readonly Database URL will not break the site.

After upload:
1. Commit changes in GitHub.
2. Wait for Netlify Published.
3. In Netlify Environment variables, delete NETLIFY_DB_URL if it contains readonly.
4. Open https://crowndrive770.com/.netlify/functions/db
   Expected: {"ok":true,"function":"db","engine":"netlify-blobs"...}
5. Hard refresh the site.

Admin login:
Owner login screen:
shmuel123770@icloud.com
amarZ770@
