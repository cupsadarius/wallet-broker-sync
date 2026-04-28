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

- Local web tool. Drag-and-drop a **broker export file** (CSV / XLSX / PDF — format depends on the broker); see a diff preview ("12 new, 340 already synced"); confirm; transactions appear in Wallet.
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

## Broker export formats (observed from real exports)

The user's actual exports — committed locally under `sources/` (gitignored) — confirm the brokers ship different formats. Each parser owns its format-specific decoding:

| Broker | Export format | Source of truth | Stable txn ID? | Currency posture |
|---|---|---|---|---|
| **XTB** | XLSX (multi-sheet workbook) | Sheet `CASH OPERATION HISTORY` (rows where `Type = "Stock purchase"` / `"Stock sale"`) | ✅ Column `ID` is a stable broker txn id (e.g. `999840114`); use directly as `externalId` | EUR-only at the cash-operation level |
| **IBKR** | CSV (Activity Statement, multi-section) | Rows where `section = "Transaction History"` AND `Header = "Data"` AND `Transaction Type ∈ {Buy, Sell}` | ❌ Statement CSV does not include `TradeID`; we fall back to a canonicalized content hash. (Future: switch to Flex Query CSV which exposes `TradeID`.) | Trade in `Price Currency` (often USD); cash impact in account base (EUR). Multiple "Forex Trade Component" rows per trade — these are FX bookkeeping, **skipped** by v1 |
| **Tradeville** | PDF (2 pages observed) | TBD — phase 0 inspects layout | TBD | Likely RON; phase 0 confirms |

Implications for the parser interface: parsers receive **bytes + a filename hint**, not a CSV string. Each parser declares its accepted formats. Detection uses extension first, then content sniffing for ambiguous cases.

## Architecture

```
┌─────────────────────┐    ┌──────────┐    ┌──────────────────┐    ┌──────────────┐    ┌──────────┐
│ Broker export file  │───►│  Parser  │───►│ CanonicalTxn[]   │───►│ Sync Engine  │───►│ CouchDB  │
│ (CSV / XLSX / PDF)  │    │          │    │                  │    │              │    │ (Wallet) │
└─────────────────────┘    └──────────┘    └──────────────────┘    └──────┬───────┘    └──────────┘
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
type ParserInput = {
  bytes: Uint8Array
  filename: string         // e.g. "xtb-2026.xlsx"
  mimeHint?: string        // from browser File.type when available
}

type ParseResult = {
  txns: CanonicalTxn[]
  unsupported: Array<{ row: string | number, reason: string, raw: Record<string, unknown> }>
}

interface BrokerParser {
  id: 'xtb' | 'ibkr' | 'tradeville'
  displayName: string
  acceptedFormats: Array<'csv' | 'xlsx' | 'pdf'>
  detect(input: ParserInput): boolean
  parse(input: ParserInput): ParseResult
}
```

Detection is two-stage: extension first (XLSX → only XTB; PDF → only Tradeville; CSV → only IBKR for now), then content sniffing if more than one parser matches the extension (e.g. inspect headers / first rows). Parsers register themselves into a `parsers` map at module load. The user can always override the auto-detected choice.

**Format dependencies** (added to `package.json`):

- XLSX: [`xlsx`](https://www.npmjs.com/package/xlsx) (SheetJS) — handles multi-sheet workbooks, inline strings, Excel date serials
- PDF: [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist) (Mozilla pdf.js) — text extraction with positioning info; layout-aware reconstruction is the parser's job
- CSV: built-in (or [`papaparse`](https://www.npmjs.com/package/papaparse) if we hit edge cases)

### 2. Canonical model

The single shape every layer downstream of the parser speaks:

```ts
type CanonicalTxn = {
  externalId: string            // broker's transaction id, or canonicalized content hash if absent
  broker: 'xtb' | 'ibkr' | 'tradeville'
  kind: 'buy' | 'sell' | 'fee'
  date: string                  // ISO 8601 timestamp, normalized to UTC ms-precision
  symbol?: string               // ticker; required for buy/sell
  exchange?: string             // MIC or operating MIC; required for buy/sell
  quantity?: number             // required for buy/sell
  pricePerShare?: number        // required for buy/sell, in tradeCurrency
  tradeCurrency?: string        // ISO 4217 — currency the trade was priced in (e.g. USD on IBKR)
  settlementCurrency: string    // ISO 4217 — currency that hit the broker cash account (e.g. EUR)
  fxRate?: number               // tradeCurrency → settlementCurrency; required if currencies differ
  cashAmount: number            // signed cash impact in settlementCurrency (negative = outflow)
  description: string           // human-readable summary
  raw: Record<string, unknown>  // original CSV row, for debugging
}
```

`fee` rows are emitted by the parser when the broker reports them as separate line items. When fees are bundled into the trade row (e.g. as a "commission" column), the parser folds them into `cashAmount` and emits no separate fee txn.

**FX-aware single-currency mapping (v1):** when `tradeCurrency !== settlementCurrency`, v1 maps the trade onto Wallet using `priceCurrencyCode = tradeCurrency`, `cashAmountCurrencyCode = settlementCurrency`, with `price = pricePerShare` (in trade currency) and `cashAmount = cashAmount` (in settlement currency). The two-currency story is preserved on-disk; v1 does not perform FX translation. Wallet renders the values; if Wallet shows the trade in tradeCurrency that's fine.

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
  assetType:          number   // TBD — phase 0 captures the full enum (provisional: 1 = stock/ETF)
  transactionType:    number   // TBD — phase 0 captures the full enum (provisional: 0 = buy, 1 = sell)
  date:               ISO timestamp   // TBD — phase 0 confirms timezone convention
  quantity:           number
  price:              number   // TBD — phase 0 confirms encoding (decimal vs scaled integer)
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
_id = "-AssetTransaction_" + uuidv5(broker + ":" + externalId, NAMESPACE_WALLET_SYNC)
```

We use plain UUIDv5 by default. This is what phase 0 capture #12 tests against the live BudgetBakers CouchDB. If that test passes (BudgetBakers does not enforce a UUID-version regex on `_id`), we ship as-is.

**Fallback if phase 0 #12 reveals UUID-version rejection.** Wallet's web/mobile clients use PouchDB, which generates v4 UUIDs (the captured doc shows `...4a22-9ef2...` — note the `4` at position 14). If `validate_doc_update` enforces a v4-shaped `_id`, swap the generator to v5-with-version-nibble-flipped-to-4:

```ts
function deterministicV4LookingUuid(name: string): string {
  const v5 = uuidv5(name, NAMESPACE_WALLET_SYNC)
  // v5 format: xxxxxxxx-xxxx-5xxx-Nxxx-xxxxxxxxxxxx
  // overwrite position 14 (the version nibble) with '4' → bit-for-bit
  // indistinguishable from a real v4 UUID to any validator that checks
  // UUID version. Still deterministic. Collision resistance is
  // essentially unchanged at our scale (122 bits of entropy).
  return v5.substring(0, 14) + '4' + v5.substring(15)
}
```

The fallback is a one-line generator change; the rest of the architecture is unaffected. If phase 0 #12 reveals an even stricter rejection (any non-PouchDB-generated `_id`), the second fallback is mirror-mode dedup (random `_id`s + `externalId` field as the dedup key, queried via `_find` before writes).

`NAMESPACE_WALLET_SYNC` is **pinned for the lifetime of this tool**:

```
NAMESPACE_WALLET_SYNC = "dda5a242-7458-4066-9b2b-5c551d9753e3"
```

Changing this constant after any sync run has shipped would orphan every previously-written doc — re-imports would generate fresh `_id`s and produce duplicates. The constant lives in `src/sync/namespace.ts` and must never be edited.

Properties:

- Same input → same `_id`. Re-importing yields a CouchDB conflict, not a duplicate.
- Different brokers can't collide (broker is part of the input).
- We never need to query before writing to know whether something exists; CouchDB's response tells us.

For brokers that don't supply a stable transaction id, the parser computes a content hash from a **canonicalized** form of `(date, exchange|MIC, symbol, quantity, price, side, cashAmount)`:

- `date` is normalized to UTC ISO-8601 with millisecond precision (`2026-04-28T10:11:20.382Z`).
- Numeric fields are formatted with a fixed locale (`.` decimal separator, no thousands separator) to a fixed precision matching the parser's source-of-truth precision (declared per-parser; e.g. XTB → 4 decimal places for price, 6 for quantity).
- Symbol is uppercased; exchange/MIC is required (see Asset lookup) so two listings of the same ticker on different venues hash differently.
- `cashAmount` is included so a parser bug that produces the right trade fields with a wrong cash amount can be detected as a *new* doc rather than silently colliding with the correct one.

The canonicalization function is part of the public parser contract and tested against fixtures. Two identical orders on the same millisecond timestamp on the same venue would still collide — accepted limitation, documented per parser.

### Asset lookup

Each `AssetTransaction` requires an `assetId` pointing to an existing `StocksFundsAsset` doc.

**Symbols are not globally unique.** The same ticker can refer to different securities on different venues (e.g. `SHEL` on LSE vs NYSE), and IBKR accounts in particular trade the same symbol across multiple exchanges. Keying lookups on bare ticker would silently misroute trades to the wrong asset.

**Strategy:**

1. On startup, fetch all `StocksFundsAsset` docs (low volume — the user's portfolio set).
2. Build a `Map<exchange|MIC + ":" + symbol, assetId>`. The `StocksFundsAsset` schema's exchange field name is TBD in phase 0; until confirmed, the implementation uses whichever field carries the venue (MIC code, exchange short name, or operating MIC).
3. Each `CanonicalTxn` carries `exchange` (MIC where the trade settled). The parser is required to populate it; CSVs that omit exchange must be enriched by the parser using broker-specific rules (e.g. XTB's instrument table) or marked as parse errors.
4. For each canonical txn, look up `(exchange, symbol)`. If found, use the `assetId`. If not found, we'd need to create a new `StocksFundsAsset` doc — **deferred to phase 0**, because we don't yet know that doc's required schema. v1 short-term path: surface "unknown asset" rows in the preview UI; user creates them once via Wallet's web UI; subsequent imports work.

### Account selection

One-time, in setup:

1. Fetch all `Account` docs where `accountType` is investment-related.
2. Show the user a mapping UI: `XTB → ?`, `IBKR → ?`, `Tradeville → ?`.
3. Persist the mapping to local SQLite (`broker_account_map`).

Re-runs use the persisted mapping; the user can edit it in a settings page.

## Sync algorithm

```
function sync(broker: BrokerId, input: ParserInput, accountId: string) {
  1. const { txns, unsupported } = parsers[broker].parse(input)
  2. Resolve assets: for each unique (exchange, symbol), lookup or surface as "needs creation"
  3. Map to AssetTransaction docs (deterministic _id, custom fields, assigned assetId)
  4. Read existing docs for this account from CouchDB (Mango query on accountId)
  5. Diff:
       - existing = set of _id already present
       - new      = docs whose _id not in existing
       (v1 does not compute "changed" — we never overwrite, so the comparison is dead weight.
        Re-introduce in v2 only if a use case appears.)
  6. Render diff preview UI (new + unsupported + needs-asset); await user confirmation
  7. POST /_bulk_docs with new docs (new_edits: true), in batches of N (N from phase 0 capture #9)
  8. Parse per-doc response:
       - 201/200  → inserted
       - 409      → already present (treat as no-op, not an error)
       - other    → log; surface in run summary
  9. Persist run summary + unsupported rows to local SQLite
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

Before writing sync code, the user performs small captures from the Wallet web UI with DevTools open. Each capture is a curl/HAR for one operation; the spec is updated with confirmed enum values, scaling, and doc shapes. Captures live under `docs/superpowers/captures/` (gitignored — they contain auth tokens) and are summarized into redacted excerpts in this spec.

| # | Operation | Resolves |
|---|---|---|
| 1 | Buy 0.001 of an existing low-cost asset (e.g. €1 trade) | `transactionType` for buy; `price` scaling at small-decimal scale |
| 2 | Sell 0.001 of same asset | `transactionType` for sell |
| 3 | A buy on an asset priced in a foreign currency (USD asset, EUR account) | FX field shape: separate `priceCurrencyCode` vs `cashAmountCurrencyCode`, `fxRate` storage location |
| 4 | A buy that triggers a "Charges, Fees" line | Fee = separate doc? Capture its `reservedModelType` and full fields |
| 5 | View any existing trade and copy its `assetId` and `StocksFundsAsset` doc | `StocksFundsAsset` schema (incl. exchange/MIC field name) for asset lookup and v2 creation |
| 6 | Fetch all `Account` docs via `_all_docs?include_docs=true&startkey="-Account_"&endkey="-Account_￰"` | `Account` schema; specifically the field that distinguishes investment accounts from regular ones |
| 7 | A trade on a different timezone (e.g. US market hours from a CET account) | Timezone normalization: is `date` stored as UTC, local, or with offset? Cross-check web vs mobile if possible |
| 8 | Login flow on the web app | How the Basic-auth token is acquired; whether there's a refresh path or it's pinned for the session |
| 9 | A `_bulk_docs` call with 100 docs (synthetic, e.g. via re-export of historic data triggering bulk replication) | Max practical batch size, presence of payload-size limits, observed rate-limiting headers |
| 10 | Open `sources/tradeville.pdf` with `pdfjs-dist`; dump all text items with `(text, x, y, page)` triplets | Tradeville PDF layout: column x-positions, header row y-position per page, separator/noise text to ignore. **Output**: a `parsers/tradeville-layout.ts` constants file describing column geometry. |
| 11 *(dry-run, not network capture)* | Open `sources/xtb.xlsx` and `sources/ibkr.csv` with the implementation parsers in dry-run mode | Sanity-check parsers against real data before writing to CouchDB; produce a JSON dump of `CanonicalTxn[]` for human review. |
| 12 | Write **one** synthetic `AssetTransaction` doc to CouchDB with a deterministic v4-looking `_id` (e.g. `-AssetTransaction_<uuidv5-with-flipped-version>`), `accountId` pointing to a sandbox-acceptable account, and minimal valid fields; immediately read it back via `_find`. | Confirms BudgetBakers' `validate_doc_update` accepts a deterministic-but-v4-shaped `_id`. **If accepted**: deterministic-`_id` dedup is green-lit, proceed as designed. **If rejected** with a UUID-version error: investigate the actual constraint and adjust the `deterministicV4LookingUuid` function. **If rejected** with a more general "not a valid id format" error: fall back to mirror-mode dedup (random `_id`s + `externalId` field as the dedup key, queried via `_find`). Document the chosen path in this spec. The test doc is then deleted (PUT with `_deleted: true`) to keep Wallet clean. |

**Outputs of phase 0** (committed to the spec, not the captures themselves):

- `transactionType` enum table: `0=buy, 1=sell, ?=fee, ?=…` — fully filled in
- `assetType` enum table — fully filled in for stocks/ETFs (other types deferred)
- `price` field encoding: decimal vs integer scaling, with example
- Fee doc shape: model type, fields, relationship to its parent trade
- `StocksFundsAsset` schema: fields needed to resolve and (eventually) create
- `Account` schema: investment-account discriminator field
- Timezone convention
- Reserved audit fields required on writes: confirmed list of `reservedCreatedAt`, `reservedUpdatedAt`, `reservedSource`, `reservedOwnerId`, `reservedAuthorId`, plus any others observed
- Safe `_bulk_docs` batch size

The implementation plan does not begin until phase 0 captures are filed and this spec's TBDs are resolved.

## Parser layer details

### File layout

```
parsers/
  index.ts          # registry, detect()
  types.ts          # ParserInput, ParseResult, CanonicalTxn types shared with sync engine
  hash.ts           # canonical content-hash helpers (per parser-contract numeric formatting)
  xtb.ts            # XTB parser  (XLSX, sheet "CASH OPERATION HISTORY", uses xlsx pkg)
  ibkr.ts           # IBKR parser (CSV Activity Statement, multi-section)
  tradeville.ts     # Tradeville parser (PDF, uses pdfjs-dist)
  test/
    xtb.test.ts
    ibkr.test.ts
    tradeville.test.ts
    fixtures/
      xtb-2026.xlsx          # redacted real export
      xtb-edge-cases.xlsx    # synthetic
      ibkr-2026.csv          # redacted real export
      ibkr-edge-cases.csv    # synthetic (multi-currency, FX components, dividends to skip)
      tradeville-2026.pdf    # redacted real export
      tradeville-edge-cases.pdf  # synthetic
```

**Fixture policy:**

- `parsers/test/fixtures/` is committed to the repo (used by CI / local test runs).
- Real-export fixtures must be **redacted** before being committed. Redaction procedure per format:
  - **CSV** — straight text edit; replace `Name and surname`, `Account` numbers (`U***22945` already partially-masked by IBKR), and any unique identifiers with placeholders.
  - **XLSX** — open in LibreOffice (or `xlsx` lib) to a fresh workbook, copy values only (no formulas, no embedded objects), strip workbook properties (`xl/docProps/core.xml`, `app.xml`) using a small build script, and verify with `unzip -p <file>.xlsx xl/sharedStrings.xml` that no PII strings remain. Save fresh to drop hidden metadata.
  - **PDF** — extract text-only via `pdfjs-dist`, regenerate a synthetic PDF with the same layout (e.g. via `pdf-lib`), or use `exiftool -all= <file>.pdf` and a search/replace pass on the text layer. Verify with `pdftotext -layout` (or our own pdfjs dump) that no PII remains. PDFs carry XMP/Info dicts and font subsets; the cleanest path is to regenerate from extracted text rather than redact in place.
- If a redaction procedure is impractical for a given file, commit a **synthetic fixture** instead and keep the redacted real export only under `sources/` (gitignored). Any contributor adding fixtures must document which mode was used in a sibling `<fixture>.README.md`.

### Per-parser responsibilities (general)

- **Charset detection and decoding** for text-based formats. Probe BOM (UTF-8, UTF-16 LE/BE); fall back to broker-specific defaults. Misdetection must error, not silently mojibake.
- **Decimal separator handling.** Locales vary: `1,234.56` (US) vs `1.234,56` (EU) vs `1234,56` (RO). Each parser declares its source format and uses a strict numeric parser that rejects ambiguous inputs.
- **Excel date serial conversion** (XTB sheets store timestamps as serial floats like `45964.5607831481`).
- **Exchange/MIC enrichment.** When the source omits the venue, the parser uses broker-specific tables to fill `exchange`. A row that cannot be resolved to a venue is a parse error, not a soft warning.
- **Reject malformed input with structured errors** (`row N, column X: <reason>`, or `page N, line: ...` for PDF) — surfaced in the UI.
- Emit `kind: 'fee'` only when the broker reports fees as standalone rows. Trade-embedded fees get folded into `cashAmount`.
- **Never silently drop rows.** Unknown row types must produce a structured `unsupported` array returned alongside the parsed txns; the UI surfaces them.

### Per-parser specifics

**XTB (XLSX):**
- Open the workbook; locate sheet named `CASH OPERATION HISTORY` (defensive lookup; tolerate trailing spaces, e.g. `'PENDING ORDERS HISTORY '`).
- Skip metadata rows; the data table starts after a header row whose first column is `ID` (typically row 11).
- Filter rows where `Type` is `Stock purchase` (→ buy) or `Stock sale` (→ sell). Other types (`deposit`, `withdrawal`, `dividend`, etc.) go to `unsupported` for v1.
- Parse `Comment` field with regex (e.g. `^OPEN BUY (\d+(?:\.\d+)?) @ (\d+(?:\.\d+)?)$`) to extract `quantity` and `pricePerShare`.
- Time field is an Excel serial (days since 1900-01-01 with the historic leap-year bug); convert via `xlsx.SSF.parse_date_code` or `(serial - 25569) * 86400 * 1000` ms.
- `externalId` = the `ID` column value (stable across re-exports).
- `tradeCurrency = settlementCurrency = "EUR"` (XTB account base).
- Map `Symbol` (e.g. `VUAA.DE`) — the suffix (`.DE`) hints at the venue; an exchange-suffix → MIC table lives in `parsers/xtb-venues.ts`.

**IBKR (CSV Activity Statement):**
- Multi-section CSV with rows of shape `<section>,<Header|Data>,<...fields>`.
- Read `Summary` → `Base Currency` to get account base.
- Filter `Transaction History` data rows; **only** `Transaction Type ∈ {Buy, Sell}` for v1.
- Skip `Transaction Type = "Forex Trade Component"`. These rows are IBKR-internal bookkeeping that records the EUR↔USD leg auto-generated to settle a USD trade against the EUR base currency. The actual buy/sell row already carries the converted `Net Amount` (in EUR) and the unconverted `Price` + `Price Currency` (USD) — i.e. all the data v1 needs. FX components are duplicates of cash impact already reflected in the trade row, so skipping them does **not** lose buy/sell fidelity. Caveat: a standalone FX conversion (not tied to a trade) would also appear as Forex Trade Component and would be silently skipped — but standalone FX is a v2 deposits/withdrawals concern, explicitly out of v1 scope.
- Skip `Dividend`, `Foreign Tax Withholding`, `Adjustment` for v1 — surface to `unsupported` so the user knows.
- Numbers may be in scientific notation (e.g. `5.0E-4`) — `parseFloat` handles this.
- `tradeCurrency` from `Price Currency` (commonly USD); `settlementCurrency` from base (EUR); `cashAmount` from `Net Amount` (in base).
- `pricePerShare` from `Price` (in tradeCurrency).
- Fees: `Commission` column on the trade row → folded into `cashAmount` (since `Net Amount = Gross + Commission` in the source). v1 emits no separate fee txn for IBKR.
- Account is masked in the source (`U***22945`) — no PII handling needed; we don't store it on the doc.
- **No stable transaction ID** in this CSV format → fall back to canonicalized content hash for `externalId`. Document this in `parsers/ibkr.ts` header.
- `exchange` is **not** in the source; resolve from `Symbol` via a curated table. This is the weakest link for IBKR; if the user trades the same ticker on multiple venues, the table needs per-user overrides (deferred to v2).

**Tradeville (PDF):**
- Use `pdfjs-dist` to extract text items with positions (`(text, x, y, page)`).
- Phase 0 inspection (see Phase 0 capture #10) determines the layout: column boundaries, header row position per page, footer/header noise to strip.
- Reconstruct rows by clustering text items into y-bands; columns by x-position.
- Extract: trade date, type (BUY/SELL or RO equivalents — `Cumpărare`/`Vânzare`?), symbol, quantity, price, fee, total.
- `tradeCurrency = settlementCurrency = "RON"` (provisional; phase 0 confirms).
- **Layout-validation tripwire** (mandatory): before extracting rows, the parser asserts that the captured layout still matches the file. Concretely: anchor strings declared in `tradeville-layout.ts` (e.g. expected header words like `"Simbol"`, `"Cantitate"`, `"Pret"` — confirmed during capture #10) must appear at their expected `(page, x±tolerance, y±tolerance)`. If any anchor is missing or off-position by more than tolerance, the parser **fails the import** with `"Tradeville layout drift — re-run phase-0 capture #10 and update tradeville-layout.ts"`. This guarantees layout drift produces a clean failure rather than silently wrong txns.
- **Fragility note in code header**: PDF parsing breaks if Tradeville re-skins their statement. Recovery = re-run phase-0 capture, update the column-position constants. The parser owns a `tradeville-layout.ts` constants file specifically to make these tweaks low-cost.
- If `pdfjs-dist` extraction is unreliable (e.g. PDF is image-based without an embedded text layer), fail the import with a clear error. v1 does not attempt OCR.

### Parser interface

The canonical interface is defined once, in the **Parser layer** section above. It takes `ParserInput` (bytes + filename + optional MIME hint), not a CSV string, and declares `acceptedFormats`. See `parsers/types.ts` in the file layout.

## UI flow

Single-page Next.js app, runs locally on `localhost:3000`. Five screens:

1. **Setup** (first run only): paste CouchDB URL + Basic auth token; test connection; map XTB/IBKR/Tradeville to Wallet investment accounts.
2. **Upload**: drop file (CSV / XLSX / PDF) → broker auto-detected from extension + content sniff → user confirms broker + target account.
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
  source_filename  TEXT       -- e.g. "xtb.xlsx", "ibkr.csv", "tradeville.pdf"
  source_sha256    TEXT       -- hash of input bytes
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

- **Runtime credentials live in the OS keychain only**, accessed via `keytar`. Stored under service `wallet-broker-sync`, account `couch-basic-auth`. SQLite never holds credential material.
- **Non-secret config** (CouchDB URL, user id, broker→account mappings) lives in SQLite.
- **Development**: a `.env.local` (gitignored) may hold `COUCH_URL` for convenience, but the auth token must always come from the keychain — there is no fallback to plaintext env. First-run setup writes the token to the keychain; subsequent runs read it.
- **Rotation**: the Wallet web UI logout/login rotates the sync token. The tool surfaces a "re-paste credentials" flow on `401` and writes the new token back to the keychain.
- **Never logged.** Auth headers are redacted by a logger middleware; the redaction is verified by a unit test that snapshots logger output for a representative request.

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

### Git-leak prevention (proactive)

- `.gitignore` includes: `.env`, `.env.*`, `.env.local`, `*.har`, `docs/superpowers/captures/`, `*.sqlite`, `*.sqlite-journal`, `node_modules/`, `.next/`.
- A pre-commit hook (`pre-commit` framework or husky + a small custom script) scans staged content for: the user-id UUID format, the basic-auth pattern (`Authorization: Basic [A-Za-z0-9+/=]+`), and `couch-prod-eu-1.budgetbakers.com/bb-` followed by a UUID. Any match aborts the commit.
- The basic-auth token captured during phase 0 must be rotated immediately after captures are filed, regardless of whether the repo ever goes public — captures are gitignored but local copies still exist.
- README documents the "if you committed a token by mistake" rotation path: log out everywhere from Wallet, log back in, update keychain.

## Open risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| BudgetBakers changes the CouchDB schema | Low (would break their own clients) | Re-run phase 0 captures; update the doc shape; bump tool version |
| `validate_doc_update` rejects our deterministic `_id` | Low (mitigated by force-v4 shape) | Phase 0 capture #12 tests this explicitly before any write code ships. Two-step fallback: refine the v4-looking UUID generator, then if needed, switch to mirror-mode dedup (random `_id`s + `externalId` field). Architecture survives either way. |
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
