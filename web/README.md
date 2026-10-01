# Kairon web

See the [root README](../README.md#frontend-web) for setup, demo accounts and architecture.

## Deploy to Vercel

Live frontend: **https://kairon-eight.vercel.app**

Deploy this `web` directory as the Vercel project root. The checked-in `vercel.json` configures the Vite build, `dist` output, and SPA fallback so refreshing routes such as `/login` works. It also keeps the service worker revalidated for app updates. See [Vercel's Vite guide](https://vercel.com/docs/frameworks/frontend/vite).

From the repository root:

```sh
npm --prefix web ci
npm --prefix web run build
npx vercel login
npx vercel link --project kairon --scope geemal-fernandos-projects
npx vercel --prod
```

The Vercel project is connected to GitHub. Commit and push the frontend files to make them available for Git deployments. For a new Git-based deployment, import the repository in Vercel and set **Root Directory** to `web`. Use the **Vite** preset, **Build Command** `npm run build`, and **Output Directory** `dist`.

The frontend currently uses local demo data; no backend environment variables are required.

## Brand assets

The supplied route logo replaces the original K mark. Light and dark variants follow the app theme; dark surfaces and startup screens use the white/green variant. The adaptive SVG is used for the web favicon.

Source SVGs live in `web/public/brand/` and are mirrored in `mobile/assets/brand/`. From the repository root, run `python3 scripts/generate_brand.py` (requires Pillow) after changing the source artwork. This regenerates Flutter vector paths, web install icons, Android launcher/startup images, and iOS app/startup images. PNG exports are rendered at four times their target size before downsampling; the iOS app icon includes a 1024px export. The generator supports the supplied SVGs’ M/L/Z path geometry.
