# Retirement Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read Pilon 1/2/3 and unit-linked PDF statements, store them locally, and show locked retirement money, its yield and its release dates on a Retirement page, on Today, in net worth and over MCP.

**Architecture:** One folder, `src/retirement/`. It holds a text extractor (pdfjs → lines), one pure parser per provider behind `parseStatement(lines)`, a store that writes three new tables, and a pure `summarize()` that every surface reads through `loadRetirement()`. Upload goes to a new route. The page, Today, Invest, MCP and Ask read the summary.

**Tech Stack:** Next.js 16.2 (read `node_modules/next/dist/docs/` first), drizzle + better-sqlite3, zod, vitest, `pdfjs-dist` (installed), `xirr` (installed).

**Spec:** `docs/superpowers/specs/2026-11-17-retirement-design.md`

## Global Constraints

- Add no new dependency. Read PDFs with `pdfjs-dist/legacy/build/pdf.mjs`, set up as in `src/parsers/tradeville-pdf.ts:21-35`. Compute returns with `xirr`, as in `src/dashboards/compute/performance.ts:189-198`.
- Money is an integer × 100 in the account currency.
- **The repo is public.** Fixtures are synthetic text in the real layout, with invented names, IDs, contract numbers and amounts. No value from a real statement goes into the repo.
- No CNP, address, phone or email is stored, logged or returned. The only thing taken from the CNP is the birth date.
- Nothing is written to Wallet/CouchDB.
- Default release age is 65. A statement is stale after 90 days, or 365 days for Pilon 1. The default VPR is 8100 (81.00 RON).
- Run migrations only at boot (see `instrumentation.ts`). Never run `runMigrations()` at import time.
- Commits use `/ledger`. They carry no `Co-Authored-By`, `Claude-Session` or "Generated with" lines.

## Review Focus

1. **A BT statement whose rows do not add up to its footer total** (a page break splits a row): the parser must throw, never store a short history. Pinned in Task 1.
2. **Re-upload of the same file, or an older statement after a newer one**: skip by hash. The older BT statement must not replace the newer contribution history. Pinned in Task 4.
3. **An account past its release date**: it moves to available on that day, and it is never counted in both totals. Pinned in Task 5.
4. **An EUR account with no FX rate for the day**: it is left out of the RON totals and flagged. It never counts as 0. Pinned in Task 5.
5. **A non-retirement PDF dropped on Upload** (a Tradeville PDF): it goes on to the broker flow, not "unsupported". Pinned in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/retirement/types.ts` | `Statement` union and helper types |
| `src/retirement/pdf.ts` | `pdfLines(bytes)`: y-grouped text lines |
| `src/retirement/parse.ts` | `parseStatement(lines)`, number and date helpers, CNP → birth date |
| `src/retirement/parsers/{bt,allianz,signal,cnpp}.ts` | One parser per layout |
| `src/retirement/store.ts` | `saveStatement()`, release-date and VPR writes |
| `src/retirement/compute.ts` | Pure: `yearlyReturn`, `summarize`, `retirementTasks` |
| `src/retirement/load.ts` | `loadRetirement()`: DB + FX → `summarize` |
| `src/storage/schema.ts`, `src/storage/migrations/0011_retirement.sql` | Three tables |
| `app/api/retirement/upload/route.ts` | Multipart PDFs → parse → save |
| `app/invest/retirement/{page,actions}.tsx` | Retirement page, release date and VPR forms |
| `tests/retirement/fixtures/*.txt` | Synthetic statement text |

### Shared types (`src/retirement/types.ts`)

```ts
export type Provider = 'bt-pensia-noastra' | 'bt-pensii' | 'allianz' | 'signal-iduna' | 'cnpp'
export type Contribution = { date: string; gross: number; fee: number }        // ints ×100
export type MoneyStatement = {
  kind: 'pilon2' | 'pilon3' | 'unit-linked'; provider: Exclude<Provider, 'cnpp'>
  product: string; contract: string; currency: 'RON' | 'EUR'; asOf: string    // YYYY-MM-DD
  value: number; paidIn: number; fees: number | null                          // ints ×100
  contributions: Contribution[] | null                                        // BT only
  birthDate: string | null
}
export type Pilon1Statement = {
  kind: 'pilon1'; provider: 'cnpp'; asOf: string
  period: { years: number; months: number; days: number }
  points: number; pointsByYear: { year: number; points: number }[]
  birthDate: string | null
}
export type Statement = MoneyStatement | Pilon1Statement
```

---

### Task 1: Text extraction, number helpers, BT parser

**Files:**
- Create: `src/retirement/types.ts`, `src/retirement/pdf.ts`, `src/retirement/parse.ts`, `src/retirement/parsers/bt.ts`
- Create: `tests/retirement/fixtures/bt-pilon2.txt`, `tests/retirement/fixtures/bt-pilon3.txt`
- Test: `tests/retirement/parse.test.ts`

**Interfaces:**
- Produces: `pdfLines(bytes: Uint8Array): Promise<string[]>`; `parseStatement(lines: string[]): Statement | null`; `roNumber(s: string): number` (`"2.345,00"` → 2345, `"12345,00"` → 12345); `toCents(n: number): number`; `roDate(s: string): string` (`"15.06.2011"` or `"01-09-2026"` → `"2011-06-15"`); `birthDateFromCnp(cnp: string): string | null` (S=1/2 → 19YY, 5/6 → 20YY).

The BT layout, as `pdfLines` produces it (both pilons):

```
BT Pensia Noastra SAFPAP                       ← "BT Pensii SAFPF SA" + "Extras de cont Pensia Mea" for Pilon 3
Extras de cont Pensia Noastra
Numar act de aderare ABC/123456 din 02.06.2011
POPESCU ION
1850101123456                                  ← 13-digit CNP on its own line
Alocare contributie 15.06.2011 200,00 5,00 195,00 18,500000 10,540541 195,00
Corectie alocare 03.10.2011 0,00 0,00 0,00 0,000000 -0,000048 0,00
Informatii la 30.09.2026
Valoare totala contributii brute 1400,00
Valoare cont 1650,40
```

- [ ] **Step 1: Write the fixtures.** `bt-pilon2.txt` has the Pilon 2 header and 6 `Alocare contributie` rows. Their gross values sum to the footer `Valoare totala contributii brute`. Give two rows a non-zero fee. Split the rows over a `--- page 2` line with the header repeated. Add one `Corectie alocare` row. `bt-pilon3.txt` has the Pilon 3 header and 3 rows with zero fees. Every name, number, CNP and contract number is invented. Use the CNP `1850101123456`.

- [ ] **Step 2: Write the failing tests**

```ts
it('parses a BT Pilon 2 statement with every contribution', () => {
  const s = parseStatement(fixture('bt-pilon2.txt')) as MoneyStatement
  expect(s).toMatchObject({ kind: 'pilon2', provider: 'bt-pensia-noastra', currency: 'RON', contract: 'ABC/123456',
    asOf: '2026-09-30', value: 165040, paidIn: 140000, birthDate: '1985-01-01' })
  expect(s.contributions).toHaveLength(6)
  expect(s.contributions![0]).toEqual({ date: '2011-06-15', gross: 20000, fee: 500 })
  expect(s.fees).toBe(/* sum of the fixture's fees ×100 */)
})
it('parses a BT Pilon 3 statement', () => { /* kind 'pilon3', provider 'bt-pensii' */ })
it('throws when the rows do not add up to the footer total', () => {
  const lines = fixture('bt-pilon2.txt').filter(l => !l.startsWith('Alocare contributie 15.06.2011'))
  expect(() => parseStatement(lines)).toThrow(/contributions/)
})
it('returns null for text it does not know', () => expect(parseStatement(['Tradeville', 'Activity'])).toBeNull())
it('never returns the CNP', () => expect(JSON.stringify(parseStatement(fixture('bt-pilon2.txt')))).not.toContain('1850101123456'))
```

Also test `roNumber`, `roDate` and `birthDateFromCnp` (`'5030215000000'` → `'2003-02-15'`, `'9...'` → null).

- [ ] **Step 3: Run it.** Run `npx vitest run tests/retirement/parse.test.ts`. Expected: it fails because the module is missing.
- [ ] **Step 4: Implement.**
  - `pdfLines` groups items by page, then by rounded y (top to bottom), then sorts by x. It joins each line with single spaces and starts each page with a `--- page N` line, as in the extractor already used on the real samples.
  - `parseStatement` tries each parser's `detect(lines)` in turn.
  - The BT parser detects on `Extras de cont Pensia (Noastra|Mea)`.
- [ ] **Step 5: Run it.** Expected: PASS.
- [ ] **Step 6: Check against the real PDFs, locally only.** Write a scratch script outside the repo. It prints `parseStatement(await pdfLines(...))` for the real files in `~/.claude/uploads/…`. Compare by eye: the value and paid-in must match the footers. Commit nothing from this step.
- [ ] **Step 7: Commit.** Run `/ledger`, for example `feat(retirement): parse BT pension statements`.

### Task 2: Allianz and Signal parsers

**Files:**
- Create: `src/retirement/parsers/allianz.ts`, `src/retirement/parsers/signal.ts`
- Create: `tests/retirement/fixtures/allianz.txt`, `tests/retirement/fixtures/signal.txt`
- Modify: `src/retirement/parse.ts` (register both)
- Test: `tests/retirement/parse.test.ts`

**Interfaces:** Consumes `roNumber`, `roDate`, `toCents`. Produces the parsers registered in `parseStatement`.

The layout lines the parsers key on (values invented):

```
Allianz:  Polita dvs. nr. ULT0000001234 | Investitie, la data 01-09-2026 : | TOTAL 50.000,00
          Total sume destinate investirii pâna la 03-09-2026: 40.000,00 RON
          Taxa de asigurare: 300,00 RON | Taxa de alocare: 800,00 RON | Taxa de recuperare a cheltuielilor initiale: 1.900,00 RON
          detect: "Allianz-Tiriac" and "Scrisoare de Raport Cont"; product "Dinamic Invest"; currency RON
Signal:   Poliţa de asigurare nr. 1000001/4 | Valoarea totală a conturilor (primă de bază, Top-Up) la data de 14.07.2026 1.000,0000 2.400,00
          Total prime încasate 2.000,14 EURO | the cost lines under "Costuri aferente poliţei"
          (take the first number of each line, e.g. "1,10 / 0,28 EURO" → 1,10)
          detect: "SIGNAL IDUNA" and "Valoarea contului"; product "101 Invest"; currency EUR
```

- [ ] **Step 1: Write the fixtures** in the real line shapes above, with invented values.
- [ ] **Step 2: Write the failing tests.**
  - Allianz → `{ kind: 'unit-linked', provider: 'allianz', currency: 'RON', contract: 'ULT0000001234', asOf: '2026-09-01', value: 5_000_000, paidIn: 4_000_000, fees: 300_000, contributions: null, birthDate: null }`.
  - Signal → `{ provider: 'signal-iduna', currency: 'EUR', contract: '1000001/4', asOf: '2026-07-14', value: 240_000, paidIn: 200_014 }`, with `fees` equal to the sum of the first number of each cost line.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.** Use the value on the `TOTAL` line (Allianz) and the last number on the "Valoarea totală" line (Signal).
- [ ] **Step 5: Run them.** Expected: PASS. Check against the real PDFs, locally only, as in Task 1 Step 6.
- [ ] **Step 6: Commit.** Run `/ledger`.

### Task 3: CNPP (Pilon 1) parser

**Files:**
- Create: `src/retirement/parsers/cnpp.ts`, `tests/retirement/fixtures/cnpp.txt`
- Modify: `src/retirement/parse.ts`
- Test: `tests/retirement/parse.test.ts`

The lines it keys on:
- Detect: `RAPORT` and `stagiului de cotizare si punctajului`.
- Year rows sit after `DESFASURATOR ANUAL STAGII SI PUNCTAJE:` and before `CENTRALIZATOR`. Each is `<year> <sum of monthly points> <yearly points> …`. Take the second number as the year's points. Year rows can continue on a later page.
- Total: `Total perioada <years> <months> <days> <points> <sum>`.
- As of: `Datele au fost calculate la: 02.10.2026`.
- The CNP appears in the monthly rows as a 13-digit token.

- [ ] **Step 1: Write the fixture.** Include 4 year rows, one of them after a `--- page N` break, then the CENTRALIZATOR block. All numbers are invented. Use the CNP `1850101123456` inside one monthly row.
- [ ] **Step 2: Write the failing test.** Expect `{ kind: 'pilon1', provider: 'cnpp', asOf: '2026-10-02', period: { years: 6, months: 2, days: 10 }, points: 7.5, birthDate: '1985-01-01' }`, `pointsByYear` with 4 rows in year order, and their sum equal to `points` within 0.0001.
- [ ] **Step 3: Run it.** Expected: FAIL. **Step 4:** Implement. **Step 5:** Run it. Expected: PASS. Check against both real CNPP PDFs, locally only. The older one must report points to 2023, the newer one to 2026.
- [ ] **Step 6: Commit.** Run `/ledger`.

### Task 4: Tables and store

**Files:**
- Modify: `src/storage/schema.ts`
- Create: `src/storage/migrations/0011_retirement.sql`; add a journal entry `idx 11`, `when 1795652400000`, `tag 0011_retirement`
- Create: `src/retirement/store.ts`
- Test: `tests/retirement/store.test.ts` (mock `@/src/storage/db` with an in-memory migrated DB, as `tests/mcp/http.test.ts:3-10` does)

Tables:
- `retirement_account`:
  - `id` text PK: `${provider}:${contract}`, or `cnpp` for Pilon 1.
  - `kind`, `provider`, `product`, `currency`, `release_date` (nullable), `created_at`.
- `retirement_statement`:
  - `id` (autoincrement), `account_id`, `as_of`.
  - `value`, `paid_in`, `fees`: ints, nullable. They are null for Pilon 1.
  - `details`: JSON text for the Pilon 1 period, points and pointsByYear; null otherwise.
  - `file_hash` UNIQUE, `uploaded_at`.
  - UNIQUE(`account_id`, `as_of`).
- `retirement_contribution`: `account_id`, `date`, `gross`, `fee`.

Use `CREATE TABLE IF NOT EXISTS`. Config keys: `retirement.birthDate` and `retirement.vpr`.

**Interfaces:**
- Produces:
  - `saveStatement(st: Statement, fileHash: string, now?: Date): Promise<'saved' | 'duplicate'>`
  - `setReleaseDate(accountId: string, date: string | null): Promise<void>`
  - `setVpr(cents: number): Promise<void>`
  - `defaultReleaseDate(kind: Statement['kind'], birthDate: string | null): string | null`: the 65th birthday for `pilon2` and `pilon3`, null otherwise.

- [ ] **Step 1: Write the failing tests**

```ts
it('creates the account with the 65th birthday as release date for a pilon', ...)       // '2050-01-01' for birthDate 1985-01-01
it('leaves the release date blank for a unit-linked policy', ...)
it('skips a file it already has, and a second statement for the same account and date', ...) // 'duplicate' both times
it('replaces the contributions only when the statement is the newest', ...)              // newer then older upload → newer rows stay
it('stores the birth date once and never overwrites a release date the user set', ...)
```

- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3:** Implement. Do the account, statement and contribution writes in one `db.transaction`. **Step 4:** Run them. Expected: PASS. Also run `npx vitest run` and expect the suite to stay green.
- [ ] **Step 5: Commit.** Run `/ledger`.

### Task 5: Summary, yearly return, Today tasks (pure)

**Files:**
- Create: `src/retirement/compute.ts`, `src/retirement/load.ts`
- Modify: `src/dashboards/compute/today.ts`: `Task.kind` gains `'retirement'`
- Test: `tests/retirement/compute.test.ts`

**Interfaces:**
- Consumes: the rows from Task 4.
- Produces:

```ts
export type AccountView = {
  id: string; kind: 'pilon2' | 'pilon3' | 'unit-linked'; provider: Provider; product: string; contract: string
  currency: 'RON' | 'EUR'; asOf: string; stale: boolean
  value: number; paidIn: number; gain: number; fees: number | null          // ints ×100, account currency
  valueBase: number | null                                                    // ×100 RON; null when no FX
  yearly: { rate: number; basis: 'contributions' | 'statements'; since: string; months: number } | null
  gainPct: number; releaseDate: string | null; locked: boolean
}
export type Pilon1View = { asOf: string; stale: boolean; period: { years: number; months: number; days: number }
  points: number; pointsThisYear: number; pointsByYear: { year: number; points: number }[]; vpr: number; pensionEstimate: number }
export type RetirementSummary = {
  base: 'RON'; accounts: AccountView[]; pilon1: Pilon1View | null
  locked: number; available: number; paidInLocked: number; unconverted: string[]   // ints ×100 RON; ids left out
}
export function summarize(input: { accounts; statements; contributions; fx: (ccy: string) => number | null; today: string; vpr: number }): RetirementSummary
export function retirementTasks(s: RetirementSummary): Task[]
export async function loadRetirement(today?: string): Promise<RetirementSummary>   // load.ts: DB + latestFx(ccy, 'RON', today)
```

- [ ] **Step 1: Write the failing tests**

```ts
it('computes the yearly return from every contribution', ...)
  // a 100.00 contribution on 2025-01-01 and value 110.00 on 2026-01-01 → rate ≈ 0.10, basis 'contributions', months 12
it('computes the yearly return from two or more snapshots, since the first', ...)
  // first value 1000.00 on 2025-01-01; paid-in +100.00 by 2025-07-01; value 1210.00 on 2026-01-01 → basis 'statements', since '2025-01-01'
it('gives no yearly return for one snapshot, only the gain percent', ...)
it('moves an account to available on its release date, never both', ...)    // releaseDate === today → available
it('counts an account with no release date as locked', ...)
it('leaves an EUR account out of the totals when there is no FX rate, and names it', ...)
it('marks a statement stale after 90 days, and Pilon 1 after 365 days', ...)
it('estimates the pension as points × VPR', ...)                              // 10 points × 8100 → 81000
it('makes one upload task per stale account', ...)
  // id `retirement:${accountId}:${asOf}`, title `Upload <provider name> statement`, href '/upload'
```

- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3:** Implement. Use the newest statement per account for value, paid in and fees. Use `xirr` with gross contributions as negative flows. **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5: Commit.** Run `/ledger`.

### Task 6: Upload

**Files:**
- Create: `app/api/retirement/upload/route.ts`
- Modify: `app/upload/UploadDropzone.tsx`
- Test: `tests/retirement/upload.test.ts` (calls the route's `POST` with a `Request` built from `FormData`; mocks `pdfLines` to return fixture lines by file name)

**Interfaces:**
- `POST` takes multipart `file` × N.
- It returns `{ results: { file: string; status: 'saved' | 'duplicate' | 'unsupported'; kind?: string; provider?: string; asOf?: string; error?: string }[] }`.
- `fileHash` is the sha256 hex of the bytes, from `node:crypto`.
- A parse that throws gives `status: 'unsupported'` plus `error`.

- [ ] **Step 1: Write the failing tests**:
  - Three PDFs: a BT one, the same BT one again, and a Tradeville one. Expect `saved`, `duplicate`, `unsupported`.
  - A non-PDF file name is skipped and never read.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3:** Implement the route.
- [ ] **Step 4: Change the dropzone.**
  - In `handleParse`, post every `.pdf` to `/api/retirement/upload` first.
  - Files the route saved or skipped as duplicates leave the list. Show their result lines (file, provider, statement date, saved or "already uploaded") with a link to `/invest/retirement`.
  - If files remain, show **Continue with N broker files**, which runs today's broker flow with those files.
  - If none remain, stay on the page.
- [ ] **Step 5: Run the tests.** Expected: PASS. Run `npx tsc --noEmit -p .`. Expected: clean.
- [ ] **Step 6: Commit.** Run `/ledger`.

### Task 7: Today and the net-worth split

**Files:**
- Modify: `src/dashboards/portfolio.ts`. In `loadToday()`, add `summary.available / 100` to both `netWorth` and `netWorthThen`, so the 30-day change does not jump. Return `retirementLocked: summary.locked / 100`. In `loadTasks()`, append `...retirementTasks(await loadRetirement(today))`. Add `loadNetWorthSplit(): Promise<{ base: string; available: number; locked: number; total: number } | null>`. It returns `available: t.netWorth`, `locked: t.retirementLocked` and their sum, from `loadToday()`.
- Modify: `app/page.tsx`. Under the net-worth figure, when `retirementLocked > 0`, add a line "+ <amount> RON locked until retirement" linking to `/invest/retirement`.
- Test: `tests/retirement/compute.test.ts` already pins the tasks. Add no new test for page wiring.

- [ ] **Step 1: Implement.** **Step 2:** Run `npx vitest run` and `npx tsc --noEmit -p .`. Expected: green and clean. Check `/` on the dev server. **Step 3:** Commit with `/ledger`.

### Task 8: Retirement page and Invest

**Files:**
- Create: `app/invest/retirement/page.tsx`, `app/invest/retirement/actions.ts`
- Modify: `app/invest/page.tsx`. Add `{ href: '/invest/retirement', label: 'Retirement' }` to `MENU`, and a `NetWorthSplit` card above `InsightCards` showing available, locked and total.

**Interfaces:**
- Consumes `loadRetirement()` and `loadNetWorthSplit()` (Task 7).
- The actions `saveReleaseDate(form)` (fields `accountId`, `date` as `YYYY-MM-DD` or empty) and `saveVpr(form)` (field `vpr` in RON) are checked with zod. They call `setReleaseDate` and `setVpr`, then `refresh()`.

- [ ] **Step 1: Build the page.** Follow the approved mockup layout: the locked card with its share bar, one card per account, the Pilon 1 card and the Upload button.
  - Each card has a release-date `<input type="date">` and "unlocks in N years".
  - The Pilon 1 card has a VPR field.
  - The yearly return always shows its basis: "since <date>", or "(N months only)" when under 24 months.
  - An account in `unconverted` shows "no exchange rate".
  - With no accounts, show "No statements yet" and an Upload link.
- [ ] **Step 2: Verify.**
  - Run `npx tsc --noEmit -p .` and `npx eslint app/invest src/retirement`. Expected: clean.
  - Run `npm run build` with an empty `WALLET_DATA_DIR`. Expected: success.
  - Upload the real PDFs on the dev server (`bytox8udk` is already running on loopback). Open `/invest/retirement` and compare with the mockup.
- [ ] **Step 3: Commit.** Run `/ledger`.

### Task 9: MCP and Ask

**Files:**
- Modify: `src/mcp/tools.ts`. Add a `retirement` tool. In `net_worth`, add `today: { available, locked, total }`: available is the last series point total + `summary.available`, and locked is `summary.locked`.
- Modify: `src/ask/run.ts:37`. Add "retirement and pensions (Pilon 1/2/3, unit-linked)" to the list of what the `wallet_*` tools cover.
- Test: `tests/mcp/http.test.ts`

**Interfaces:**
- `retirement` input: `z.object({ includeHistory: z.boolean().default(false) })`.
- Output:
  - `currency: 'RON'`, `locked`, `available`, `unconverted`.
  - `accounts[]`: kind, provider, product, `contract` masked to `****` + its last 4 characters, currency, asOf, stale, value, valueRon, paidIn, gain, gainPct, fees, `yearlyReturn: { rate, basis, since } | null`, releaseDate, locked.
  - `pilon1`.
  - With history, each account gains `history: { statements: [{ asOf, value, paidIn, fees }], contributions?: [{ date, gross, fee }] }`.
- All amounts in units via `money()`, never ×100.

- [ ] **Step 1: Write the failing tests.**
  - Seed one BT account (2 contributions, 1 statement) and one EUR policy, with an `fx_history` row.
  - `retirement` returns both accounts, the masked contract and the RON value.
  - `includeHistory` adds the contributions.
  - `net_worth.today.locked` equals the seeded locked total.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3:** Implement. **Step 4:** Run them. Expected: PASS. Run `npx vitest run`. Expected: all green.
- [ ] **Step 5: Commit.** Run `/ledger`.

### Task 10: Ship

- [ ] Run `npx vitest run`, `npx tsc --noEmit -p .` and `npx eslint .`. Run `npm run build` with an empty `WALLET_DATA_DIR`. All must be green.
- [ ] Push. Deploy:
  1. Run `ssh intel`.
  2. Run `git pull` in `~/Personal/investment-wallet-sync`.
  3. Run `docker compose up -d --build wallet-sync` in `~/Incubator/Opensource/garmin-grafana`.
  4. Expect the container to report `healthy`. Migration 0011 runs at boot.
- [ ] The user uploads the five real PDFs from the phone, to the deployed app, not to the repo.
