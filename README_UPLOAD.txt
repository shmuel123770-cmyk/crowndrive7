Crown Drive - Cloud Storage Ready

Upload these files/folders to your GitHub repository crowndrive7:

1. index.html
2. package.json
3. manifest.json
4. service-worker.js
5. icon-192.png
6. icon-512.png
7. the full netlify folder, including:
   netlify/functions/db.mts
   netlify/functions/upload.mts
   netlify/functions/file.mts

After upload, click Commit changes. Netlify will deploy automatically.

The new cloud upload endpoints are:
POST /.netlify/functions/upload
GET  /.netlify/functions/file?key=...

Use upload folders like:
- car-photos
- license-front
- license-back
- chat-images
- payment-screenshots

