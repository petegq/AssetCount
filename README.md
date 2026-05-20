# Asset Count Bot

A Slack bot for warehouse asset counting, tracking, and reporting. Staff count physical assets on the floor via Slack commands; derived figures (e.g. totals, computed KPIs) are calculated automatically from configurable formulas.

---

## Commands

| Command | Description |
|---|---|
| `/count <asset> <qty> [unit]` | Record a count. Bare `/count` opens a guided modal. |
| `/count-session start <zone>` | Lock a zone and start a counting session. |
| `/count-session end` | Close your active session with a summary. |
| `/inventory <asset>` | Current value — count for physical assets, computed value for derived. |
| `/inventory-report [category]` | Full report as a Slack message + CSV attachment. |
| `/formula <asset>` | View a derived asset's formula and current input values. |
| `/formula set <asset>` | Open a modal to set or update the formula. |
| `/audit <asset>` | Recent change history for an asset. |
| `/sheet-output` | Values in spreadsheet order — paste directly into a column. |

---

## How formulas work

Derived assets are never counted directly. Their value is always **computed on read** from a formula over other assets (countable or derived).

### Setting up a derived asset

1. Register the asset with type `DERIVED`.
2. Use `/formula set <asset>` to open the editor modal.
3. Declare inputs — one per line, format `variableName = Asset Name`:
   ```
   buffer = DT Emergency Buffer
   dupes  = Duplicate DTs
   ```
4. Write the formula using those variable names:
   ```
   buffer + dupes
   ```
5. Save — the bot validates syntax, checks for undeclared variables, and detects circular dependencies before saving.

### Supported syntax

| Element | Examples |
|---|---|
| Arithmetic | `a + b`, `a - b`, `a * b`, `a / b` |
| Parentheses | `(a + b) * c` |
| Numeric literals | `a * 2 + 100` |
| `min` / `max` | `max(buffer, 0) + dupes` |
| `round` / `floor` / `ceil` | `round(a / b)` |
| `abs` | `abs(a - target)` |

### Nested derived assets

Derived assets can depend on other derived assets. The bot resolves dependencies recursively with memoization, so each asset is evaluated only once per request. Never-counted inputs are treated as `0` so the formula still produces a result.

### Division by zero

Division by zero at evaluation time shows `—` in `/inventory` output and `0` in `/sheet-output` (with a warning footnote). It never crashes the bot.

### Circular dependency protection

The `/formula set` modal checks for cycles before saving. If adding your inputs would create a cycle (e.g. A → B → A), the modal returns an error showing the full path.

---

## Setup

### 1. Create the Slack app

Use the provided [`slack-app-manifest.yaml`](slack-app-manifest.yaml) to create the app in one step:

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest**
2. Paste the contents of `slack-app-manifest.yaml`
3. Install the app to your workspace

If you prefer to configure manually, add the following:

**OAuth scopes (Bot Token):**

| Scope | Why |
|---|---|
| `chat:write` | Post messages to channels |
| `chat:write.public` | Post to channels the bot hasn't joined (audit + daily summary channels) |
| `files:write` | Upload CSV inventory reports |
| `commands` | Register slash commands |

**Slash commands to register** (Request URL only needed when `SOCKET_MODE=false`):

`/count`, `/count-session`, `/inventory`, `/inventory-report`, `/formula`, `/audit`, `/sheet-output`

**App-level token** (Socket Mode only):
- Under **Basic Information → App-Level Tokens**, create a token with scope `connections:write`
- This is your `SLACK_APP_TOKEN` (`xapp-…`)

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your tokens (see [Configuration reference](#configuration-reference) below).

### 3. Set up the database

```bash
npm run db:migrate
```

This creates `dev.db` and runs all migrations.

### 4. Local development (Socket Mode)

Socket Mode lets you run the bot locally without a public URL.

```bash
npm install
npm run dev
```

> **How `.env` is loaded:** the `dev` and `start` scripts use Node.js 20's built-in `--env-file=.env` flag. No `dotenv` package is needed. If you run the compiled output directly with `node dist/index.js` (without the flag) the app will exit with a missing-variables error — always use `npm run start` or `npm run dev`.

The bot connects to Slack via a persistent WebSocket. You should see:

```
INFO  Asset Count Bot started  {"socketMode":true}
```

Test it by typing `/count` in any channel where the bot is present.

### 5. Browse the database (optional)

```bash
npm run db:studio
```

Opens Prisma Studio at `http://localhost:5555`.

---

## Deployment

### Docker (recommended)

```bash
# Build and run with docker-compose
cp .env.example .env   # fill in your tokens
docker compose up -d
```

For production, set `SOCKET_MODE=true` (no public URL needed) or `SOCKET_MODE=false` with a reverse proxy pointing to port 3000.

The SQLite database is persisted in a named Docker volume (`sqlite_data`).

### Fly.io

```bash
fly launch           # creates fly.toml
fly secrets set SLACK_BOT_TOKEN=xoxb-... \
                SLACK_SIGNING_SECRET=... \
                SLACK_APP_TOKEN=xapp-...
fly volumes create sqlite_data --size 1
fly deploy
```

Add to `fly.toml`:
```toml
[mounts]
  source = "sqlite_data"
  destination = "/app/data"

[env]
  DATABASE_URL = "file:/app/data/prod.db"
  SOCKET_MODE  = "true"
```

### Railway

1. Connect your GitHub repo in the Railway dashboard.
2. Set all env vars from `.env.example` in the **Variables** tab.
3. Railway auto-detects the `Dockerfile` and builds on push.
4. For persistent SQLite, attach a **Volume** at `/app/data` and set `DATABASE_URL=file:/app/data/prod.db`.

> **Note:** For high-traffic or multi-instance deployments, swap `DATABASE_URL` to a PostgreSQL connection string — no code changes required, just run `npx prisma migrate deploy` after switching.

---

## Configuration reference

| Variable | Default | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | *(required)* | Bot OAuth token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | *(required)* | App signing secret |
| `SLACK_APP_TOKEN` | *(required in Socket Mode)* | App-level token (`xapp-…`) |
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `PORT` | `3000` | HTTP port (unused in Socket Mode) |
| `SOCKET_MODE` | `true` | `true` = WebSocket; `false` = HTTP |
| `DATABASE_URL` | `file:./dev.db` | SQLite path or PostgreSQL URL |
| `DISCREPANCY_THRESHOLD` | `0.05` | Variance fraction that triggers an alert (5%) |
| `AUDIT_CHANNEL` | `#warehouse-audit` | Channel for discrepancy alerts |
| `DAILY_SUMMARY_CHANNEL` | `#warehouse-daily` | Channel for the daily summary |
| `DAILY_SUMMARY_CRON` | `0 6 * * *` | Cron expression for daily summary (UTC) |
| `SPREADSHEET_OUTPUT_ORDER` | *(empty)* | Comma-separated asset names for `/sheet-output` |
| `SPREADSHEET_OUTPUT_UNIT` | `uoo` | Unit for `/sheet-output`: `uom` or `uoo` |
| `LOG_LEVEL` | `info` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` |

---

## Development

### Scripts

```bash
npm run dev            # live-reload with tsx
npm run build          # compile to dist/
npm run start          # run compiled output
npm run test           # watch mode
npm run test:run       # single run
npm run test:coverage  # coverage report
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run db:migrate     # create + apply a new migration
npm run db:studio      # open Prisma Studio
npm run db:reset       # reset database (dev only)
```

### Project structure

```
src/
  lib/           config, logger, Prisma client, error types, shared types
  services/      pure business logic — UnitConversion, FormulaEvaluation,
                 AssetEvaluation (recursive), Discrepancy
  repositories/  Prisma-backed data access — Asset, Count, Session, Audit
  handlers/      Slack command + modal handlers; blocks.ts for Block Kit helpers
  messages.ts    every user-facing string (localisation-ready)
  index.ts       app entry point + cron scheduler

tests/
  unit/          service-layer unit tests (no DB, no Slack)
  integration/   (Milestone 7 — mock Slack client tests)

prisma/
  schema.prisma  data model
  migrations/    versioned SQL migrations
```

### Adding a new asset category

Categories are created on the fly via `assetRepository.findOrCreateCategory(name)`. There is no fixed list — just use a consistent name when registering assets.

### Running tests

```bash
npm run test:coverage
```

Coverage is measured on `src/services/` and `src/repositories/`. The target is ≥ 80% on all metrics.
