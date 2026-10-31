# My Day: medicine & routine tracker

A small personal web app for ticking off daily tasks (including medicine), earning golden stars, seeing how each month went, and knowing when to reorder. It runs entirely on Cloudflare: one Worker serves the app and a JSON API, and D1 (SQLite) stores the data.

## What it does

- **Daily flow:** tasks grouped into Morning / Evening / Any time, shown as reminder cards. Tick one and the card turns green with your "done" message. Undo is one tap away.
- **Golden stars:** 1 star per completed task, plus 1 bonus star when everything for the day is done. Stars are never stored; they're worked out from your history, so they can't drift out of sync.
- **Calendar:** month view showing how each day went (all done / mostly / some / none). Tap a past day to see it, or to tick off something you forgot.
- **Medicine stock:** counts doses, tells you how many days are left, and warns when it's time to order (for example with 7 days left for NHS prescriptions). Medicines that are supplied automatically get no reorder alerts.
- **Installable:** add it to your phone's home screen and it behaves like an app. Light and dark mode follow your device.

## Run it locally

You need Node 22.18 or newer.

```bash
npm install
npm run db:migrate:local     # create the tables in a local SQLite copy of D1
npm run db:seed:local        # optional: example tasks (estrogen, teeth brushing)
npm run dev                  # build + run; open the address wrangler prints
```

`npm run dev` rebuilds the React app when you change files. Refresh the page to see changes.

## Deploy

```bash
npx wrangler login
npx wrangler d1 create medicine-tracker
```

Paste the `database_id` it prints into `wrangler.jsonc`, then:

```bash
npm run db:migrate:remote
npm run db:seed:remote       # optional
npm run deploy
```

Wrangler prints your address (something like `medicine-tracker.<you>.workers.dev`).

### Lock it down with Cloudflare Access (do this before using it for real)

The app has no login of its own. **Cloudflare Access** puts a login in front of it, which is free for up to 50 users. This is health data, so don't skip it.

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Point it at your Worker's address (a custom domain, or the `workers.dev` address). Wording in the dashboard changes now and then; for `workers.dev` there's also an option under the Worker's **Settings → Domains & Routes** to enable Access.
3. Add a policy that allows only your email address. The default one-time email code works on any device.
4. Optional extra layer: the Worker can also check the Access token on every API call, so the API refuses requests even if Access is ever misconfigured. In the application's settings copy the **Application Audience (AUD) tag**, then add these to `wrangler.jsonc` under `vars` and redeploy:

   ```jsonc
   "vars": {
     "ACCESS_TEAM_DOMAIN": "your-team.cloudflareaccess.com",
     "ACCESS_AUD": "the-aud-tag-you-copied"
   }
   ```

   Leave them out for local development.

If your Access login expires while the app is open, the app shows "Can't reach the server… reload the page to sign in again" with a Reload button.

## How the numbers work

**Tasks and history.** A task counts on every day from the day it was added until the day it was retired. Adding or retiring a task never changes past days or past months. "Restore" on a retired task starts a fresh copy from today for the same reason.

**Dates** are local calendar days (`2026-10-31`), chosen by your browser, so the server's timezone never matters. If you're often up past midnight, set `DAY_STARTS_AT_HOUR` in `src/client/dates.ts` (for example `4`) so "today" rolls over at 4am instead.

**Medicine stock** is counted in individual doses:

- Each tick of a task linked to the medicine uses `amount` doses (the dose in force that day). Changing the dose only affects days from the new date.
- **Log delivery** adds doses (enter tubes/boxes or doses). **Recount** says "at the end of this day I have exactly N", replacing the running total. Do a recount whenever the estimate drifts (priming a pump, spills, a forgotten tick).
- Days left = doses on hand ÷ doses used per day. The reorder alert appears when days left is at or below the medicine's "order when this many days are left" setting. "Order about N packs" covers the "full order should last" period, for example 90 days × 4 doses ÷ 64 per tube = 6 tubes.
- Supplied-automatically medicines skip the alert but can still track stock if you log deliveries.
- The dose schedule has an `every_n_days` field for the projection, but the daily task flow ticks once a day, so leave it at 1 for now. Medicines taken less often than daily aren't properly supported yet.
- Medicines with no linked task can't count doses automatically; use recounts.

## Project layout

```
src/core/       dates, stars, calendar: pure functions
src/medicine/   stock maths: pure functions
src/worker/     the API (Worker entry point is index.ts)
src/client/     the React app and styles
src/shared/     types used by both sides
migrations/     SQL schema (applied by wrangler)
seed/seed.sql   optional example data
public/         manifest and icons
scripts/        build + dev scripts
test/           tests
```

The idea behind the design is to **log what happened and derive the rest**. Completions, deliveries and recounts are the only facts stored. Stars, calendar colours and stock left are calculated from them when needed.

The medicine code is kept in its own folders (`src/medicine/`, `src/worker/medicines.ts`) and the core (`tasks`, `completions`) knows nothing about medicine, so other features can be added later without risking the daily flow.

## Tests

```bash
npm test            # 84 tests: dates, stars, calendar, stock, the API, the Access check
npm run typecheck
```

The tests run the real SQL migrations and the real API handler against Node's built-in SQLite (`node:sqlite`) standing in for D1, so they need no Cloudflare account.

## Notes on how it's built

I kept dependencies to a minimum: the Worker has no runtime dependencies (a tiny built-in router and validators instead of Hono and Zod), the queries are plain SQL on D1 (no ORM), and the React app is bundled with esbuild (no Vite). That's deliberate: it keeps the project small enough to read in an evening. Hono, Drizzle, Zod or Vite are all easy to bring in later if you want them.

## Ideas for later

- Reminders: Cron Triggers on the Worker can send Web Push notifications to the installed app, or post to a Discord webhook like your old setup.
- A low-stock warning for automatically supplied medicines when no delivery has been logged.
- Medicines taken every few days (needs tasks that recur).
- More modules (journalling, check-ins and so on) as separate folders using the same tasks/completions core.
