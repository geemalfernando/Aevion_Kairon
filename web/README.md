# Kairon web

React/Vite frontend for the Kairon API, hosted on [AWS](https://d10j8dr2q1dn87.cloudfront.net). See the [root setup guide](../README.md) for judge accounts and local Docker setup, and the [deployment guide](../docs/deployment.md) for AWS releases.

```sh
npm ci
npm run dev
```

Vite proxies `/api` to `http://localhost:8080`; start the API separately or use Docker Compose. The browser signs in through the API, renews its session, and queues field events locally while offline.

Native builds require `VITE_API_URL=https://d10j8dr2q1dn87.cloudfront.net`. The hosted web app and API share the same origin. Credentials remain in the server environment.

```sh
npm run lint
npm run build
```
