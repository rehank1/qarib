# Running Qarīb

Free on two services: **GitHub** (code, signed APK builds, downloads) and **Supabase** (project `qarib`, `lgjivmerhgmypxhepqlt`, free plan, Asia-Pacific).

## 1. The backend (already set up)

| Part | Where |
|---|---|
| Tables, security rules, owner functions, usage counts, update notice | `supabase/schema.sql` |
| India masjid directory, nearest-masjid search, scheduled import | `supabase/directory.sql` |
| App connection (public URL + public anon key) | `src/config.js` |

Both SQL files are safe to re-run: Supabase → **SQL Editor** → paste → **Run** (choose **Run and enable RLS** if asked). The secret `service_role` key is never used anywhere.

**The masjid directory fills itself.**
- A scheduled job loads one area of India per minute from OpenStreetMap, big cities first (Pune first).
- Busy areas retry after 10 minutes, and an area too dense for the public map server is split into smaller pieces.
- Every area refreshes weekly.
- If someone opens the app where nothing is loaded yet, that area jumps to the front of the queue, and the app asks OpenStreetMap directly meanwhile.
- Progress shows on the owner dashboard: "masjid directory: … areas of India loaded".

**Make yourself the owner (once).**
1. In the app, Portal → **Create account**, then confirm the email Supabase sends you.
2. In Supabase → SQL Editor, run:
   ```sql
   update public.profiles set is_owner = true where user_id = (select id from auth.users where email = 'you@example.com');
   ```
3. Open the Portal again: the dashboard appears.

**Approving imams:** in the dashboard (Approve, Reject, Remove, or Remove and hide times).

**Resetting an imam's account:** Supabase → Authentication → Users → the user → delete. The imam signs up again and re-requests their masjid.

## 2. Releasing a new version

1. Set `version` in `src/config.js` (for example `1.0.2`).
2. Commit it.
3. Tag and push:
   ```bash
   git tag v1.0.2
   ```
   ```bash
   git push origin main v1.0.2
   ```
4. GitHub runs the tests, builds and signs the APK, and publishes it at https://github.com/rehank1/qarib/releases/latest, together with the silent-update bundle (`qarib-web-<version>.zip`) and `qarib-web.json` (about 3 minutes).
5. **That's it: phones update themselves.** On their next open, apps from v1.1.0 on download the new version in the background. The updater checks its SHA-256 and switches over on the following open, and a version that fails to start is rolled back automatically. Nobody downloads anything.

**Only when the Android shell changes** (a new plugin or permission, which is rare):
1. Raise `qarib.minNative` in `package.json` to the new version before tagging.
2. After the release, announce it in the dashboard (**Announce an update**). Older apps then show "Update available" and the person installs the APK once.

Keep `.keys/` (the signing key) backed up offline; every release must be signed with it.

## 3. What reaches users, and when

| Change | When users see it |
|---|---|
| An imam publishes jamaat times | Instantly; pull to refresh on Masjids |
| Masjid list for an area | When its area loads, then weekly |
| A new app version | Silently: downloaded on next open, applied on the open after (from v1.1.0) |

## 4. Security

- **Only the public anon key is in the app.** It can read published times, search the directory, read the update notice, send anonymous usage counts (rate-limited) and create an imam account that can do nothing until you approve it.
- **Everything else is closed:** accounts, emails, requests, the audit history, usage data and every write. Run `node tools/probe-supabase.mjs` at any time to prove it from the outside; 21 checks, all must say OK.
- **Anything added to the database later starts closed** until it is explicitly granted.

## 5. Load

The free plan includes 500 MB of database storage, 50,000 monthly active users, and 5 GB of data transfer a month.
- **The India directory is small:** about 50–100 MB.
- **Worshippers never sign in,** so only imams count towards the 50,000 monthly users.
- **Each app open costs a few small requests,** typically under 10 KB in total.

One thing to watch: **free Supabase projects pause after 7 days without activity.** Normal daily use keeps it awake. If it ever pauses, open the project in the Supabase dashboard and click Restore.

## 6. Tests

```bash
npm test
```

There are 46 tests:
- prayer-time maths checked against Aladhan;
- security and contrast checks;
- every database rule run on a real Postgres engine (PGlite) as an anonymous worshipper, an imam and the owner.
