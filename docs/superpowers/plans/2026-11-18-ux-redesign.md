# UX Redesign and Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every screen on one set of shared components with the approved layout, and add body-ledger's theme families and light/dark mode.

**Architecture:** Theme tokens live in `app/themes.css` as `[data-theme="<id>"]` blocks; `globals.css` maps the shadcn variables to them, so existing components follow. A blocking boot script sets `data-theme` before first paint from a server-rendered preference. Shared UI components in `app/ui/` carry the hero, chart, list-detail and sheet patterns; each page is rebuilt on them, one page per task. New numbers come from small pure functions with tests.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before code), React, Tailwind v4, shadcn (`components/ui`), recharts 3, lucide, drizzle + better-sqlite3, vitest (node env, `tests/**/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-11-18-ux-redesign-design.md`. Mockups: https://claude.ai/artifact/8bwnsEHNap1DL8vL8EvTFk (private canvas, invented numbers). The canvas files are also on disk while this session runs: `/private/tmp/claude-501/-Users-darius-Personal-investment-wallet-sync/0bd2c3b9-caf3-4960-980e-4936aee43329/scratchpad/redesign/project/*.dc.html` — read them for exact layout, copy and spacing.

## Global Constraints

- Every color comes from a theme token. No hex or rgb literal in `app/**/*.tsx` after Task 2 (except `app/icons/` and `app/manifest.ts`).
- Recharts: `isAnimationActive={false}`; colors as `var(--…)` strings.
- Retirement stays a tab inside Invest on desktop and phone.
- Desktop starts at `lg`. Keep the wide-screen zoom rules in `globals.css`.
- Touch targets ≥ 44 px on phone. Text contrast ≥ 4.5:1 in every theme (tested in Task 1).
- Today's big number is usable money only (invested + cash + released retirement). Locked retirement money is a separate line.
- Public repo: tests and fixtures use invented amounts only.
- Commits: run `/ledger` on staged changes. No `Co-Authored-By`, `Claude-Session` or "Generated with" lines.
- Work on branch `ux-redesign`. Do not push or deploy; the controller decides after the final review.
- Each task ends with `npx tsc --noEmit`, `npm test` and `npm run build` green.

## Review Focus

1. Theme preference is `system` and the OS switches light/dark while the app is open → the app follows without reload.
2. A saved theme slug that no longer exists (or garbage in `config`) → app falls back to Default/Auto, no crash, no flash of the wrong theme.
3. A list-detail page with an unknown or stale `?account=` / `?category=` id → desktop shows the first item, phone shows the list; no 404.
4. Empty data: no retirement accounts, no budgets, a period with no spending, a new install with no net worth history → each block shows one sentence that says what to do, never `NaN` or an empty chart frame.
5. A category covered by two budgets, and a budget over several categories → row note only for one-to-one; detail lists every covering budget.

Tests that pin 1–2 go in Task 1, 3 in Task 3, 4 in the page tasks as one empty-state render check each (manual screenshot step), 5 in Task 6.

---

### Task 1: Theme core

**Files:**
- Create: `src/theme/themes.ts`, `app/themes.css`, `public/theme-boot.js`
- Test: `tests/theme/themes.test.ts`

**Interfaces:**
- Produces: `THEMES: readonly {id; label; scheme: 'light'|'dark'; bar: string}[]`, `FAMILIES: readonly {id; label; light; dark}[]`, `MODES`, `TOKENS`, `THEME_KEY = 'wallet-theme'`, `CONFIG_KEY = 'ui.theme'`, `parsePref(pref: string): {family; mode}`, `toPref(family: string, mode: Mode): string`, `resolveTheme(pref: string, osDark: boolean): Theme`, `safePref(pref: string): string`.

Copy the model from `~/Personal/body-ledger/server/web/src/lib/theme.ts`, `public/theme-boot.js` and `src/lib/theme.test.ts`. Differences:
- Default family ids are `wallet-light` / `wallet-dark`.
- `TOKENS = ['bg','surface','surface-2','line','fg','fg-2','muted','good','warn','bad','accent','accent-ink','on-accent']`.
- `app/themes.css`: copy the canvas's theme CSS (any `*.dc.html` there, the block from `[data-theme] {` to `[data-theme] a:hover`), but select on `:root[data-theme="…"]` and drop the two `a` rules and the `background`/`color` lines of the generic block. The generic block keeps the derived tokens (`--chrome`, `--line-2`, `--neutral`, `--accent-soft`, `--fill`, `--fill-2`, `--good-fill`, `--warn-tint`, `--warn-line`).
- The boot script reads the preference from `document.documentElement.dataset.themePref` first (server-rendered, Task 2), then `localStorage[THEME_KEY]`, then `system`.

- [ ] **Step 1: Write the failing tests** in `tests/theme/themes.test.ts`, ported from body-ledger's `theme.test.ts`:
  - `parsePref('gruvbox-dark')` → `{family: gruvbox, mode: 'dark'}`; `parsePref('system-optura')` → `{optura, system}`; `parsePref('nonsense')` and `parsePref('')` → `{default, system}`.
  - `toPref('default','system') === 'system'`; `toPref('catppuccin','light') === 'catppuccin-latte'`.
  - `resolveTheme('system', true).id === 'wallet-dark'`; `resolveTheme('system', false).id === 'wallet-light'`; `resolveTheme('system-rose-pine', false).id === 'rose-pine-dawn'`.
  - every THEMES id has a block in `app/themes.css` that sets `color-scheme` matching `scheme` and every TOKENS name.
  - `public/theme-boot.js` THEMES map and FAMILIES map equal the ones in `themes.ts`, and it uses `'wallet-theme'`.
  - contrast ≥ 4.5 for `fg`, `fg-2`, `muted` on `bg` and on `surface`, and `on-accent` on `accent`, for every theme.
- [ ] **Step 2:** `npx vitest run tests/theme` → FAIL (module not found).
- [ ] **Step 3:** Write the three files.
- [ ] **Step 4:** `npx vitest run tests/theme` → PASS. If a contrast check fails for a body-ledger palette, darken/lighten that one token minimally and note it in the commit body.
- [ ] **Step 5:** Commit via `/ledger` (`feat(theme): add theme families, tokens and boot script`).

### Task 2: Theme wiring and Appearance

**Files:**
- Modify: `app/globals.css`, `app/layout.tsx`, every file from `grep -rln "#[0-9a-fA-F]\{6\}" app` except icons/manifest
- Create: `app/theme/ThemeSync.tsx` (client), `app/theme/actions.ts`, `app/settings/Appearance.tsx`
- Test: `tests/theme/themes.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `saveTheme(pref: string): Promise<void>` server action (writes `safePref(pref)` to `config` key `ui.theme`, then `refresh()`); `readThemePref(): Promise<string>` in `src/theme/store.ts` (returns `safePref` of the stored value or `'system'`); `<Appearance pref={string} />`.

- [ ] **Step 1: Failing test:** `readThemePref()` returns `'system'` when the row is missing and when it holds `'bogus'`; returns `'gruvbox-dark'` after `saveThemePref('gruvbox-dark')` (store-level function the action calls). Use the test DB pattern of `tests/storage/db.test.ts`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement:
  - `globals.css`: import `./themes.css`; set the shadcn variables in `:root` from tokens (`--background: var(--bg)`, `--card: var(--surface)`, `--popover: var(--surface)`, `--primary: var(--accent)`, `--primary-foreground: var(--on-accent)`, `--secondary`/`--accent`: `var(--surface-2)`, `--muted: var(--surface)`, `--muted-foreground: var(--muted)`, `--border: var(--line)`, `--input: var(--line-2)`, `--ring: var(--accent)`, `--destructive: var(--bad)`, chart-1..5 = accent, good, accent-soft, neutral, fg-2). Map `--color-up/down/warn` to `var(--good)/var(--bad)/var(--warn)`. Delete the `.dark` block and the `color-scheme: dark` line; change `@custom-variant dark` to `(&:is([data-scheme="dark"] *))`. Note: shadcn's `--muted` (a surface) and the theme's `--muted` (a text color) collide — rename the theme token in CSS and TS to `--fg-3` if needed; record the choice in the commit body.
  - `layout.tsx`: remove `dark` class and `viewport.themeColor`; render `<html data-theme-pref={pref} data-theme="wallet-dark" suppressHydrationWarning>` where `pref = await readThemePref()`; first child of `<head>`: `<script src="/theme-boot.js" />` (blocking) and `<meta name="theme-color" content="#0f1115">`; mount `<ThemeSync pref={pref} />` (applies `resolveTheme`, sets `data-scheme`, follows `matchMedia` changes, caches to localStorage).
  - Replace hard-coded colors in components with token classes / `var(--…)`.
  - `Appearance.tsx`: Mode segmented (Auto, Light, Dark) and 6 theme cards with light/dark swatch halves, as on the canvas Settings board; a click calls `saveTheme` and applies at once (optimistic `data-theme`).
  - Mount `<Appearance>` at the top of the current Settings page (Task 9 moves it into a section).
- [ ] **Step 4:** Tests PASS; `grep -rn "#[0-9a-fA-F]\{6\}" app --include=*.tsx | grep -v app/icons` → no output.
- [ ] **Step 5:** Screenshot `/` and `/settings` in `wallet-dark`, `wallet-light`, `gruvbox-light`: no unreadable text, no flash on reload.
- [ ] **Step 6:** Commit via `/ledger`.

### Task 3: Shared components and app shell

**Files:**
- Create: `app/ui/PageHeader.tsx`, `app/ui/Hero.tsx`, `app/ui/TimeChart.tsx`, `app/ui/Bars.tsx`, `app/ui/ListDetail.tsx`, `app/ui/EditSheet.tsx`, `app/ui/Banner.tsx`, `app/ui/Segmented.tsx`, `app/ui/select.ts`
- Modify: `app/components/AppHeader.tsx`, `app/layout.tsx`
- Test: `tests/ui/select.test.ts`

**Interfaces:**
- Produces:
  - `pickSelected<T extends {id: string}>(items: T[], param: string | undefined): {selected: T | null; fromParam: boolean}` in `app/ui/select.ts` — unknown/missing param → first item, `fromParam: false`.
  - `<PageHeader title tabs?={{id,label,href}[]} active? right?: ReactNode />` (underline tabs).
  - `<Hero label value unit sub? subTone?: 'good'|'bad'|'muted' stats: {label, value, tone?}[] chart?: ReactNode below?: ReactNode />` — desktop 2 columns (`lg:grid-cols-[300px_1fr]`), phone stacked.
  - `<TimeChart points: {date: string; value: number|null; projected?: number|null; paidIn?: number|null}[] today?: string ranges?: {id,label,href}[] activeRange? height? />` — value solid + `--fill` area, projected dashed + `--fill-2`, paidIn grey dashed, Today reference line, year or month ticks, short y ticks (600k, 1.2M).
  - `<Bars data: {label: string; value: number; back?: number; over?: boolean; highlight?: boolean}[] limit?: number height? />` — `back` drawn wider behind; `over` uses `--warn`; `highlight` uses `--accent`, others `--neutral` unless `back` set (then value is accent).
  - `<ListDetail list: ReactNode detail: ReactNode | null backHref: string backLabel: string />` — desktop side by side (`lg:grid-cols-[400px_1fr]`); phone: `detail` when a param is present else `list`.
  - `<EditSheet title trigger: ReactNode>{form}</EditSheet>` — shadcn Dialog; below `lg` it renders as a bottom sheet (fixed bottom, rounded top, drag handle).
  - `<Banner tone='warn' action={{label, href}}>text</Banner>`, `<Segmented options value hrefFor />` (links, not state).
- [ ] **Step 1: Failing test:** `pickSelected(items, 'b')` → `{selected: b, fromParam: true}`; `pickSelected(items, 'zz')` and `undefined` → `{selected: items[0], fromParam: false}`; `pickSelected([], 'a')` → `{selected: null, fromParam: false}`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `select.ts` and the components.
- [ ] **Step 4:** Shell: desktop sidebar per canvas (Wallet, Today, Invest, Spending, Ask, spacer, Upload statement primary button → `/upload`, Settings, "Synced <age>" button that opens a popover listing `today.age` sources with dates, stale ones in warn). Phone: bottom bar as now with tokens; page title in each page, not in the shell.
- [ ] **Step 5:** Tests, tsc, build green. Commit via `/ledger`.

### Task 4: Retirement tab

**Files:**
- Modify: `app/invest/Retirement.tsx` (rewrite), `app/invest/RetirementChart.tsx` (replace with `TimeChart`), `app/invest/ProjectionBars.tsx` (tokens), `app/invest/retirement/actions.ts`
- Modify: `src/retirement/chart.ts`
- Test: `tests/retirement/chart.test.ts`

**Interfaces:**
- Consumes: Task 3 components, `pickSelected`.
- Produces: `inTodaysMoney(value: number, fromIso: string, toIso: string, inflation = 0.03): number` in `src/retirement/chart.ts`.

- [ ] **Step 1: Failing test:** `inTodaysMoney(1_000_000, '2026-01-01', '2051-01-01')` ≈ `477_606` (within 50; years are days / 365.25); same dates → unchanged; `toIso` before `fromIso` → unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement.
- [ ] **Step 4:** Rebuild per canvas `Retirement.dc.html`, `PhoneRetirement`, `PhoneAccount`, `PhoneEdit`:
  - Header right: "Projection: N% a year, current contributions" + Edit (EditSheet with the return field → `saveReturn`).
  - Hero: "At unlock, <Month YYYY>" with projected total, "≈ X in today's money" (`inTodaysMoney`, label says 3% inflation in a tooltip/hint), stats today value / paid in / gain / Pilon 1 monthly. Chart: TimeChart from `projection.timeline.points`; Segmented Line / Every 5 years / Every 10 years via `?view=line|5|10` (5/10 render `ProjectionBars`).
  - ListDetail with `?account=<id>`. Rows and detail exactly as the spec's Retirement section. Account EditSheet: unlock date, paid in a year (hint shows default; empty keeps it), return (hint "used for all accounts"), live "At unlock ≈" computed client-side with the same formula as `accountTimeline`'s projection (pass the account's value, paidIn and asOf to the client component).
  - Pilon 1 detail: points by year + its form inside an EditSheet.
  - Empty: no accounts → one sentence with a link to `/upload`.
- [ ] **Step 5:** Tests/tsc/build. Screenshots desktop + phone, dark and light. Commit via `/ledger`.

### Task 5: Spending compute

**Files:**
- Modify: `src/dashboards/compute/spending.ts`, `src/spending/load.ts`
- Test: `tests/dashboards/compute/spending.test.ts`

**Interfaces:**
- Produces:
  - `keptShare(income: number, expense: number): number | null` — `(income − expense) / income`, null when income ≤ 0.
  - `budgetsByCategory(budgets: BudgetStatus[], categoryKeys: string[]): Map<string, {rowNote: BudgetStatus | null; covering: BudgetStatus[]}>` — `rowNote` only when exactly one budget covers the category and that budget covers exactly that one category.
  - `overBudgetMonths(monthly: {yearMonth: string; amount: number}[], limit: number): {over: string[]; underCount: number}`.
  - `loadSpending()` also returns, per category key: monthly amounts for the selected period, records of the latest month, matching rules, proposals whose category is that key.
- [ ] **Step 1: Failing tests:** `keptShare(14700, 10060)` ≈ 0.3156; `keptShare(0, 5)` null. `budgetsByCategory`: one budget over `[a]` → `a.rowNote` set; one budget over `[a,b]` → both `rowNote` null, both `covering` length 1; two budgets over `[a]` → `rowNote` null, `covering` length 2. `overBudgetMonths([{'2026-01',900},{'2026-02',1300}], 1200)` → `{over: ['2026-02'], underCount: 1}`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (read how `BudgetStatus` holds its category scope in `budgets.ts`; envelope-group budgets expand to their categories).
- [ ] **Step 4:** PASS. Commit via `/ledger`.

### Task 6: Spending page

**Files:**
- Modify: `app/spending/page.tsx` (rewrite), `app/spending/charts.tsx`, `app/spending/ui.tsx`
- Create: `app/spending/ReviewSheet.tsx`

**Interfaces:**
- Consumes: Task 3 components, Task 5 functions, existing actions in `app/spending/actions.ts` (unchanged).

- [ ] **Step 1:** Rebuild per canvas `Spending.dc.html` and `PhoneSpending`:
  - Header + Segmented period (`?months=1|6|12|24`, labels This month / 6 months / 12 months / 2 years).
  - Alerts as Banners. Uncategorized Banner ("N records have no category. M new rules can sort K of them.") → `ReviewSheet` (`?review=rules|records|transfers`) holding today's proposals UI, To-review queue and Likely transfers, unchanged in behaviour.
  - Hero: spent a month, "You kept N% of your income" (`keptShare`), stats, weekly note as one line under the sub line, Bars with income `back` and spent `value`.
  - ListDetail `?category=<key>`, Spent/Income switch `?mode=income`. Rows: name, total, share bar, a month, row budget note. Detail: total + share, covering budgets each with "under in N of M months" and its limit line, Bars with `limit` and `over`, AI budget-limit proposal ("Suggested limit N" + Apply / Not this, existing actions), proposals for this category inline (Add rule / Not this), latest month records with "All N records" link, rule chips, "Manage rules" → `?review=rules`. Budgets section removed.
  - Empty period → one sentence.
- [ ] **Step 2:** tsc/build/test; screenshots desktop + phone, a category with a budget, one without; Review sheet open. Commit via `/ledger`.

### Task 7: Today

**Files:**
- Modify: `app/page.tsx` (rewrite), `src/dashboards/portfolio.ts`, `src/dashboards/compute/networth.ts` (export `monthEndSamples`), `src/dashboards/tasks.ts` or wherever `loadTasks` builds tasks
- Test: `tests/dashboards/compute/today.test.ts`

**Interfaces:**
- Produces: `netWorthAt(s, base, asOf, maturities, released): Promise<{invested; cash; total}>` (private helper used by both `loadToday` numbers and `loadNetWorthSeries`); `loadNetWorthSeries(months: number | 'all'): Promise<{date: string; total: number}[]>` (month-end samples from `monthEndSamples`, last point = today); `nextUnlock(accounts: {name; releaseDate: string|null; locked: boolean}[], projected: Map<id, {date; value}>, today: string)` in `src/dashboards/compute/today.ts`.

- [ ] **Step 1: Failing tests:** `monthEndSamples('2026-01-15', new Date('2026-03-10'))` → `['2026-01-31','2026-02-28','2026-03-10']`. `nextUnlock` returns the earliest future release date with its projected value; none in future → null.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. `loadToday` uses `netWorthAt` for today and 30 days ago, so the chart's last point and the hero match by construction.
- [ ] **Step 4:** Rebuild per canvas `Main.dc.html` and `PhoneToday`: Hero (usable net worth, 30-day change, split bar Invested/Cash, "+ N locked in retirement" link to `/invest?tab=retirement`, TimeChart with `?range=6m|1y|3y|all`); Needs you (tasks, now also idle-cash, plan-gap, spending alerts, stale sources — move those card checks into `loadTasks`); Coming up (maturities + `nextUnlock`); Plans compact list under it. Remove data-age footer (it lives in the sidebar popover now; on phone, put it at the bottom of Settings).
- [ ] **Step 5:** tsc/build/test; screenshots. Commit via `/ledger`.

### Task 8: Invest — Positions, Performance, Plans

**Files:**
- Modify: `app/invest/page.tsx`, `app/invest/PerformanceChart.tsx`

- [ ] **Step 1:** Rebuild per canvas `Invest.dc.html`: PageHeader with 4 tabs; account chips (`?account=<broker>`, filter rows client-free in the server component); Hero with value, gain, stats (only those already computed), value vs paid-in TimeChart with `?range=`; positions table (desktop) / rows (phone) with share bar; cash row; "Deposits and bonds" section with link to `/invest/maturities`. Remove the Available/Locked/Net worth card and idle-cash / plan-gap cards (now tasks, Task 7).
- [ ] **Step 2:** Performance and Plans tabs on PageHeader + Hero + their existing content restyled with tokens and shared components.
- [ ] **Step 3:** tsc/build/test; screenshots. Commit via `/ledger`.

### Task 9: Settings sections and Ask

**Files:**
- Modify: `app/settings/page.tsx`, `app/settings/SettingsView.tsx`, `app/ask/page.tsx`

- [ ] **Step 1:** Settings: ListDetail with `?section=appearance|general|connection|accounts|records|notifications|backup` plus link rows to `/aliases` and `/history`. Existing sections move unchanged into: General (base currency, sync interval, backfill), Connection, Broker accounts (mappings), Records (fallbacks, manual links), Notifications, Backup. Appearance first. Phone: list, then the section with a back link; data-age list at the bottom of the list.
- [ ] **Step 2:** Ask: desktop chat list column (300 px) next to the open chat (`max-w-[760px]` centred), composer at the bottom; phone unchanged apart from tokens.
- [ ] **Step 3:** tsc/build/test; screenshots. Commit via `/ledger`.

### Task 10: Whole-app check

- [ ] **Step 1:** `grep -rn "#[0-9a-fA-F]\{6\}" app --include=*.tsx | grep -v app/icons` → empty.
- [ ] **Step 2:** Screenshot every page at 390 px and 1440 px in `wallet-dark`, `wallet-light`, `catppuccin-latte`, `gruvbox-dark`. Fix any unreadable text or broken layout.
- [ ] **Step 3:** `npm test`, `npx tsc --noEmit`, `npm run build` green. Commit fixes via `/ledger`.
