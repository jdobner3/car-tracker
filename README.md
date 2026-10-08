# Garage — car maintenance tracker

Tracks maintenance for Justin's 2024 RAV4 Hybrid Limited and Kelsey's 2019 GMC Terrain SLT 1.6L diesel.
Switch cars with the dropdown at the top.

- **Services:** log each one with photos or PDF receipts and notes, or scan a receipt to fill the form in.
- **Due dates:** see what's overdue, based on miles per day estimated from your own readings.
- **Email reminders:** maintenance coming due, new recalls, renewals, and warranties ending.
- **Per-car records:** a "what to buy" parts card, warranties, and owner's manuals.
- **Codes:** look up trouble codes.

Runs on Cloudflare (free tier), with Resend for email (free tier) and the Claude API for receipt reading
(pennies per receipt). Live at https://cars.justdob.com. Pushing to `main` on GitHub deploys it (Workers Builds).

| Piece | Product | Binding / setting |
|---|---|---|
| UI (`public/`) + API (`src/worker.js`) | Workers + Static Assets | `ASSETS` |
| Cars, schedule, services, mileage, reminders | D1 (SQLite) | `DB` |
| Receipts and manuals | R2 | `FILES` |
| Login | Cloudflare Access, Google as the only sign-in | `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` |
| Daily recall check + reminder emails | Cron Trigger + Resend API | secret `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL` |
| Receipt reading | Claude API (`claude-opus-5-5`, structured output) | secret `ANTHROPIC_API_KEY` |

To ship a change: commit and push to `main`. Workers Builds applies any new migrations and deploys.

## Code map

- `src/worker.js`: routing, cars, services, files, reminders, specs, auth.
- `src/notify.js`: daily job, NHTSA recall check, digest email.
- `src/scan.js`: receipt reader.
- `public/lib/maint.js`: due-date and mileage math, shared by the page and the daily job.

## Where the data came from

- **Schedules** (`migrations/0002`):
  - RAV4: Toyota Warranty & Maintenance Guide T-MMS-24RAV4HV.
  - Terrain: owner's manual pp. 380–382, Normal schedule, diesel rows.
- **Parts and warranties** (`migrations/0004`):
  - RAV4: owner's manual ch. 8-1 and the warranty guide.
  - Terrain: owner's manual pp. 387–393, which list the GM and ACDelco part numbers.
  - Terrain warranty lengths are GM's standard 2019 terms. They aren't in the files, so verify them.
- **Renewals:** from the Illinois plate notice and the Farmers renewal in `Documents\Car`.

## How the pieces behave

- **Mileage estimate:** miles/day from the readings in the last year (odometer entries plus services with mileage).
  It needs two readings at least 14 days apart. The estimate drives "due" status and the expected-date hints.
- **Emails:** once a day, at most one email per car, sent to that car's addresses (Car tab), only for things not
  already sent (the `notices` table):
  - Maintenance that just became due soon or overdue. Overdue items are repeated every 30 days.
  - New recalls.
  - Renewals within 30 days.
  - Warranties ending within 60 days or 2,000 miles.
  - A monthly reminder when no mileage has been logged in 30 days.
- **Recalls:** NHTSA lists recalls by year, make and model (`recall_models`, e.g. "RAV4 Hybrid,RAV4"),
  not by VIN. Mark each one Fixed or "Doesn't apply to mine" after checking the VIN at nhtsa.gov/recalls.
- **Receipt scan:** the browser shrinks photos to about 2000 px, and the Worker sends them to Claude.
  The reply is checked before it fills the form: unknown items are dropped and numbers are cleaned up.
  The receipt is attached to the service automatically. Nothing is saved until you press Save.

## Trouble-code lookup

The Codes tab searches `public/codes.json` (2,109 generic SAE codes) in the browser. Rebuild it with
`node scripts/build-codes.mjs`.

- **Source:** [fabiovila/OBDIICodes](https://github.com/fabiovila/OBDIICodes) (MIT; the license is kept in
  `data/dtc/` and served at `/codes-LICENSE.txt`), plus `data/dtc/supplement.json` for standard hybrid
  and network codes it lacks.
- **Maker-specific codes (P1xxx etc.) are left out on purpose.** The free lists are Ford-only or old GM tables.
  For those codes the app decodes the system and links a web search for that car.

## Run locally

Wrangler runs through `npx`. Local data lives in `%LOCALAPPDATA%\car-tracker-dev`, outside OneDrive.

```bash
npm install          # the Anthropic SDK used by the receipt reader
npx -y wrangler@4 d1 migrations apply car-tracker --local --persist-to "$LOCALAPPDATA/car-tracker-dev"
npx -y wrangler@4 dev --ip 0.0.0.0 --port 8787 --persist-to "$LOCALAPPDATA/car-tracker-dev"
```

Then open http://127.0.0.1:8787.

- With no Access settings, the API only answers on localhost and LAN addresses.
- Without a `RESEND_API_KEY`, emails are off locally (Preview still works).
- To try receipt scanning or email locally, put `ANTHROPIC_API_KEY=...` / `RESEND_API_KEY=...` in
  `.dev.vars` (git-ignored).
- `POST /api/notify/run` runs the daily job on demand.

## Deploy to Cloudflare (one time)

1. Log in and create storage:
   - `npx -y wrangler@4 login`
   - `npx -y wrangler@4 r2 bucket create car-tracker-files` (R2 needs a card on file; this usage stays free)
   - `npx -y wrangler@4 d1 create car-tracker`, then paste the `database_id` into `wrangler.jsonc`
   - `npx -y wrangler@4 d1 migrations apply car-tracker --remote`
2. **Login (Cloudflare Access).** The dashboard layout changed in 2026; this is where things are now.
   - **Access controls → Applications → Self-hosted:** domain `cars.justdob.com` and an Allow policy for
     Justin's and Kelsey's Google emails.
   - **Zero Trust → Integrations → Identity providers:** add Google.
   - **App → Application details → Authentication:** pick Google only and turn on instant authentication.
   - Copy the **AUD tag** into `ACCESS_AUD` and the team domain into `ACCESS_TEAM_DOMAIN`.
3. **Custom domain:** `"routes": [{ "pattern": "cars.justdob.com", "custom_domain": true }]` in `wrangler.jsonc`.
4. **Email (Resend).**
   - Add the domain `cars.justdob.com` in Resend. Its DNS records go on `send.cars.justdob.com` and
     `resend._domainkey.cars.justdob.com`, so justdob.com's Microsoft 365 MX is untouched.
   - Create a **sending-only** API key and run `npx -y wrangler@4 secret put RESEND_API_KEY`.
   - Don't use Cloudflare Email Routing here: its onboarding is zone-wide and replaces the root MX records.
     Cloudflare Email Sending needs Workers Paid.
5. **Receipt reading:** create a key at console.anthropic.com, then run
   `npx -y wrangler@4 secret put ANTHROPIC_API_KEY`.
6. **Auto-deploy:** Workers & Pages → car-tracker → Settings → Builds → connect `jdobner3/car-tracker`.
   - Build command: leave empty.
   - Deploy command: `npx wrangler d1 migrations apply car-tracker --remote && npx wrangler deploy`
7. In the app:
   - Upload the manuals (Manuals tab).
   - Add each car's notification emails (Car tab), then press **Send test**.
   - Press **Check now** under Recalls.

`workers_dev` is off on purpose: the workers.dev URL would skip Access. Even so, the Worker refuses API
calls without a valid Access token. Before Access is set up, it answers only localhost and LAN.

## Backups

D1 Time Travel restores the database to any minute in the last 30 days. Car → "Export all data" downloads
everything as JSON. Receipts live in R2.
