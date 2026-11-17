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

## How it is deployed

- Cloudflare Pages project `paralegal-tracker`, connected to this repo. Every push to `main` deploys. No build command, output directory `public`.
- D1 database `command-center`, bound as `DB` in `wrangler.toml`. Schema is in `migrations/0001_init.sql` (already applied).
- Sign-in is a Cloudflare Access application covering `paralegal-tracker.pages.dev` and `*.paralegal-tracker.pages.dev`.
  `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.toml` tie the site to that application; without them the site refuses every request.

**To let someone else in:** Zero Trust → Access controls → Policies → Legacy policies → "Allow Members - Cloudflare Pages" → add their email under Include.
Optionally set an `ALLOWED_EMAILS` secret (comma separated) on the Pages project as a second lock.

Never set `DEV_USER` in Cloudflare. It skips sign-in and exists only for local development.

## Run locally

```
npm install
echo "DEV_USER=you@example.com" > .dev.vars
npm run migrate:local
npm run dev
```

Tests for the sign-in gate: `node --test`
