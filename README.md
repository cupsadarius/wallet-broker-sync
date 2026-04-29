# Wallet Broker Sync

Local-only tool that imports investment exports from XTB, Interactive Brokers, and Tradeville into [BudgetBakers Wallet](https://web.budgetbakers.com), idempotently and with a diff preview before anything is written.

Wallet's public REST API and MCP server are read-only and don't surface investment trades. This tool uses the same path Wallet's own web client uses — direct CouchDB replication — so trades, dividends, fees, and corporate actions show up natively in Wallet's Portfolio and Records views.

## What it does

| Broker | Format | Coverage |
| --- | --- | --- |
| **Interactive Brokers** | `.csv` Activity Statement (Transaction History or yearly format) | Buy/Sell, splits (as price-0 buys), dividends, withholdings, fees, sales tax |
| **XTB** | `.xlsx` cash operations export | Buy/Sell |
| **Tradeville** | `.html` or text-based `.pdf` (PDFs with embedded text only) | Buy/Sell on XBSE, dividends, coupons, free shares (corporate actions) |

Multi-file uploads are deduplicated automatically — drop overlapping yearly statements and a trade in two of them collapses to one entry.

## How it works

```
broker export ──▶ parser ──▶ canonical txn ──▶ engine ──▶ CouchDB (Wallet)
                                                  ▲
                                                  └── local SQLite cache
                                                      (_changes mirror)
```

1. **Parse**: per-broker parser turns the export into a `CanonicalTxn[]` plus an `unsupported[]` list (deposits, transfers, anything we don't model).
2. **Cache**: pull deltas from CouchDB via `_changes?since=<lastSeq>` into a local SQLite mirror. After the first run, subsequent dry-runs only fetch what changed.
3. **Diff**: build wire docs (`AssetTransaction` for trades on catalogued assets, `Record` for cash income/expense), then dedup against the mirror by deterministic `_id` (UUIDv5 of content) and a content key for manually-entered trades that drift in `_id`.
4. **Preview**: show what will insert, what's already in Wallet, what needs an asset created, what's unsupported. Per-row dropdowns let you link broker trades to existing manual entries (multi-select for partial-fill grouping).
5. **Commit**: `_bulk_docs` to CouchDB. Persist outcomes + audit log to SQLite.

Re-importing the same export inserts nothing — the `_id` is content-addressed.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and the setup wizard guides you through:

1. **Connect** to your Wallet CouchDB (URL, login, token, database name — auto-filled from your user UUID).
2. **Map** each broker to a Wallet investment account.
3. **Upload** broker exports.

Credentials are stored in your OS keychain via `keytar`. Everything else (mappings, aliases, audit log, doc cache) lives in `~/.wallet-broker-sync/audit.sqlite`.

## Finding your CouchDB credentials

In Wallet's web client at [web.budgetbakers.com](https://web.budgetbakers.com), open DevTools → Network and watch any request. The CouchDB endpoint is `https://couch-prod-eu-1.budgetbakers.com/bb-<your-user-uuid>` and the `Authorization` header has Basic auth with your user UUID as login and your replication token as password.

## Features

### Idempotent imports
Every transaction's `_id` is a deterministic UUIDv5 of its content. Re-importing the same file does nothing.

### Manual linking & partial-fill grouping
When the broker reports a trade that doesn't strict-match any existing entry (price drift, missing fields, ID drift), the preview shows a checkbox picker of existing trades on the same asset/side/day. Tick one or several — handy when IBKR splits an order into two fills but you entered it as one trade in Wallet. Selections persist as `manual_link` rows so re-imports keep treating the broker trade as already-present.

### Asset aliases
Cross-listed tickers (CNDX/LSE → SXRV/XETR) where Wallet only catalogs one venue. Define an alias once; the sync substitutes on lookup.

### Record fallbacks
For exchanges Wallet doesn't catalog at all (e.g. XBSE/Bucharest), trades can be written as cash-flow Records (expense for buys, income for sells) instead of investment AssetTransactions. Mark `(broker, exchange, symbol)` once and it sticks.

### Dividends, coupons, fees
Dividends and bond coupons become `Record` documents tagged "Income"/"Investment". IBKR withholdings, other fees, and sales tax become "Others"/"Bank fees" expenses.

### Local CouchDB mirror
First run does a full `_changes` scan to seed `~/.wallet-broker-sync/audit.sqlite`. Subsequent runs only fetch deltas via `_changes?since=<lastSeq>`. Dry-runs that used to take a minute take milliseconds.

### Backup & restore
Settings → **Download backup** dumps mappings, aliases, record-fallback rules, manual links, and your CouchDB URL/DB to a versioned JSON file. The setup wizard on a new machine has a **Restore from file** panel that pre-fills the connection form and merges all rules. Credentials are never included.

### Audit log
Every sync writes a row to `sync_run` with file hash, broker, parsed count, inserted count, conflict count, error count. Each per-doc outcome (inserted/conflict/error/skipped) goes to `sync_run_doc`. Browse it at `/history`.

## Tech stack

- **Next.js 16** App Router, **TypeScript**, **Tailwind**, **shadcn/ui** — UI
- **drizzle-orm** + **better-sqlite3** — local audit log + cache + persisted rules
- **keytar** — OS keychain for CouchDB Basic auth
- **xlsx** — XTB parser
- **pdfjs-dist** — Tradeville PDF parser (text-extracted only)
- **zustand** — wizard state
- **vitest** — 100+ tests covering parsers, engine, dedup, manual links, multi-file, currency handling

## Development

```bash
npm run dev              # next dev
npm run test             # vitest run (100 tests)
npm run test:watch       # vitest watch
npm run lint             # eslint
npm run probe:couch      # interactive script to inspect a CouchDB database
npm run pdf:dump <path>  # dump positioned text items from a PDF (used to diagnose layout drift)
```

### Project layout

```
app/                     Next.js routes
  api/                     route handlers — sync, config, aliases, manual-link, rules-import/export, history
  upload/                  drag-drop + multi-file picker
  preview/                 review-changes table with link-picker popover
  result/                  totals + submitted trades + records + skipped
  settings/                connection, mappings, aliases, record fallbacks, manual links, backup/restore
  history/                 audit log with per-run drill-down
  components/              AppHeader, BackupRestore, JsonViewer

src/
  parsers/                 per-broker parsers + canonical types
    ibkr.ts, ibkr-yearly.ts
    xtb.ts
    tradeville.ts, tradeville-pdf.ts, tradeville-shared.ts
  sync/
    engine.ts                prepareSync (diff) + commitSync (write)
    couch.ts                 CouchClient (_bulk_docs, _changes)
    couch-cache.ts           SQLite-backed delta mirror
    lookup.ts                Account/Asset/Currency/Category lookup
    mapper.ts                CanonicalTxn → AssetTransactionDoc
    record-mapper.ts         CanonicalTxn → RecordDoc
  storage/
    schema.ts                drizzle schema
    migrations/              hand-written SQL migrations
    db.ts                    sqlite client + migration runner
    credentials.ts           keytar wrappers

tests/                   parser fixtures + engine + sync + couch + lookup
scripts/                 couch-probe.ts, pdf-dump.ts
```

## Storage

`~/.wallet-broker-sync/audit.sqlite` (drizzle-managed):

- `config` — couch URL, DB name
- `broker_account_map` — broker → Wallet investment account ID + currency
- `asset_alias` — cross-listing mappings
- `record_fallback` — `(broker, exchange, symbol)` triples that go through the Record path
- `manual_link` — `(broker, externalId, existingDocId)` user-confirmed links; one broker trade can have several rows for partial-fill grouping
- `couch_doc_cache` — local mirror of Wallet docs we care about (Account, Currency, StocksFundsAsset, Category, AssetTransaction, Record), keyed by `(scope, docId)` where scope is `${couchUrl}|${dbName}`
- `couch_cache_meta` — last `_changes` seq per scope
- `sync_run` + `sync_run_doc` — audit log

OS keychain (via `keytar`):
- `wallet-broker-sync` / `couchdb` — Basic auth login + token

Reset all of this by deleting `~/.wallet-broker-sync/`. Reset just the connection (and force a full cache re-seed) via Settings → Reset connection.

## Privacy & scope

This is a personal tool. It runs locally, talks to your CouchDB and your file system, and never sends data anywhere else. There's no telemetry, no hosted backend, no multi-tenancy. The audit log records filenames + sha256 hashes; the cache mirrors your CouchDB docs as-is.

## License

Personal use. Not affiliated with BudgetBakers, XTB, Interactive Brokers, or Tradeville.
