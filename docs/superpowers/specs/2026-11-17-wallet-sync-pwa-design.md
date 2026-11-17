# Wallet Sync as an always-on PWA — design

Date: 2026-11-17. Status: draft for approval.

## Intent

Today the app is a desktop tool for importing broker statements into Wallet (BudgetBakers). The user wants a
phone-first personal finance app instead. The import becomes a background chore. The main value moves to:
"what needs me today", how the investments perform, investment plans, spending categorized with little effort,
and a chat that answers money questions with charts.

Trigger: on 2026-11-17 the user did a long manual chat to compare Fidelis RON against Fidelis EUR against
depreciation. They want that kind of answer inside the app, grounded in their own data, with charts.

## Goals

- Run continuously on the Mac Pro, inside the existing body-ledger Docker Compose stack.
- Reach it from the phone as a PWA over Tailscale only.
- Home screen "Today": two headline numbers, a short task list, plan status, upcoming maturities, data age.
- Invest tab: Positions, Performance, Plans.
- Investment plans as a general feature (not hard-coded to XTB).
- Spending: review new transactions; AI proposes Wallet record rules; the user approves; Wallet enforces them.
- Ask tab: chat through the shared opencode container; answers render as json-render specs (shadcn + Recharts).
- An MCP server in this app that exposes the mirrored Wallet data (and app-only data) to opencode.
- Spend analysis and insights across the app; Wallet budgets with AI-proposed limits.

## Non-goals

- No new categorization engine. Wallet's own record rules do the enforcement.
- No use of the BudgetBakers Wallet MCP. This app's mirror replaces it.
- No pinning of chat charts to other screens (can come later).
- No CSV import for Tradeville (HTML export works; decided 2026-11-17).
- No XTB income/fee import (≈0.4 EUR/year; decided 2026-11-17).
- No public internet exposure. Tailnet only.

## Anti-goals (failure even if it "works")

- Duplicate transactions in Wallet. Every write stays idempotent, as the import engine is today.
- The AI writes to Wallet without the user's approval.
- Secrets in the repo, in images, or in logs.
- Numbers shown without their age when the source is stale.

## Constraints and facts

- Stack: Next.js 16.2 (read `node_modules/next/dist/docs/` before code; this Next has breaking changes),
  React 19.2, Tailwind 4, shadcn (`components.json`, `components/ui/`), Recharts 3, zod 4, better-sqlite3 +
  drizzle, `xirr`.
- Uncommitted dashboard work exists and is the starting point for Today/Invest: `app/dashboard/*`,
  `src/dashboards/{mirror,prices,envelopes}.ts`, `src/dashboards/compute/{holdings,valuation,performance,networth,spending}.ts`,
  migration `0005_dashboard_prices.sql` (`price_history`, `fx_history`), `instrumentation.ts` (background mirror loop,
  default 5 min, min 60 s).
- The mirror (`couch_doc_cache`) caches Account, AssetTransaction, Category, Currency, Record, StocksFundsAsset.
  It does not cache record rules, labels, budgets, goals.
- Credentials live in the macOS Keychain via `keytar` (`src/storage/credentials.ts`). Keytar does not work in a
  Linux container.
- Data dir: `~/.wallet-broker-sync/audit.sqlite`.
- Wallet record rule shape (from the Wallet MCP): `{ name, keywords: string[], category }`. The user has two:
  "Pilon 3" (FPF Pensia Mea → Investments) and "Tithe" (Betel church → Charity, gifts).
- body-ledger (`~/Personal/body-ledger`) patterns to reuse:
  - `compose.body-ledger.yml`: services on networks `default` + `ai`; ports bound to `127.0.0.1` only.
  - `opencode` service: `opencode serve` on `:4096`, network `ai` only, read-only root, `/work` + `/tmp` tmpfs,
    `OPENCODE_SERVER_PASSWORD`, MCP servers listed in `opencode/opencode.json` with a bearer header.
  - Access check: `tailscale serve` sets `Tailscale-User-Login`; the app admits only `*_ALLOWED_USERS`, and checks
    `*_ALLOWED_HOSTS`.
  - PWA + web push with VAPID (`VAPID_SUBJECT`).
  - The opencode image is x64 only (Mac Pro).

## Decided by the user

- Home screen = "Today" layout (mock C). Investment plans are a general feature, with their own place.
- Bottom bar: **Today · Invest · Spending · Ask**. Invest has a switch **Positions | Performance | Plans**.
- Plans on Today: compact rows (ring, one status line, tag). Full cards, "+ New plan", Resume/Archive on
  Invest › Plans. No "add plan" on Today.
- Upload is not a tab. A Today task appears when Wallet shows a new transfer to a broker account and no newer
  broker activity is imported.
- Spending: review list (S1) plus rules (S3). AI proposes rules; approved rules are written as Wallet record rules.
- Join the body-ledger stack on the Mac Pro and share its opencode container.
- This app exposes its own MCP; opencode uses only that one (plus opencode's own web tools).
- Ask answers use json-render with `@json-render/shadcn` and the app's Recharts components.
- Phase order: Foundation → Today + Invest → Plans → MCP + Ask → Spending → Insights + budgets.
- Models: **OpenCode Go only**. No free models (their providers may keep prompts). Money data may go to Go-plan
  models.
- Insights: an **AI-written weekly analysis**; everything time-sensitive comes from fixed rules and shows as soon
  as the data changes.
- Budgets: use Wallet's own budgets (the user has 5, all from 2018: Groceries 500, Ordered food 500, Car 600,
  Transport 100, Expenses 2,500 RON/month).

Mockups: `.superpowers/brainstorm/75982-1794931843/content/` (`today-v3.html`, `variants-v4.html` P2 + S1/S3).

## Design by phase

### Phase 1 — Foundation

- **Container.** Dockerfile for the Next app (standalone output if this Next supports it; check the docs).
  better-sqlite3 needs a native build for linux/amd64.
- **Compose.** A `wallet-sync` service in body-ledger's `compose.body-ledger.yml` (or an extra compose file
  in the same `COMPOSE_FILE` list). Networks `default` + `ai`. Port `127.0.0.1:<port>` only. Volume for the
  data dir.
- **Secrets.** Replace keytar with env-based secrets: `WALLET_COUCH_URL`, `WALLET_COUCH_DB`,
  `WALLET_COUCH_LOGIN`, `WALLET_COUCH_TOKEN`. Keep keytar out of the container image. The setup wizard's
  "connect" step becomes read-only status when env secrets exist.
- **Migration of state.** One-time copy of `~/.wallet-broker-sync/audit.sqlite` into the volume.
- **Mirror.** Keep `instrumentation.ts` loop. Interval 60 s in production. Extend the mirror to also cache
  RecordRule and Label docs (needed in Phase 5; cheap to add now).
- **Access.** Middleware/proxy check of `Tailscale-User-Login` against `WALLET_ALLOWED_USERS` and Host against
  `WALLET_ALLOWED_HOSTS`, same semantics as body-ledger. Requests without the header are refused, except from
  localhost.
- **PWA.** Manifest, icons, service worker, install on iOS. Web push with VAPID keys from env.
- **Data age.** Every source (each bank-synced account, each broker import, prices, FX) exposes "as of" time.

### Phase 2 — Today + Invest

- **Today:** net worth (base currency RON) with 30-day change; Invested (value + return) and Cash cards;
  "What needs you" (rule-based, no AI); compact plan rows; "Coming up" timeline; data age line with a ⚠ when
  stale.
- **"Upload statement" task rule:** a bank-synced transfer into a broker's Investment account (XTB, IBKR,
  Tradeville) is newer than the newest imported broker activity for that account. The task opens the upload
  flow preselected for that broker. Web push when the task appears.
- **Invest › Positions:** holdings across brokers + deposits + bonds, valued with `price_history`/`fx_history`.
  Upload also reachable from a ⋯ menu here.
- **Invest › Performance:** value vs money put in, return per broker (XIRR available), income received
  (dividends, coupons, deposit interest).
- **Maturities:** Wallet has no maturity or rate fields. The user enters them once per deposit/bond (app table,
  linked to the Wallet account or asset). They feed "Coming up" and Performance.
- **Upload flow:** reuse the existing parsers and sync engine unchanged.

### Phase 3 — Plans

- A plan: name, account, amount, currency, frequency, start date, optional target asset and "whole shares" flag,
  status (active/paused/archived).
- Plan types: **recurring contribution** (e.g. XTB 100 €/month → VUAA) and **rollover** (a deposit or bond
  maturity → a named product, e.g. BT deposit → Fidelis RON 2028).
- Progress: expected contributions to date vs deposits into the account (from Wallet transfers); whether the
  money became the target asset (from asset transactions); the next action ("Deposit 300 € → 2 VUAA" at the last
  known price).
- Today shows active plans only; "behind" plans count in the section header.

### Phase 4 — MCP + Ask

- **MCP server** inside the app (HTTP, bearer `WALLET_MCP_TOKEN`, reachable on the `ai` network as
  `wallet-sync:<port>/mcp`). Read tools over the mirror and app tables: accounts and balances, records
  (filter, aggregate, convert currency with `fx_history`), holdings and valuation, performance, plans, maturities,
  record rules, price and FX history. No write tools in this phase.
- **opencode:** add the MCP to body-ledger's `opencode/opencode.json`; network allow via `MCP_ALLOWED_HOSTS`-style
  host check.
- **Ask tab:** chat UI; the app calls opencode's session API (as body-ledger does) with tools = this MCP +
  opencode web search/fetch. Answers come back as text plus a json-render spec. The catalog = `@json-render/shadcn`
  components + the app's Recharts charts (line, bar, area, allocation) wrapped with zod schemas. Invalid specs
  fall back to text.
- Each answer lists the tools it called (own data vs web).
- Chats are stored in the app DB and listed.

### Phase 5 — Spending

- **Review list:** transactions since the last review, newest first; each shows its current Wallet category;
  ✓ accepts, the chip changes it; "Accept all".
- **Rule proposals:** a job (on demand and after new transactions) asks opencode for rule proposals, given
  uncategorized/recently-recategorized transactions, existing record rules, and categories. A proposal =
  `{ name, keywords, categoryId, matchedExamples, pastMatchCount }`. Proposals must not contradict existing rules.
- **Approve:** writes a Wallet RecordRule doc through the Couch connection (idempotent `_id`), then re-categorizes
  the matching past transactions once (Wallet rules may apply only to new bank-synced records — verify).
- **Insights:** unexplained outflows (e.g. 11,900 RON to Revolut cards in 6 weeks while Revolut sync is stale).

### Phase 6 — Insights + budgets

- **Budgets on Spending:** one bar per Wallet budget for the current period (spent vs effective limit, per the
  Wallet budget model: `spent = max(0, expenses − incomes)` in scope; limit overrides apply).
- **Budget proposals:** the AI proposes limits from the last 6–12 months; approve/edit/reject like rule
  proposals; approved changes are written to the Wallet budget doc.
- **Weekly analysis:** one AI-written note per week (Monday morning, push notification): spend by category vs
  the user's 6-month average, what changed, concrete ways to spend less. Every number in the note is checked
  against the computed figures before it is shown (body-ledger's "number check" pattern).
- **Rule-based insight cards** in context, recomputed on each mirror sync: Today (budget passed, upload needed,
  plan behind), Invest (idle broker cash, plan gaps), Spending (category spike vs average, unexplained outflows
  such as card top-ups to an account whose sync is stale).

## Calls made by the designer (overrule freely)

- **Fallback-record positions.** Tradeville XBSE trades (incl. R2602A/R2603B/R2604B, SNP, TLV) are Wallet
  Records, not AssetTransactions. The app reads quantity, symbol and price back from the note it writes itself
  (`Buy|Sell <qty> <symbol> @ <price> <ccy> (...)`, from `toRecordDocFromTrade`). Keep that note format stable.
- **Bond valuation:** par + accrued coupon. The user enters the coupon rate once with the maturity date.
- **Writes to existing Wallet docs (Phase 5):** a category change in the review list updates the Wallet Record
  (keep `_rev`; on conflict, re-read and retry once, else show an error). Rule approval shows every past match,
  all ticked; one tap approves exactly the shown list.
- **RecordRule location:** verify in Phase 1 that record rules are Couch docs. If not, the approved rule is shown
  for the user to add in Wallet by hand, and only the past-match update is automatic.
- **Privacy in opencode:**
  - The MCP masks IBANs and bank account numbers (last 4 only).
  - Web search/fetch runs in a separate first step that sees only the user's question, never wallet data; the
    second step gets the web output plus the MCP and has no web tools (body-ledger's two-step research pattern).
  - The wallet MCP is not enabled globally in the shared `opencode.json`; only this app's sessions enable it, so
    body-ledger jobs cannot read money data.
- **Ask transport:** stream the answer (opencode session events → SSE to the phone). The job keeps running if
  the phone disconnects; a push notification says when it is ready. One opencode session per chat for follow-ups.
- **Base currency RON** (code default is EUR).

## Left to the builder

- Port numbers, service and volume names, file layout inside `app/` and `src/`.
- Exact Today task rules beyond the two named ones; thresholds for "stale".
- Chart styling (follow the mockups' dark theme); icons.
- Whether the MCP uses the official TypeScript MCP SDK or a minimal handler.
- Proposal job trigger timing; how many examples a proposal shows.
- Test strategy per phase (unit tests for compute and rule matching; parser tests stay).
