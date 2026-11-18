# Running Qarīb

Everything here is free: GitHub (code, builds, APK downloads) and Cloudflare (API and database).

## 1. Deploy the API (once, about 15 minutes)

You need a free Cloudflare account.

1. In this folder, sign in to Cloudflare:
   ```bash
   npx wrangler login
   ```
2. Create the database:
   ```bash
   npx wrangler d1 create qarib
   ```
   Copy the `database_id` it prints into `api/wrangler.toml`.
3. Create the tables:
   ```bash
   npx wrangler d1 execute qarib --remote --file=api/schema.sql --config api/wrangler.toml
   ```
4. Set the server secret: paste 40+ random characters when asked, and keep no other copy.
   ```bash
   npx wrangler secret put PEPPER --config api/wrangler.toml
   ```
5. Deploy:
   ```bash
   npx wrangler deploy --config api/wrangler.toml
   ```
   It prints a URL such as `https://qarib-api.<you>.workers.dev`.
6. Put that URL in `src/config.js` as `apiUrl`, and set `updateRepo` to your GitHub repo (`owner/name`).
7. Make yourself the owner. In the app, create your account in the Portal, then run:
   ```bash
   npx wrangler d1 execute qarib --remote --config api/wrangler.toml --command "UPDATE users SET is_owner = 1 WHERE email = 'you@example.com'"
   ```
   The dashboard appears in your Portal from then on.

To let GitHub deploy API changes automatically, add a `CLOUDFLARE_API_TOKEN` repository secret (Cloudflare → My Profile → API Tokens → "Edit Cloudflare Workers" template).

**Resetting an imam's password:** there's no email reset, which also means nobody can take over an account through email. Delete the account, and the imam signs up again and re-requests their masjid:
```bash
npx wrangler d1 execute qarib --remote --config api/wrangler.toml --command "DELETE FROM users WHERE email = 'imam@example.com'"
```

## 2. Publish the APK (GitHub Releases)

One-time setup: the repository must be **public**, because a private repository's Releases can't be downloaded by the public. The code contains no secrets; the tests check that. Then add two repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | contents of `.keys/keystore-base64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | contents of `.keys/keystore-password.txt` |

**Keep `.keys/` safe forever.** Every update must be signed with the same key, or Android refuses to install it over the old version. Keep an offline backup, for example on a USB drive. It is never committed, because `.gitignore` excludes it.

**To release a version:**
1. Set `version` in `src/config.js` (for example `1.0.1`).
2. Commit it.
3. Tag and push:
   ```bash
   git tag v1.0.1
   ```
   ```bash
   git push origin main v1.0.1
   ```

GitHub then runs the tests, builds and signs the APK, and publishes **Qarib-v1.0.1.apk** with its SHA-256 checksum on the Releases page, in about 6 minutes. Share this link: https://github.com/rehank1/qarib/releases/latest.

**Installing:** users open the link on their phone, download the APK and tap it. Android asks once to "allow installs from this source".

## 3. Pushing updates

| What changed | How it reaches users |
|---|---|
| Jamaat times | **Instantly.** Imams publish in the Portal and phones fetch the new times (cached at most 60 s on the server). No app update. |
| Nearby masjid list | **Automatically.** Refreshed from OpenStreetMap at most weekly per area. |
| The API (bug fixes, limits) | **Instantly** for everyone when you deploy the Worker. No app update. |
| The app itself (screens, features) | **New release.** Tag a version as in section 2. Phones check GitHub once a day and show "Version 1.0.1 is available · Download the update"; the user taps, downloads and installs over the old version, keeping their settings. |

Sideloaded apps can't update silently. That only becomes possible through the Play Store (a one-time $25 fee).

## 4. Load: the first 5,000–10,000 users

**What one active user costs per day:**
- about 4–5 API requests: one masjid lookup, one or two jamaat-time lookups, and one or two batched usage reports;
- about 6–7 database writes: usage counters, rate-limit counters, and the daily "active" mark.

Prayer times cost nothing: each phone calculates them itself.

| Cloudflare free limit (per day) | 10,000 daily users need | Headroom |
|---|---|---|
| Worker requests: 100,000 | ~50,000 | 2× |
| D1 rows read: 5,000,000 | ~150,000 | 30× |
| D1 rows written: 100,000 | ~70,000 | 1.4× |
| D1 storage: 5 GB | a few MB | huge |

**What keeps it light:**
- **Masjid searches are shared.** One OpenStreetMap lookup serves everyone in a ~2 km area for a week. Ten thousand people in Pune cause a few hundred map lookups, not ten thousand.
- **Jamaat times are cached** at Cloudflare's edge for 60 s, and on each phone.
- **Usage reports are batched:** one request per few seconds of use, and anonymous.
- **Requests are rate-limited** per network address, so one misbehaving phone or bot can't use up the quota.
- **If the API ever hits its daily limit,** the app keeps working: prayer times are local, and masjid search falls back to OpenStreetMap directly.

**When you grow past about 12,000 daily users,** the first limit you'll reach is database writes. Either:
- move to Cloudflare Workers Paid at $5/month, which includes 50 million D1 writes a month; or
- sample the usage counts, for example from one phone in four.

GitHub Release downloads have no bandwidth limit for public repositories.

## 5. The dashboard

Sign in to the Portal with the owner account. The dashboard refreshes every 30 seconds and shows:
- **Active today:** phones that opened the app today. Each phone counts once per day and can't be linked between days.
- **App opens today**, and **Directions today** (taps on the Directions button).
- **Active users over 14 days,** as a bar chart.
- **Most visited masjids over 7 days,** by Directions taps and by how often each was shown in the list.
- **Imam requests,** with Approve and Reject buttons.

**Not collected, by design:**
- **Not collected:** anyone's location, name or device.
- **Never stored:** the phone's install ID itself, only a hash that changes daily.

Users can turn usage counts off in Settings → Usage counts.
