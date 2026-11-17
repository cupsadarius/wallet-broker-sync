# Retirement tracking — design

Date: 2026-11-17. Status: approved in conversation; written for the plan.

## Why

The user has five retirement accounts and no single place that shows them. They want to see, per
account and in total, how much has built up, how much went in, and what it has earned. The money is
locked for about 20 years, so it counts toward net worth but must stay apart from money they can use.

The app tracks the policies as they are; it does not advise on keeping or closing them.

## The accounts and their exports

All five come as PDF exports that the user downloads by hand. Samples were read on 2026-11-17.

| Account | Provider | Export | What it holds |
|---|---|---|---|
| Pilon 2 | BT Pensia Noastră (SAFPAP) | "Extras de cont Pensia Noastra" | Every contribution since the account opened: date, gross, fee, net, unit price (VUAN), units, running balance. Footer: unit price, total units, total gross contributions, account value, all "la data" a stated day. |
| Pilon 3 | BT Pensii (SAFPF), "Pensia Mea" | "Extras de cont Pensia Mea" | Same layout as Pilon 2. |
| Unit-linked | Allianz-Țiriac, "Dinamic Invest" (RON) | "Scrisoare de Raport Cont" + annex | Snapshot only: units and sell price per fund program, total value at a date, "Total sume destinate investirii" (paid in), contractual premium, fees deducted to date (insurance, allocation, initial-cost recovery). |
| Unit-linked | Signal Iduna, "101 Invest" (EUR) | "Valoarea contului" | Snapshot only: units and EUR value per fund for base premium and top-up, total value at a date, "Total prime încasate" (paid in), list of policy costs. |
| Pilon 1 | CNPP (state) | "RAPORT … stagiului de cotizare si punctajului", from the CNPP online account | Monthly contribution base since April 2001, yearly points ("Desfășurător anual"), and a summary: contribution period (years, months, days) and total points ("Centralizator"), with the date it was calculated. |

Key facts from the samples:

- BT statements hold the full history, so the newest one replaces all older ones.
- Allianz and Signal statements are one point in time. Each older statement adds a point.
- Each CNPP report holds everything since 2001, so the newest one replaces older ones.
- The exports contain personal data: national ID number (CNP), address, phone, email. None of it is
  stored or shown. The only thing taken from the CNP is the birth date, for the default release date.

## What the user sees

The layout follows the approved mockup (`.superpowers/brainstorm/*/content/retirement.html`). It is a
phone-first Retirement page, reached from Invest.

1. **Locked total**: the sum of every account still locked, in the base currency (RON), with paid in,
   gain, and a bar showing each account's share.
2. **One card per money account** (Pilon 2, Pilon 3, Allianz, Signal):
   - value in the account currency, plus the RON value for EUR accounts;
   - paid in, gain, and fees or costs when the export lists them;
   - yearly return when it can be computed, otherwise total gain in percent;
   - statement date, marked old when stale;
   - release date and "unlocks in N years".
3. **Pilon 1 card**: contribution period, total points, points this year so far, and a rough pension
   in today's money (total points × the yearly reference value). It carries a note that it is rough.
   Pilon 1 is not money and never counts in net worth.
4. **Upload statement** button, which leads to the existing Upload page.

### Release dates

- Every money account has a release date that the user can edit on its card.
- Pilon 2 and Pilon 3 default to the user's 65th birthday, from the birth date in the CNP on the first
  BT or CNPP statement uploaded.
- Allianz and Signal start blank. The user enters the policy end date or the date when surrender
  stops costing a fee.
- On and after its release date, an account counts as available, not locked.
- An account with no release date counts as locked.

### Yearly return

- **BT accounts**: money-weighted yearly return (XIRR). The flows are every gross contribution on its
  date, against the account value on the statement date. Show "(N months only)" when the history is
  under 2 years. Checked by hand against the real samples.
- **Allianz and Signal with two or more statements**: XIRR over the stored statements. Use the first
  statement's value as money in on its date, and each rise in paid-in between statements as money in
  on the later statement's date. Use the newest value as money out. Label it "since <first statement
  date>".
- **One statement only**: show total gain in percent.

### Net worth

- Invest and the `net_worth` MCP tool show three numbers for today:
  - **Available**: cash and brokers, as today, plus released retirement accounts.
  - **Locked**: retirement accounts before their release date.
  - **Total**: the sum of both.
- EUR values convert at the FX rate the app already uses for that day.
- On Invest, the three numbers go in a header card above the existing tabs. *(Builder's call.)*
- **Today** (user's decision): the big "Net worth" figure stays available money (cash + brokers +
  released accounts). A small line under it reads "+ <locked> RON locked until retirement" and links to
  the Retirement page. The 30-day change measures available money only. The "Invested" card stays
  brokers only.
- The monthly net-worth history stays as it is: it does not add retirement values. That is the
  builder's call to revisit if the history looks wrong without them.

### Today

- When the newest statement of a money account is older than 90 days, show a task
  "Upload <provider> statement", linked to Upload, the same way the broker upload tasks work.
- The same task fires for Pilon 1 when its report is older than 365 days.

### Upload

- The existing Upload page accepts these PDFs next to broker files. It detects the provider from the
  text, so the user does not choose one.
- Several files can go in one drop.
- A file already uploaded is skipped by content hash.
- A second statement with the same account and date is also skipped.
- The upload result names each file, what it was recognized as, and its statement date. An
  unrecognized PDF gets a plain "not a supported statement" line.
- Retirement PDFs save as soon as they are dropped, with no preview step. Nothing goes to Wallet, and
  each upload is deduplicated. In a mixed drop, the PDFs save at once; broker files go through the
  usual preview and confirm. *(Builder's call, settled in review.)*
- An account is created on its first statement. The key is provider + contract or policy number;
  for CNPP the key is just the provider.

## MCP

- Add a `retirement` tool to `src/mcp/tools.ts`. It returns, per account:
  - kind, provider, product, currency, statement date;
  - value (account currency and RON), paid in, gain, fees when known;
  - yearly return and its basis ("all contributions" / "since <date>" / none);
  - release date and locked or available.
- It also returns the locked and available totals, and the Pilon 1 summary: period, points, points by
  year, and the rough pension with its reference value.
- An `includeHistory` flag adds the stored statement points per account and the BT contributions.
- Mask policy and contract numbers to their last 4 characters, as the tools do for IBANs.
- Extend `net_worth` with the available, locked and total numbers for today.
- Add one line about retirement accounts to the Ask instructions (`src/ask/catalog.ts` or wherever
  tool hints live), so Ask uses the `retirement` tool for pension questions.

## Constraints

- Stack: Next.js 16 (read `node_modules/next/dist/docs/` first, per AGENTS.md), drizzle + SQLite
  migrations, vitest, zod at the edges.
- Read PDFs with the installed `pdfjs-dist`, as `src/parsers/tradeville-pdf.ts` does. Add no new
  dependency.
- Store money as integers × 100, as the rest of the app does.
- Write tests first for each parser. The repo is public: fixtures are synthetic text in the real
  layout, with invented names, IDs, contract numbers and amounts. No value from a real statement goes
  into the repo.
- Retirement data stays local to this app. Nothing is written to Wallet/CouchDB.
- The tailnet is the trust boundary. Add no extra access checks beyond the existing guard.

## The rough Pilon 1 pension

- Rough pension = total points × the yearly reference value (VPR).
- Store the VPR as a config value: `retirement.vpr`, default 81 RON for 2026. The user edits it on the
  Pilon 1 card, next to the figure it changes.
- The card says the figure is rough and depends on the VPR.

## Non-goals

- No projection of future values or of the pension at retirement age.
- No advice about keeping or closing the policies.
- No automatic download from provider sites.
- No Wallet accounts for these.
- No surrender-fee schedule. The user enters the release date by hand.

## Anti-goals

- Retirement money mixed into available money: the user must never read locked money as spendable.
- Personal data from the exports (CNP, address, phone, email) stored, logged or shown anywhere.
- A yearly return shown without its basis, when it covers only part of the account's life.

## Left to the builder

- Table shapes and names.
- Where the parsers live, alongside `src/parsers` or in their own folder.
- How the upload route splits retirement PDFs from broker files.
- Exact card styling within the existing design system.
