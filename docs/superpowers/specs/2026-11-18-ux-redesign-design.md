# UX redesign and themes — design

Date: 2026-11-18. Status: mockups approved in conversation; written for the plan.

Mockups: https://claude.ai/artifact/8bwnsEHNap1DL8vL8EvTFk (private canvas; numbers in it are invented).
It has 6 desktop screens (Today, Invest, Retirement, Spending, Ask, Settings) and 5 phone screens
(Today, Retirement, one retirement account, the projection edit sheet, Spending).

## Why

The UI grew one patch at a time. Each page has its own card, chart and stat style, charts sit apart
from the numbers they explain, and inline forms for assumptions fill the screen. On desktop the pages
are phone layouts stretched wide. The user rejected several piecemeal fixes and asked for one design
for the whole app. They also want the theme choice that body-ledger and desk already have.

## Goals

- Every screen answers its main question in the first view: one big number, then the one chart that
  explains it.
- One set of components for page header, hero, stats, charts, lists and edit sheets, used everywhere.
- Desktop uses its width: a list next to the selected item's details.
- Phone shows the same content stacked; a list row opens a detail screen with a back link.
- Assumptions (return, yearly contribution, unlock date) are one sentence plus an Edit button, never
  an open form.
- Theme families and light/dark mode, same palettes and same model as body-ledger.

## Non-goals

- No change to sync, parsers, Wallet writes, MCP tools or stored data, except the theme preference.
- No new features beyond what the mockups show (listed under "New behaviour" below).
- No suggested follow-up questions in Ask.
- No per-account return assumption; one return applies to all retirement accounts, as today.

## Anti-goals

- A screen that opens on a form, a table of settings, or a wall of equal cards.
- A chart without date labels, or a chart away from the number it explains.
- A hard-coded color in a component. Every color comes from a theme token.
- A desktop page that is the phone layout centred in a wide column.

## Constraints

- Next.js 16 (read `node_modules/next/dist/docs/` before code), Tailwind v4, shadcn, recharts 3 with
  `isAnimationActive={false}`, lucide icons, Inter.
- Retirement stays a tab inside Invest, on desktop and on phone. The user asked for that.
- Desktop starts at the `lg` breakpoint. Keep the wide-screen zoom in `globals.css`.
- The repo is public: no real amounts in tests, fixtures or docs.
- Touch targets at least 44 px on phone. Text contrast at least 4.5:1 in every theme.

## Navigation

- Desktop: left sidebar (Today, Invest, Spending, Ask; then Upload statement as the primary button,
  Settings, and "Synced <age>"). Same items as now; the Upload button is new in the sidebar.
- Phone: bottom bar (Today, Invest, Spending, Ask). Header shows the page title; Today's header has an
  upload icon.
- Invest has 4 tabs under its title: Positions, Performance, Plans, Retirement. Underline tabs on both
  sizes.

## Shared components

| Component | What it is |
|---|---|
| Page header | Title, then tabs or a period switch on the right. |
| Hero | Label, big number with currency, one coloured sub line (gain, kept share), a stats list (`dl`), and a chart slot on the right (desktop) or below (phone). |
| Time chart | Value as a solid line with a light area, projection as the same line dashed, paid in as a grey dashed line, a "Today" marker, real date ticks, y-axis ticks in short form (600k, 1.2M). Optional range buttons (1Y, 3Y, All). |
| Bar chart | Monthly or yearly bars. Variants: income behind spent (two widths, one chart); a budget line with over-budget bars in the warn color; the latest bar in the accent color. |
| List and detail | Desktop: list on the left (about 380–440 px), detail card on the right. Selection is a URL search param. Phone: without the param the list shows; with it, only the detail shows, with a back link. One route. |
| Edit sheet | Desktop: dialog. Phone: bottom sheet. Fields with labels and hints, a live result line, Cancel and Save. |
| Banner | Warn-tinted row: dot, one sentence, one action link. |
| Segmented control | Period, mode and chart-view switches. |

## Screens

### Today
- Hero: net worth of usable money only (invested plus cash; locked retirement money is not in it,
  the user's decision), change in the last 30 days, a split bar with legend (Invested, Cash), and a
  line "+ N locked in retirement" that links to the Retirement tab. A 12-month net worth chart with
  6M / 1Y / 3Y / All. The series comes from `computeNetWorth`
  (`src/dashboards/compute/networth.ts`). Its last point must equal the hero number: make
  `computeNetWorth` value holdings the same way as the hero (maturities and fallback trades included),
  with a test that pins both to one value. The 30-day change uses the same series.
- Below, two columns on desktop: "Needs you" (current tasks, one action button each) and "Coming up"
  (maturities and coupons, plus the next retirement unlock with its projected value).

### Invest: Positions
- Account filter chips (All accounts, then each broker) in the header row.
- Hero: portfolio value, gain, stats (paid in, return a year, fees this year, cash at brokers), and a
  value against paid-in chart, 1Y / 3Y / All. Leave out a stat the app does not compute yet.
- Positions table: holding (ticker and name), account, value, gain, return, share-of-portfolio bar;
  cash at brokers as the last row. Phone: rows with name, value and gain; account under the name.
- Performance and Plans tabs: same header and hero pattern with their existing content. No mockup;
  the builder applies the shared components.

### Invest: Retirement
- Header right side: "Projection: <rate>% a year, current contributions" and Edit (opens the edit
  sheet for the return, which applies to all accounts).
- Hero: projected total at the latest unlock date, the same value in today's money, today's value,
  paid in, gain, and the Pilon 1 monthly estimate. Chart: total history and projection to unlock,
  with a switch Line / Every 5 years / Every 10 years (the last two are the existing `ProjectionBars`).
- List and detail. List rows: name, provider and unlock year, value, return a year; Pilon 1 shows
  points and the monthly estimate.
- Detail (money account): name, provider, last statement date; projected value at unlock top right;
  4 stats (value, paid in, gain, return a year); account chart (history and projection); "Paid in
  each year" bars with "Show all N payments"; a sentence with the projection inputs and Edit; a link
  to the statements list.
- Edit sheet for an account: unlock date, paid in a year (hint: the last-12-months default; empty
  keeps the default), return a year (hint: used for all accounts), live "At unlock ≈" result.
- Pilon 1 detail keeps its points-by-year view and its form, moved into the edit sheet.

### Spending
- Header: period switch (This month, 6 months, 12 months, 2 years), as `?months=` now.
- Banner when records have no category: count, how many the proposed rules would sort, "Review
  rules". The review list is the existing proposals UI (editable category, approve, reject that
  sticks), opened as a sheet.
- Hero: spent a month on average, "You kept N% of your income", stats (income a month, kept a
  month, spent in the period). Chart: income bars behind spent bars per month.
- List and detail. List ("Where it goes", Spent / Income switch): category, period total, share bar,
  amount a month, and a budget note ("on budget", "N% over budget" in warn).
- Detail: category name, period total and share; budget line and "under in N of M months"; monthly
  bars with the budget line, over-budget months in warn; proposed rules for this category inline
  ("Add rule" / "Not this"); the latest month's records with "All N records"; the rules that sort
  into this category as chips, and "Manage rules" (the existing list with delete).
- The separate Budgets section goes away; budget status lives in the category list and detail.

### Ask
- Desktop: chat list on the left (title, date, New chat), the open chat on the right in a column of
  about 760 px, composer at the bottom. Phone: as now.
- Answers keep their current rendering (text, tables, charts) in the shared component styles.

### Settings
- Desktop: a left list of sections (Appearance, Wallet connection, Broker accounts, Aliases, Import
  history, Backup); the existing content moves into these sections. Phone: the same sections as a list.
- Appearance: Mode (Auto, Light, Dark) and Theme (6 cards, each a light/dark swatch). A choice
  applies at once and saves. Auto follows the OS and its changes.

## Themes

Copy body-ledger's model (`~/Personal/body-ledger/server/web/src/lib/theme.ts`,
`public/theme-boot.js`, `useTheme.ts`, `theme.test.ts`):

- Families: Default (Wallet's own), Catppuccin, Rosé Pine, Gruvbox, Cyberdream, Optura. Each has a
  light and a dark theme. Palettes for all but Default come from body-ledger's `styles.css`.
- Default dark is today's palette. Default light is new: bg `#f2f4f7`, surface `#ffffff`,
  surface-2 `#e8edf5`, line `#e1e5eb`, fg `#15181e`, fg-2 `#353b46`, muted `#5b626e`, good
  `#0b7a54`, warn `#8a6400`, bad `#c8364b`, accent `#2f62d6`, accent-ink `#1f4aa8`, on-accent white.
- Tokens: bg, surface, surface-2, line, fg, fg-2, muted, good, warn, bad, accent, accent-ink,
  on-accent. Derived per theme with `color-mix`: chrome (sidebar and bottom bar), line-2, neutral
  (grey bars), accent-soft, chart fills. The mockup canvas has the full CSS.
- `globals.css` maps the shadcn variables (`--background`, `--card`, `--primary` and the rest) and
  the existing `up` / `down` / `warn` colors to these tokens, so current components follow the theme.
- The preference is one slug, as in body-ledger: a theme id, `system`, or `system-<family>`. It is
  saved in the `config` table (server, so every device gets it) and cached in `localStorage`.
- A blocking boot script in `<head>` sets `data-theme` on `<html>` and the `theme-color` meta before
  first paint. `viewport.themeColor` stops being one fixed color.
- A test checks that every theme sets every token, that the boot script lists the same themes and
  families, and the text contrast (fg, fg-2, muted on bg and surface; on-accent on accent) is at
  least 4.5:1.
- Charts take colors from tokens. Recharts props get `var(--…)` values or `currentColor`; check the
  result in Safari.

## New behaviour

These are in the mockups and do not exist yet:

1. Net worth chart on Today.
2. "In today's money" on Retirement, at a fixed 3% inflation a year (the label says so).
3. Next retirement unlock in Today's "Coming up".
4. Account filter on Positions.
5. Spending: kept share of income, per-category budget note, over-budget months, proposals shown
   inside their category.
6. Theme families and modes.

## Order of work

1. Theme tokens, boot script, preference, Settings › Appearance.
2. App shell (sidebar, bottom bar) and the shared components.
3. Retirement, then Spending, Today, Invest (Positions, Performance, Plans), Ask, the rest of Settings.

Each step ships on its own and leaves the app working.

## Existing features without a mockup (my calls)

Nothing is dropped. Each current feature gets one place:

| Feature | Place |
|---|---|
| Spending alerts (outflow, spikes) | Banners on Spending; each also a "Needs you" task on Today. |
| Spending "To review" records and Likely transfers | The review sheet that the Spending banner opens, with Rules, Records and Transfers as tabs. |
| Spending weekly note | One line under the Spending hero sub line. |
| AI budget-limit proposals | In the category detail, next to the budget line: "Suggested limit N" with Apply. |
| Invest Available / Locked / Net worth card | Removed from Invest; Today's hero shows it. |
| Invest idle-cash and plan-gap cards | "Needs you" tasks on Today. |
| Deposits and bonds (`/invest/maturities`) | A section under the Positions table with a link to the page. |
| Today investment plans list | Today right column, under "Coming up", compact rows as now. |
| Today data-age footer | The sidebar "Synced" line opens a list of sources with dates; a stale source is a "Needs you" task. |
| Settings: base currency, sync interval | Settings › General. |
| Settings: record fallbacks, manual links | Settings › Records. |
| Settings: notifications | Settings › Notifications. |
| Import history, Aliases | Settings list entries that link to the existing `/history` and `/aliases` routes. |

## Budgets on the category list (my call)

The list rows are categories. A budget whose scope is exactly one category shows its note on that
row. The category detail shows every budget that covers the category, each with its own status and
limit line. A budget over several categories shows no row note.

## Out of scope

Upload, Preview, Result and Setup get the theme tokens (through the shadcn variables) only. Moving
them to the shared components is a later change.

## Left to the builder

- Component file layout and names.
- Exact spacing and type sizes, within the mockups.
- How Performance and Plans fit the shared components.
- Empty states: one sentence that says what to do (for example "Upload a statement to see this").
