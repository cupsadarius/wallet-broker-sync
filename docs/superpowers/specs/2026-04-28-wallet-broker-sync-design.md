# Wallet Broker Sync — Design

**Date:** 2026-04-28
**Status:** Draft, pending phase-0 capture

## Problem

Wallet by BudgetBakers does not natively sync brokerage transactions; its automated import pipeline is bank-account only. The user maintains three brokerage accounts (XTB, Interactive Brokers, Tradeville) and three corresponding "Investment" accounts inside Wallet. Today, the only path to keep Wallet in sync with the brokers is manual data entry through the web UI — tedious and error-prone.

Wallet's public surfaces (REST API, MCP server, documented CSV import) are insufficient for the goal:

- **REST API** is read-only across all 10 endpoints.
- **MCP server** is also read-only.
- **Documented CSV import** uses a generic `date,note,income,expense` schema with no investment fields (no symbol, no quantity, no price). Records imported through it would not appear in Wallet's Portfolio view.

However, network capture of the Wallet web app reveals it speaks **CouchDB replication protocol** directly to `https://couch-prod-eu-1.budgetbakers.com/bb-<userId>`. Each user's data lives in a per-user CouchDB database, accessed via HTTP Basic auth (`userId:syncToken`). The data model is exposed as plain CouchDB documents with `reservedModelType` discriminators (e.g. `AssetTransaction`, `Account`, `StocksFundsAsset`). The same protocol is used by every official Wallet client (web, iOS, Android), making direct CouchDB writes effectively first-class — they propagate to every device exactly like changes made through the UI.

## Goals

- Local web tool. Drag-and-drop a broker CSV; see a diff preview ("12 new, 340 already synced"); confirm; transactions appear in Wallet.
- **Idempotent.** Re-importing the same CSV is a no-op. Importing a superset (e.g. last year + this year) inserts only the new rows.
- **Pluggable broker parsers.** Adding a new broker is one new file under `parsers/`; the sync engine, dedup logic, and UI are untouched.
- **Full investment fidelity.** Buys/sells appear as proper `AssetTransaction` records in Wallet — Portfolio tab populates correctly with quantity and price-per-share.
- **Local-first.** Runs on the user's machine. Credentials live in a local `.env`. No cloud hosting required for v1.

## Non-goals (v1)

- Deposits, withdrawals, dividends, interest, FX conversions, corporate actions (splits/merges). Buys, sells, and per-trade fees only. Other transaction types are deferred to v2.
- Two-way sync. Source of truth is the broker CSV; we never modify or delete existing Wallet records.
- Real-time / webhook sync. Manual user-initiated CSV upload only.
- Multi-user. The tool runs against a single CouchDB instance owned by the operator.
- Multi-currency price translation. v1 stores `priceCurrencyCode` and `cashAmountCurrencyCode` exactly as the broker reports them; FX is Wallet's job downstream.
- Hosted / multi-tenant. v1 is local-only.

## Architecture

```
┌──────────────┐    ┌──────────┐    ┌──────────────────┐    ┌──────────────┐    ┌──────────┐
│  Broker CSV  │───►│  Parser  │───►│ CanonicalTxn[]   │───►│ Sync Engine  │───►│ CouchDB  │
└──────────────┘    └──────────┘    └──────────────────┘    └──────┬───────┘    │ (Wallet) │
                                                                    │            └──────────┘
                                                                    │                  ▲
                                                                    │                  │
                                                                    └──────────────────┘
                                                                  existing AssetTransaction
                                                                  docs (read-side, for diff
                                                                  preview & asset lookup)
```

Three hard layers, each independently testable:

### 1. Parser layer

One module per broker. Pure function: bytes in, canonical txns out. Knows nothing about Wallet, CouchDB, or any side effects.

```ts
interface BrokerParser {
  id: 'xtb' | 'ibkr' | 'tradeville'
  detect(csvText: string): boolean
  parse(csvText: string): CanonicalTxn[]
}
```

Parsers register themselves into a `parsers` map at module load. The UI uses `detect()` to suggest the right parser when a CSV is uploaded; the user can override.

### 2. Canonical model

The single shape every layer downstream of the parser speaks:

```ts
type CanonicalTxn = {
  externalId: string         // broker's transaction id, or hash(date|symbol|qty|price|side) if absent
  broker: 'xtb' | 'ibkr' | 'tradeville'
  kind: 'buy' | 'sell' | 'fee'
  date: string               // ISO 8601 timestamp
  symbol?: string            // ticker; required for buy/sell
  quantity?: number          // required for buy/sell
  pricePerShare?: number     // required for buy/sell
  amount: number             // signed cash impact in account currency (negative = outflow)
  currency: string           // ISO 4217
  description: string        // human-readable summary
  raw: Record<string, unknown>  // original CSV row, for debugging
}
```

`fee` rows are emitted by the parser when the broker reports them as separate line items. When fees are bundled into the trade row (e.g. as a "commission" column), the parser folds them into `amount` and emits no separate fee txn.

### 3. Sync engine

Broker-agnostic. Workflow:

1. **Map** each `CanonicalTxn` to a Wallet doc (`AssetTransaction` for buys/sells; document type for fees TBD in phase 0).
2. **Diff preview**: read existing `AssetTransaction` docs for the target account, group by `_id`, show user `{new, existing, changed}`. v1 never updates — `changed` is reported but never written.
3. **Confirm** via UI button.
4. **Write** via `_bulk_docs` with `new_edits: true` (default). CouchDB returns per-doc success/conflict; conflicts mean the doc was already present (re-import).
5. **Audit log**: persist the sync run summary to local SQLite for debugging.

## Data model

### Wallet `AssetTransaction` (captured from network)

```
{
  _id:                "-AssetTransaction_<uuid>"
  _rev:               (assigned by server when new_edits: true)
  reservedModelType:  "AssetTransaction"
  reservedOwnerId:    <userId>
  reservedAuthorId:   <userId>
  reservedSource:     "web"
  reservedCreatedAt:  ISO timestamp
  reservedUpdatedAt:  ISO timestamp
  assetId:            "-StocksFundsAsset_<uuid>"
  accountId:          "-Account_<uuid>"
  assetType:          number   // 1 = stock/ETF (verify in phase 0)
  transactionType:    number   // 0 = buy, 1 = sell (verify in phase 0)
  date:               ISO timestamp
  quantity:           number
  price:              number   // per-unit, encoding TBD (verify in phase 0)
  cashAmount:         number   // total cash impact incl. fee
  cashAmountCurrencyCode: ISO 4217
  priceCurrencyCode:  ISO 4217

  // Custom fields we add (CouchDB schemaless; round-trip safely):
  externalSource:     "xtb" | "ibkr" | "tradeville"
  externalId:         string   // broker's id (or hash) used to derive _id
  syncedAt:           ISO timestamp
  syncToolVersion:    string   // for forensics
}
```

CouchDB ignores fields the official clients don't know about. They round-trip across replication and stay attached to the doc.

### Deterministic `_id` for dedup

```
_id = "-AssetTransaction_" + uuidv5(NAMESPACE_WALLET_SYNC, broker + ":" + externalId)
```

Where `NAMESPACE_WALLET_SYNC` is a hard-coded UUID v5 namespace constant for this tool. Properties:

- Same input → same `_id`. Re-importing yields a CouchDB conflict, not a duplicate.
- Different brokers can't collide (broker is part of the input).
- We never need to query before writing to know whether something exists; CouchDB's response tells us.

For brokers that don't supply a stable transaction id, the parser computes a content hash from `(date, symbol, quantity, price, side)` and uses that as `externalId`. Two identical orders on the same timestamp would collide — accepted limitation; document in the parser.

### Asset lookup

Each `AssetTransaction` requires an `assetId` pointing to an existing `StocksFundsAsset` doc.

**Strategy:**

1. On startup, fetch all `StocksFundsAsset` docs (low volume — the user's portfolio set).
2. Build a `Map<symbol, assetId>` keyed by ticker.
3. For each canonical txn, look up `symbol`. If found, use the `assetId`. If not found, we'd need to create a new `StocksFundsAsset` doc — **deferred to phase 0**, because we don't yet know that doc's required schema. v1 short-term path: surface "unknown asset" rows in the preview UI; user creates them once via Wallet's web UI; subsequent imports work.

### Account selection

One-time, in setup:

1. Fetch all `Account` docs where `accountType` is investment-related.
2. Show the user a mapping UI: `XTB → ?`, `IBKR → ?`, `Tradeville → ?`.
3. Persist the mapping to local SQLite (`broker_account_map`).

Re-runs use the persisted mapping; the user can edit it in a settings page.

## Sync algorithm

```
function sync(broker: BrokerId, csv: string, accountId: string) {
  1. const txns = parsers[broker].parse(csv)
  2. Resolve assets: for each unique symbol, lookup or surface as "needs creation"
  3. Map to AssetTransaction docs (with deterministic _id, custom fields, assigned assetId)
  4. Read existing docs for this account from CouchDB (Mango query on accountId)
  5. Diff:
       - existing = set of _id already present
       - new      = docs whose _id not in existing
       - changed  = docs whose _id is present but content differs (informational only — never written)
  6. Render diff preview UI; await user confirmation
  7. POST /_bulk_docs with new docs (new_edits: true)
  8. Parse per-doc response:
       - 201/200  → inserted
       - 409      → already present (treat as no-op, not an error)
       - other    → log; surface in run summary
  9. Persist run summary to local SQLite
}
```

### Conflict handling

- `409 conflict` from `_bulk_docs` is the **expected** signal that a row was already present from a prior run. Not an error.
- `401 unauthorized` → token rotated; surface a "re-paste credentials" UI.
- `403 forbidden` / `404 not found` → likely a wrong CouchDB URL or revoked token. Same UI flow as 401.
- `429 rate limit` → exponential backoff, then resume.
- Network errors → retry with backoff (max 3 attempts), then fail the run cleanly with a "no partial state, safe to retry" message. Because each `_bulk_docs` call is atomic per-doc and we use deterministic `_id`s, full retries are always safe.

### Asset creation (deferred)

For v1, if a parser emits a txn for a symbol that doesn't have a `StocksFundsAsset` doc in Wallet:

- The diff preview lists those rows under **"Needs asset created in Wallet"**.
- User creates the asset manually in the Wallet web UI (one click in the existing flow).
- User re-runs sync; the asset is now resolvable and the rows go through.

This avoids reverse-engineering the asset-creation document schema in v1. v2 can add programmatic asset creation once we capture that flow.

## Phase 0: empirical capture

Before writing sync code, the user performs ~6 small captures from the Wallet web UI with DevTools open. Each capture is a curl/HAR for one operation; the spec is updated with confirmed enum values, scaling, and doc shapes.

| # | Operation | Resolves |
|---|---|---|
| 1 | Buy 0.001 of an existing low-cost asset | `transactionType` for buy; `price` scaling at small-decimal scale |
| 2 | Sell 0.001 of same asset | `transactionType` for sell |
| 3 | Edit a buy to add a fee column | Fee shape: separate doc vs embedded field |
| 4 | A buy that triggers a "Charges, Fees" line | Confirms fee = separate doc; capture its model type and fields |
| 5 | View any existing trade and copy its `assetId` and `Asset` doc | `StocksFundsAsset` schema for v2 |
| 6 | Login flow | How the Basic-auth token is acquired and refreshed |

The implementation plan does not begin until Phase 0 captures are checked in (redacted) under `docs/superpowers/captures/` and the spec section "Data model — Wallet AssetTransaction" has its TBDs filled in.

## Parser layer details

### File layout

```
parsers/
  index.ts          # registry, detect()
  xtb.ts            # XTB parser
  ibkr.ts           # Interactive Brokers parser (post-v1)
  tradeville.ts     # Tradeville parser (post-v1)
  test/
    xtb.test.ts
    fixtures/
      xtb-2026.csv
      xtb-edge-cases.csv
```

### Per-parser responsibilities

- Strip BOMs, normalize line endings, accept both `,` and `;` delimiters where the broker varies.
- Reject malformed input with structured errors (`row N, column X: <reason>`) — surfaced in the UI.
- Emit `kind: 'fee'` only when the broker reports fees as standalone rows. Trade-embedded fees get folded into `amount`.
- Never silently drop rows. Unknown row types must produce a structured `unsupportedRows` array returned alongside the parsed txns; the UI surfaces them so the user knows nothing was hidden.

### Parser interface

```ts
type ParseResult = {
  txns: CanonicalTxn[]
  unsupported: Array<{ row: number, reason: string, raw: Record<string, unknown> }>
}

interface BrokerParser {
  id: BrokerId
  displayName: string
  detect(csvText: string): boolean
  parse(csvText: string): ParseResult
}
```

## UI flow

Single-page Next.js app, runs locally on `localhost:3000`. Five screens:

1. **Setup** (first run only): paste CouchDB URL + Basic auth token; test connection; map XTB/IBKR/Tradeville to Wallet investment accounts.
2. **Upload**: drop CSV → broker auto-detected from headers → user confirms broker + target account.
3. **Preview**: table of parsed rows with per-row status badge:
   - ✅ Will insert
   - ⏭️ Already in Wallet (matched by `_id`)
   - ⚠️ Needs asset (symbol not in Wallet)
   - ❌ Parse error
4. **Confirm**: summary counts; "Sync N transactions" button.
5. **Result**: per-doc result from `_bulk_docs`; link to Wallet web UI.

A persistent left nav also exposes a **History** page reading from the local SQLite audit log: list of past runs, expandable to per-doc detail.

## Local state

SQLite via Drizzle ORM. Schema:

```
config (singleton)
  couch_url        TEXT
  couch_auth       TEXT  -- encrypted at rest with OS keychain key, see Security
  user_id          TEXT  -- extracted from couch_url for convenience

broker_account_map
  broker           TEXT PRIMARY KEY  -- 'xtb' | 'ibkr' | 'tradeville'
  account_id       TEXT NOT NULL     -- Wallet "-Account_<uuid>"

sync_run
  id               INTEGER PK
  started_at       INTEGER (epoch ms)
  finished_at      INTEGER (epoch ms)
  broker           TEXT
  account_id       TEXT
  csv_filename     TEXT
  csv_sha256       TEXT
  parsed_count     INTEGER
  inserted_count   INTEGER
  conflict_count   INTEGER
  error_count      INTEGER

sync_run_doc
  run_id           INTEGER FK
  external_id      TEXT
  doc_id           TEXT
  status           TEXT   -- 'inserted' | 'conflict' | 'error' | 'needs_asset'
  error_message    TEXT
```

Local state is purely an audit/UX cache. **CouchDB remains the source of truth** for "is this transaction already in Wallet". Wiping the SQLite DB does not break sync; the next run reads from CouchDB and behaves correctly.

## Configuration & secrets

- `.env.local` (gitignored) holds `COUCH_URL` and `COUCH_BASIC_AUTH` for development.
- For end-user storage at runtime, the Basic auth token is encrypted using the OS keychain via `keytar` and stored in SQLite. The decryption key never touches disk in plaintext.
- The token can be rotated by logging out/in via the Wallet web UI; the tool surfaces a "re-paste credentials" flow on `401`.

## Error handling

- Every error is structured (`{ kind, message, context }`) and surfaced in the UI; no silent catches.
- Parser errors include row + column context.
- Network errors include the URL (with the auth header redacted) and the response status.
- The diff-preview step is purely read-side; if it fails, sync is blocked (no risk of partial writes from a confused state).
- Writes are per-doc via `_bulk_docs`; one bad doc cannot poison the rest.

## Testing strategy

- **Parser tests** (per broker): table-driven, fixtures under `parsers/test/fixtures/<broker>-*.csv`. Each fixture has a sibling `.expected.json` of canonical txns. Cover: standard rows, edge cases (zero-quantity, refund), unknown row types, malformed rows.
- **Sync engine tests**: stub the CouchDB client; assert the right `_bulk_docs` payloads and the right diff-preview output for representative inputs (all-new, all-existing, mixed, with-conflicts).
- **End-to-end smoke** (manual, against a throwaway CouchDB instance using `pouchdb-server` locally): upload a fixture CSV, verify the docs land, re-upload, verify zero new inserts.
- **No tests against the real Wallet CouchDB.** That instance has the user's real data; the smoke tests run against a local stand-in.

## Security & ToS posture

- The CouchDB endpoint is undocumented but used by every official Wallet client. Direct writes from a personal tool, on the user's own data, are functionally indistinguishable from the official web app's writes. Operationally: fine for personal use; not redistributable as a product without BudgetBakers' blessing.
- The repo is private. The tool is not published. Documentation explicitly notes the unofficial protocol use and the rotation path if BudgetBakers changes the schema.
- Credentials never leave the user's machine. No telemetry. No analytics.
- The basic auth token captured during phase 0 must be rotated before the repo goes public (if it ever does).

## Open risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| BudgetBakers changes the CouchDB schema | Low (would break their own clients) | Re-run phase 0 captures; update the doc shape; bump tool version |
| `transactionType` enum has unexpected values | Medium | Phase 0 captures resolve this before any write code is shipped |
| Broker CSVs lack stable transaction ids | Medium | Falls back to content hash; documented per-parser |
| User's basic-auth token expires | Unknown | UI flow for re-paste; document the Wallet logout/login rotation path |
| `_bulk_docs` rate limits | Low | Batch in chunks of 50; exponential backoff on 429 |
| New brokers introduce types we haven't seen (option assignments, splits) | High over time | v1 documents the unsupported-rows path; each new type promotes from "surface as unsupported" → first-class via a parser PR |

## Decision log

- **Why direct CouchDB and not Playwright?** Playwright would still need login (same auth posture), is slower, and breaks on UI changes. Direct CouchDB breaks only if the doc schema changes — same surface area, simpler implementation.
- **Why `new_edits: true` instead of mimicking PouchDB's full handshake (`_revs_diff` + `new_edits: false`)?** We're not a replication peer; we're a one-way insert tool. Letting CouchDB assign revisions is correct for our use case and skips the handshake complexity.
- **Why deterministic `_id` instead of marker-in-note dedup?** The marker approach was the fallback when we thought we were stuck with the read-only REST API. With direct CouchDB access, we control `_id`s, which is strictly better: no string parsing, no risk of marker collision, dedup is enforced by the database itself.
- **Why local-only Next.js?** Avoids hosting + secrets-in-cloud overhead. Trivial to promote to Vercel later if multi-device access matters.
- **Why SQLite for audit only, not as the dedup source of truth?** A local DB drifts from reality if the user touches Wallet on another device. CouchDB is the only consistent source of truth across all Wallet clients.

## Next steps

1. Phase 0 capture session (user; ~15 minutes with DevTools open).
2. Fill in TBDs in this spec (`transactionType` enum, `price` scaling, fee doc shape).
3. Invoke writing-plans to produce the implementation plan.
4. Implement phase by phase: parser interface + XTB parser → CouchDB client → sync engine → UI.
