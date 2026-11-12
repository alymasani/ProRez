Recorded (fictional) provider responses used by `npm run test:e2e:db`.
The app reads them instead of the network only when `PROREZ_ATS_TRANSPORT=fixtures`
and the database name ends in `_e2e` or `_test` (see lib/ats/http.ts).
File name = host + path + `__` + sorted query string + `.json`.
A file containing `{ "__status": 429 }` simulates that HTTP error.
