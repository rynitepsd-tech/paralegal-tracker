# Command Center

A small private task board for two people: tasks with owner and status, who is working on what,
deadlines and motions, and an activity feed. Runs on Cloudflare Pages (static front end + Functions)
with a D1 database. No build step.

**The repository holds code only.** All tasks, deadlines and notes live in the D1 database, never in git.
Keep the repo private anyway.

## Layout

- `public/` front end (plain HTML, CSS, JS)
- `functions/_middleware.js` sign-in gate (verifies the Cloudflare Access token on every request)
- `functions/api/[[path]].js` JSON API
- `migrations/` database schema

## Deploy (one time)

1. **Create the database.** Cloudflare dashboard → Storage & Databases → D1 → Create, name it `command-center`.
   Open its Console tab and paste in the contents of `migrations/0001_init.sql`.
2. **Create the Pages project.** Workers & Pages → Create → Pages → Connect to Git → pick this repo.
   Framework preset: None. Build command: leave empty. Build output directory: `public`.
3. **Bind the database.** Pages project → Settings → Bindings → Add → D1 database. Variable name `DB`, database `command-center`.
   (Or put the database id in `wrangler.toml`, which then becomes the source of truth for bindings.)
4. **Turn on sign-in.** Zero Trust → Access → Applications → Add → Self-hosted.
   Add the site's hostname, and also `*.<project>.pages.dev` so preview links are covered.
   Policy: Allow → Emails → the two email addresses. Copy the application's **AUD tag**.
5. **Set variables.** Pages project → Settings → Variables and secrets (Production and Preview):
   - `ACCESS_TEAM_DOMAIN` e.g. `yourteam.cloudflareaccess.com`
   - `ACCESS_AUD` the AUD tag from step 4
   - `ALLOWED_EMAILS` the two emails, comma separated (a second lock on top of the Access policy)
6. Redeploy. Until step 5 is done the site refuses every request, by design.

Never set `DEV_USER` in Cloudflare. It skips sign-in and exists only for local development.

## Run locally

```
npm install
echo "DEV_USER=you@example.com" > .dev.vars
npm run migrate:local
npm run dev
```

Tests for the sign-in gate: `node --test`
