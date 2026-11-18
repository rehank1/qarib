# Security

## What the earlier version got wrong, and what this one does

The v2 built in the earlier chat fixed the obvious XSS but kept one core flaw: **the authority login lived on each phone**. Anyone could mark times "verified" in DevTools, and an imam's update never reached anyone else. That isn't a bug you can patch on the client. It needs a server that decides.

| Risk | v2 (previous chat) | Qarīb 1.0 |
|---|---|---|
| Fake "verified" times | Possible: local flag | **Impossible from the client.** Postgres row-level security: only an *approved* authority can write *that* masjid; approval exists only in the owner's dashboard |
| Who changed what | Unknown | Server stamps `updated_by` / `updated_at`; every change is kept in an audit table clients cannot read or alter |
| Password storage | SHA-256 × 10,000 on device | The phone runs PBKDF2-SHA256 × 600,000 (salted by email) and sends only the derived key. The API stores SHA-256(per-user salt · key · server pepper), so a stolen database alone is useless. Lockout after 5 wrong tries, per-IP limits. Demo: the same PBKDF2 on the phone |
| Brute force | 5 tries → 5 min | Server-side rate limits; demo: 5 tries → 5 min, doubling up to 80 min; a missing account takes as long as a wrong password, so accounts can't be probed |
| Write flooding | None | 30 changes/hour per account and 5 open claims per account, enforced in the database |
| XSS | `innerHTML` with static strings | **No HTML sinks at all.** DOM built with `textContent`; Trusted Types enforced by CSP so `innerHTML` would throw; a test fails the build if one appears |
| Untrusted OSM data | Escaped | Validated: ids against `^(node\|way\|relation)/\d+$`, coordinates as finite numbers in range, names stripped of control and bidi characters, length-capped |
| Links | String-built | `directionsUrl()` accepts only numbers; the `h()` builder refuses any `href` that isn't https, `#` or `./` |
| CSP | `unsafe-inline` styles | `default-src 'none'`; scripts and styles from self only; no inline anything; `connect-src` limited to the 5 hosts the app uses; `frame-ancestors 'none'`, HSTS and Permissions-Policy via headers |
| Location privacy | Exact coordinates cached | Rounded to ~110 m before use or storage; prayer times computed on the device; nothing sent anywhere except the rounded point, to OpenStreetMap |
| Native app | — | Android: no cleartext, no mixed content, WebView debugging off in release |

## Threat model

- **A malicious OpenStreetMap edit** (a masjid named `<script>…`): renders as text. Covered by tests.
- **A hostile user with DevTools:** can change only their own phone. The server ignores client claims about identity and approval.
- **A stolen anon key:** it is public by design and grants only what RLS allows: reading times, and requests that need a signed-in account.
- **A stolen authority session:** the token lasts 30 days. Only its hash is stored, so a database leak gives no usable tokens. Signing out deletes it, and the owner can delete all of a user's sessions. Damage is limited to that masjid, rate-limited and fully audited, so the owner can roll it back.
- **An overloaded or hostile Overpass mirror:** responses are validated like any other untrusted input. Hedged requests cap the wait, and a failure never triggers an automatic retry loop.

## Penetration test · 18 November 2026

Run against the live app in Chromium with the production security headers, plus a review of the client code and the database schema. Every fix has a regression test (35 tests in total).

| # | Attack | Result before | Fix |
|---|---|---|---|
| 1 | Masjid name containing markup (`<img src=x onerror=…>`) | Did not run, but showed as raw text on the card | `cleanText()` removes tags and stray angle brackets from every displayed name and label |
| 2 | Crafted link `#hasOwnProperty`, `#constructor`, `#toString` | App crashed or showed "[object Object]" | Routes and settings are looked up with `own()` (own properties only) |
| 3 | Tampered saved data: masjid with `lat: "javascript:…"`, list not an array | Masjids screen went blank | Cached lists are re-validated on load; one bad entry discards the cache and the app fetches fresh |
| 4 | Tampered settings `method: "__proto__"` | Times computed as NaN | Unknown methods fall back to the default |
| 5 | Forged demo session in storage | Accepted as signed in | A session must match an existing account |
| 6 | Junk jamaat times in storage, or "verified" flag injected | Rendered junk | Times re-validated; "verified" is never inherited from storage |
| 7 | Database: `select=updated_by` on public times | Exposed which account edited each masjid | Column-level grants: the public can read times and dates only |
| 8 | Database: call `is_masjid_admin` as an anonymous RPC | Callable | Execute revoked from anon |
| 9 | Two token refreshes at once | Could get the session revoked (refresh-token reuse) | Single in-flight refresh |
| 10 | Dev server reachable from other devices on the Wi-Fi | Listened on all interfaces | Binds to 127.0.0.1 |
| 11 | CSP allowed any `*.supabase.co` | Exfiltration target if XSS ever slipped in | Build pins the CSP to your project (or none in demo mode) |
| 12 | Map server failure | Automatic retry loop hammered the server (got HTTP 429) | No automatic retries after a failure; hedged mirrors, one request each |

**Attacks that were already blocked:** inline `<script>` injection, `insertAdjacentHTML` and inline `onclick` (Trusted Types), `javascript:` links, string timers (and so `eval`), `fetch` and image beacons to unknown hosts (CSP), framing the app in an iframe (`frame-ancestors 'none'`), path traversal on the dev server (`..`, `%2e%2e`, `..%5c`, null bytes), query injection into Overpass (numbers only), and unsafe link targets (`h()` refuses non-https).

**API permissions (Cloudflare Worker + D1):** tested in `tests/api.test.js` against real SQLite. Pending, unapproved and other-masjid writes are refused; only the owner can approve; forged, expired and signed-out tokens fail; SQL-like input is inert; bodies over 4 KB and non-JSON bodies are refused; CORS allows only the listed origins. The deployed Worker itself has not been tested yet: repeat the three refusal checks once it is live.

## Remaining risks (be aware)

- The refresh token sits in on-device storage, which is standard for PWAs and Capacitor apps. Strict CSP and Trusted Types are what protect it. For the native apps, moving it to the Keychain / Android Keystore via `@capacitor/preferences` with secure storage is a sensible next step.
- **Account recovery** is manual: the owner deletes the account and the imam signs up again. This is deliberate (no email takeover), but slow at scale.
- **Android APKs are sideloaded.** Publish the SHA-256 checksum with every release (the workflow does this), and keep the signing key in `.keys/` safe and backed up offline.
- The owner's approval step is a human check. Call the masjid before approving.

Report a vulnerability privately to the project owner; please don't open a public issue.
