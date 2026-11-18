# Qarīb · قَرِيب

**Masjids and prayer times near you, free, for India.** "Qarīb" means *near*, and it is also how Allah describes Himself in the Quran (2:186): "I am near; I answer the call of the caller when he calls Me."

- **Prayer:** today's six times calculated on the phone (Indian standard, Fajr and Isha at 18°; Hanafi or Shafi'i Asr). Works offline; the location never leaves the phone for this. Hijri date adjustable to the local moon sighting.
- **Masjids:** the 3 nearest, with distance, walking time, the masjid's own jamaat times (when its imam publishes them) and a Directions button that opens Google Maps.
- **Portal:** imams sign in, ask to manage their masjid, and publish jamaat times after the owner approves them.
- **Dashboard (owner only):** live, anonymous numbers: active users, app opens, Directions taps per masjid, imam requests to approve.
- **Salawat reminder** when the app opens (can be turned off).
- **Light and free:** no framework, no web fonts, no paid service. Android APK on GitHub Releases, backend on Supabase's free plan.

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
src/config.js                public settings: version, Supabase URL + public anon key, updateRepo
src/core/                    dom (no innerHTML) · store · validate · net · geo · format · metrics · update
src/data/                    supabase.js (live backend) · demo.js (development only) · backend.js
src/features/prayer/         prayer engine · home screen · salawat reminder
src/features/masjids/        OpenStreetMap search (hedged mirrors) · masjid cards with Directions
src/features/location/       location in context · city search
src/features/portal/         imam sign-in, claim, publish · owner dashboard
supabase/                    schema.sql (security rules) · directory.sql (India masjid directory)
android/                     Capacitor Android project (icons, splash, permissions, release signing)
.github/workflows/           tests · signed APK → GitHub Release · API deploy
design/logo/                 the Qarīb logo (SVG + PNG) and its notes
tests/                       46 tests: prayer maths, security, contrast, database rules on real Postgres
tools/probe-supabase.mjs     outsider test: what the public key can and cannot do
```

## Going live

[docs/OPERATIONS.md](docs/OPERATIONS.md) walks through it step by step:
the backend, releasing and announcing updates, security and load.

See [SECURITY.md](SECURITY.md) for the threat model and pentest, and [docs/DESIGN.md](docs/DESIGN.md) for the design system.
