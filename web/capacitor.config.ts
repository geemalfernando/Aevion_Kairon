import type { CapacitorConfig } from '@capacitor/cli'

// The Android app ships the built web bundle and talks to the hosted API (VITE_API_URL at build time).
// Its WebView origin is https://localhost, which the API must list in WEB_ORIGIN.
const config: CapacitorConfig = {
  appId: 'com.aevion.kairon',
  appName: 'Kairon',
  webDir: 'dist',
  android: { allowMixedContent: false },
}

export default config
