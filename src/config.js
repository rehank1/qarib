// Deployment settings. Everything here is PUBLIC (it ships inside the app). Never put a secret here:
// the API's only secret (PEPPER) lives in Cloudflare, set with `npx wrangler secret put PEPPER`.
export const CONFIG = Object.freeze({
  version: '1.0.0', // keep in step with package.json; the release tag v1.0.0 must match
  apiUrl: '', // e.g. 'https://qarib-api.<your-subdomain>.workers.dev'. Empty = demo mode (portal on this phone only)
  updateRepo: 'rehank1/qarib', // 'owner/repo' on GitHub: the app checks its Releases for a newer APK. Empty = no update check
  appName: 'Qarīb',
  masjidLimit: 3,
  staleDays: 45, // jamaat times older than this are flagged "may be out of date"
});
