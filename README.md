# Qarīb · قَرِيب

**Masjids and prayer times near you, free, for India.** "Qarīb" means *near*, and it is also how Allah describes Himself in the Quran (2:186): "I am near; I answer the call of the caller when he calls Me."

- **Prayer:** today's six times calculated on the phone (Indian standard, Fajr and Isha at 18°; Hanafi or Shafi'i Asr). Works offline; the location never leaves the phone for this. Hijri date adjustable to the local moon sighting.
- **Masjids:** the 3 nearest, with distance, walking time, the masjid's own jamaat times (when its imam publishes them) and a Directions button that opens Google Maps.
- **Portal:** imams sign in, ask to manage their masjid, and publish jamaat times after the owner approves them.
- **Dashboard (owner only):** live, anonymous numbers: active users, app opens, Directions taps per masjid, imam requests to approve.
- **Salawat reminder** when the app opens (can be turned off).
- **Light and free:** no framework, no web fonts, no paid service. Android APK published on GitHub Releases, API on Cloudflare's free plan.

## Try it on this PC

```bash
npm test
```

```bash
npm run serve
```

Then open http://localhost:4180. With no API configured, the portal runs in **demo mode** (accounts and times stay on that one phone, labelled "Demo").

## Structure

```
index.html, styles/          app shell (strict CSP, Trusted Types) and design tokens
src/app.js                   state, routing, caching rules, startup (salawat, update check, usage counts)
src/config.js                public settings: version, apiUrl, updateRepo, masjidLimit
src/core/                    dom (no innerHTML) · store · validate · net · geo · format · metrics · update
src/data/                    api.js (live) · demo.js (on this phone) · backend.js (picks one)
src/features/prayer/         prayer engine · home screen · salawat reminder
src/features/masjids/        OpenStreetMap search (hedged mirrors) · masjid cards with Directions
src/features/location/       location in context · city search
src/features/portal/         imam sign-in, claim, publish · owner dashboard
api/                         Cloudflare Worker + D1 schema (the free backend)
android/                     Capacitor Android project (icons, splash, permissions, release signing)
.github/workflows/           tests · signed APK → GitHub Release · API deploy
design/logo/                 the Qarīb logo (SVG + PNG) and its notes
tests/                       48 tests: prayer maths, security, contrast, the API against real SQLite
```

## Going live

[docs/OPERATIONS.md](docs/OPERATIONS.md) walks through it step by step:
1. deploy the free API (Cloudflare),
2. publish the first APK (GitHub Releases),
3. push updates,
4. how the load of the first 5,000–10,000 users is handled,
5. using the dashboard.

See [SECURITY.md](SECURITY.md) for the threat model and pentest, and [docs/DESIGN.md](docs/DESIGN.md) for the design system.
