# Kairon web

React frontend for the Supabase-backed Kairon API. See the [root setup guide](../README.md) for the SQL migration, user seed, and real data import.

```sh
npm ci
npm run dev
```

Vite proxies `/api` to `http://localhost:8080`; start the server in another terminal. The app always uses the API. There are no local demo accounts or sample data fallbacks.

For Vercel, use `web` as the root directory, `npm run build` as the build command and `dist` as the output. Set `VITE_API_URL` to the deployed API origin before building. Configure `WEB_ORIGIN` and `PUBLIC_API_URL` on that API as described in the root README. A static frontend deployment alone does not host the API.

Supabase secrets belong only in the server environment. The browser signs in through `/api/auth/login`, renews its session, and sends authenticated commands to the API. Field events are queued locally while offline.

```sh
npm run lint
npm run build
```
