# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the app as an always-on Docker service in the body-ledger stack on the Mac Pro, reachable from the phone as an installable PWA over Tailscale, with env-based secrets, a 60 s Wallet mirror, a Tailscale login check and web push.

**Architecture:** Secrets move from the macOS Keychain to env vars (Keychain stays as the fallback for local dev). A Next.js `proxy.ts` enforces the same Host/login rules as body-ledger's `security.py`. The existing `instrumentation.ts` loop keeps the mirror fresh. Push uses `web-push` with a VAPID pair generated on first use and kept in the SQLite `config` table. The image is a Next.js standalone build; a compose fragment in this repo joins body-ledger's `COMPOSE_FILE` list.

**Tech Stack:** Next.js 16.2.4 (App Router, `proxy.ts`), React 19.2, better-sqlite3 + drizzle, zod 4, vitest, `web-push` (new), Docker Compose, `tailscale serve`.

**Spec:** `docs/superpowers/specs/2026-11-17-wallet-sync-pwa-design.md` (Phase 1 section + "Calls made by the designer").

**Precondition:** the uncommitted dashboard work (`app/dashboard/`, `app/api/dashboard/`, `src/dashboards/`, `instrumentation.ts`, migration `0005`, schema/package changes) is committed first. Ask the user before you commit it; this plan builds on `src/dashboards/mirror.ts` and `instrumentation.ts`.

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code. Middleware is now `proxy.ts` (`export function proxy(request)`, Node.js runtime by default, no `runtime` option).
- Secrets (`WALLET_COUCH_TOKEN`, VAPID private key, push endpoint) never appear in logs, API responses, the image, or the repo.
- Writes to Wallet stay idempotent (deterministic `_id`s); this phase adds no new Wallet writes.
- Tailnet only: ports bind to `127.0.0.1`; `tailscale serve` is the only way in from other devices.
- Same access semantics as body-ledger `server/src/health/web/security.py`: Host (port stripped, lower-case) ∈ {`localhost`, `127.0.0.1`} ∪ `WALLET_ALLOWED_HOSTS` else 421; every path except `/api/health` needs `Tailscale-User-Login` ∈ `WALLET_ALLOWED_USERS` else 403.
- Production (`NODE_ENV=production`) refuses to start without `WALLET_ALLOWED_USERS`.
- Commit each task with `/ledger` (conventional commit, STE, no Co-Authored-By / session footers).

## Deviations from the spec

- **VAPID keys:** the spec says "from env". This plan generates the pair on first use and stores it in the SQLite `config` table (body-ledger keeps its pair in a data-dir file the same way). One less secret to manage; the data volume already holds the Couch cache.
- **Data age per source:** moved to Phase 2. Only the Today screen reads it; building it now leaves an unused function.

## Review Focus

1. **Mirror misses old docs of newly cached types.** The cache resumes `_changes` from a stored `last_seq`, so RecordRule/label docs created before the upgrade are never fetched. Expect: a change in the cached type list resets the scope to `since=0`. Test in Task 3.
2. **Upload breaks behind the guard.** The upload sends `multipart/form-data`; body-ledger's rule allows only JSON writes. Expect: multipart POST with a same-origin `Origin` passes. Test in Task 4.
3. **Half-configured env.** Three of four `WALLET_COUCH_*` vars set. Expect: a startup error that names the missing vars, not a silent fallback to the Keychain. Test in Task 1.
4. **Expired push subscription.** The push service answers 404/410. Expect: the subscription is deleted, `sendPush` returns `'gone'`, nothing throws. Test in Task 5.
5. **Host header variants.** `Mac-Pro.tailnet.ts.net:443`, upper case, `[::1]:8090`. Expect: port stripped and case folded before the allow-list check; missing login header → 403 even on an allowed host. Test in Task 4.

---

### Task 1: Env-managed Couch connection

**Files:**
- Modify: `src/storage/credentials.ts`
- Modify: `app/api/config/route.ts` (GET adds `managedByEnv`; PUT/DELETE → 409 when managed)
- Modify: `app/setup/page.tsx`, `app/settings/SettingsView.tsx` (show read-only "Managed by environment" instead of the connect form / reset button when `managedByEnv`)
- Modify: `instrumentation.ts` (call `applyEnvConnection()` before the mirror loop)
- Modify: `package.json` (move `keytar` to `optionalDependencies`)
- Test: `tests/storage/credentials.test.ts`

**Interfaces:**
- Produces:
  - `type CouchConnection = { url: string; dbName: string; login: string; token: string }`
  - `envCouchConnection(env?: NodeJS.ProcessEnv): CouchConnection | null` — reads `WALLET_COUCH_URL`, `WALLET_COUCH_DB`, `WALLET_COUCH_LOGIN`, `WALLET_COUCH_TOKEN`; all four → object; none → `null`; some → throws `Error('WALLET_COUCH_* incomplete: missing WALLET_COUCH_DB, ...')`.
  - `isConnectionManagedByEnv(): boolean`
  - `loadCouchCreds(): Promise<CouchCreds | null>` — unchanged signature; env first, Keychain only when env is unset.
  - `applyEnvConnection(): Promise<void>` — upserts `config` keys `couchUrl` and `dbName` from env; no-op without env.

- [ ] **Step 1: Write the failing tests** in `tests/storage/credentials.test.ts`:
  - `loads creds from env without touching keytar` — env with all four vars → `loadCouchCreds()` equals `{ login, token }` and `keytar.getPassword` was not called.
  - `throws on partial env and names the missing vars` — only `WALLET_COUCH_URL` + `WALLET_COUCH_TOKEN` set → `envCouchConnection(env)` throws a message containing `WALLET_COUCH_DB` and `WALLET_COUCH_LOGIN`.
  - Keep the existing Keychain test (env unset).
- [ ] **Step 2:** Run `npx vitest run tests/storage/credentials.test.ts`. Expected: the two new tests FAIL.
- [ ] **Step 3:** Implement the interfaces above. Import `keytar` with `await import('keytar')` inside the Keychain branch only, so the container never loads it.
- [ ] **Step 4:** Implement the config API 409s (`{ error: 'connection is managed by environment variables' }`) and the read-only UI state.
- [ ] **Step 5:** Run `npx vitest run`. Expected: all tests PASS.
- [ ] **Step 6:** Commit with `/ledger`.

### Task 2: Mirror — record rules, labels, 60 s refresh

**Files:**
- Create: `scripts/couch-types.ts` (read-only probe: pages through `_changes?include_docs=true`, prints a count per `reservedModelType`)
- Modify: `package.json` (`"probe:types": "tsx scripts/couch-types.ts"`)
- Modify: `src/sync/couch-cache.ts` (`TYPES`)
- Modify: `src/dashboards/mirror.ts` (`DEFAULT_MIRROR_INTERVAL_MS = 60 * 1000`)

**Interfaces:**
- Produces: `TYPES` gains the two model type names the probe reports for record rules and labels (expected `RecordRule` and `HashTag`; use what the probe prints).

- [ ] **Step 1:** Write `scripts/couch-types.ts`, reusing `CouchClient` from `src/sync/couch.ts` and `loadCouchCreds()` + `config` (`couchUrl`, `dbName`). It must not write anything.
- [ ] **Step 2:** Run `npm run probe:types` on the work Mac (Keychain creds). Record the output in the commit body. Expected: one line per model type, including record rules (the user has 2: "Pilon 3", "Tithe") and labels (4: Debt, Rent, Revolut, Wedding).
- [ ] **Step 3:** If record rules are **not** Couch docs: stop. Report to the user; the spec's fallback (manual rule entry in Wallet) applies to Phase 5. Otherwise continue.
- [ ] **Step 4:** Add the two type names to `TYPES`; set the 60 s default.
- [ ] **Step 5:** Commit with `/ledger` (Task 3 carries the reseed test; commit them together if you prefer).

### Task 3: Reseed the mirror when the cached types change

**Files:**
- Modify: `src/sync/couch-cache.ts`
- Test: `tests/sync/couch-cache.test.ts` (new)

**Interfaces:**
- Consumes: `TYPES` from Task 2; existing `couchCacheMeta` (`scope`, `lastSeq`) and `config` tables.
- Produces: the existing refresh function keeps its signature. New behaviour: it stores `TYPES.join(',')` in `config` key `couchCache.types`; when the stored value differs from the current one, it refreshes that scope from `since=0` and then saves the new value.

- [ ] **Step 1: Write the failing test** `refetches from since=0 when the cached type list changes`: seed `couchCacheMeta` with `lastSeq: '42-abc'` and `config['couchCache.types'] = 'Account,Record'`; run a refresh against a fake client that records the `since` argument; assert the first `_changes` call used `since=0` and `config['couchCache.types']` now equals `TYPES.join(',')`. Second test `resumes from last_seq when the type list is unchanged`: assert `since='42-abc'`.
- [ ] **Step 2:** Run `npx vitest run tests/sync/couch-cache.test.ts`. Expected: FAIL (first test).
- [ ] **Step 3:** Implement. Use a temporary SQLite DB in the test the way `tests/storage/db.test.ts` does.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all PASS.
- [ ] **Step 5:** Commit with `/ledger`.

### Task 4: Access guard (`proxy.ts`) and `/api/health`

**Files:**
- Create: `src/security/access.ts`
- Create: `proxy.ts` (repo root)
- Create: `app/api/health/route.ts`
- Modify: `instrumentation.ts` (call `policyFromEnv(process.env)` at boot so production fails fast)
- Test: `tests/security/access.test.ts`

**Interfaces:**
- Produces:
  - `type AccessPolicy = { users: Set<string>; hosts: Set<string>; requireUser: boolean }`
  - `policyFromEnv(env: NodeJS.ProcessEnv): AccessPolicy` — `users` from `WALLET_ALLOWED_USERS`, `hosts` = {`localhost`,`127.0.0.1`,`[::1]`} ∪ `WALLET_ALLOWED_HOSTS` (comma lists, trimmed, lower-cased); `requireUser` = `NODE_ENV === 'production' || users.size > 0`; throws `Error('WALLET_ALLOWED_USERS is required in production')` when production and empty; throws when a host entry contains a port.
  - `type AccessRequest = { method: string; path: string; host: string; login: string | null; contentType: string | null; origin: string | null }`
  - `checkAccess(req: AccessRequest, policy: AccessPolicy): { status: 403 | 421; reason: string } | null`
  - `GET /api/health` → `200 { ok: true, mirrorSyncedAt: string | null }` (no account data).

Rules, in order: host (port stripped, IPv6 brackets kept, lower-case) not allowed → 421 `unknown host`; path ≠ `/api/health` and `requireUser` and login ∉ users → 403 `not allowed`; method ∉ {GET, HEAD, OPTIONS} and content type (before `;`) ∉ {`application/json`, `multipart/form-data`} → 403 `unsupported write`; unsafe method with an `Origin` whose host:port ≠ Host → 403 `cross-origin write`.

- [ ] **Step 1: Write the failing tests** (one `it` per row; policy users `{'darius@example.com'}`, hosts `{'mac-pro.tailnet.ts.net'}`):
  - `GET /` host `Mac-Pro.Tailnet.ts.net:443`, login `Darius@Example.com` → `null`
  - `GET /` host `evil.example` → `{ status: 421 }`
  - `GET /` allowed host, login `null` → `{ status: 403 }`
  - `GET /api/health` allowed host, login `null` → `null`
  - `POST /api/sync` multipart, Origin `https://mac-pro.tailnet.ts.net` (Host same) → `null`
  - `POST /api/sync` `text/plain` → `{ status: 403 }`
  - `POST /api/config` JSON, Origin `https://evil.example` → `{ status: 403 }`
  - `GET /` host `[::1]:8090`, allowed login → `null`
  - `policyFromEnv({ NODE_ENV: 'production' })` throws
  - `policyFromEnv({ NODE_ENV: 'development' })` → `requireUser === false`
- [ ] **Step 2:** Run `npx vitest run tests/security/access.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `src/security/access.ts` as pure functions.
- [ ] **Step 4:** Implement `proxy.ts`: build `AccessRequest` from `request` (`host` header, `tailscale-user-login`, `content-type`, `origin`, `nextUrl.pathname`); on deny return `new NextResponse(reason, { status })`. Matcher excludes `/_next/static`, `/_next/image` and `/favicon.ico` only (the manifest, icons and `/sw.js` stay behind the check; the installed PWA sends the login header). Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` first.
- [ ] **Step 5:** Run `npx vitest run`. Expected: all PASS. Then `npm run dev` and check: `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/health` → `200`.
- [ ] **Step 6:** Commit with `/ledger`.

### Task 5: PWA shell and web push

**Files:**
- Create: `app/manifest.ts`
- Create: `app/icons/[size]/route.tsx` (PNG via `ImageResponse` from `next/og`; sizes `192`, `512`, `180` for Apple)
- Modify: `app/layout.tsx` (`viewport.themeColor '#0f1115'`, `metadata.appleWebApp { capable: true, title: 'Wallet', statusBarStyle: 'black-translucent' }`, Apple icon link)
- Create: `public/sw.js`
- Create: `src/push/push.ts`
- Create: `app/api/push/key/route.ts`, `app/api/push/subscription/route.ts`, `app/api/push/test/route.ts`
- Create: `app/settings/NotificationsCard.tsx` (client: register `/sw.js`, Enable / Disable / Send test); render it in `app/settings/SettingsView.tsx`
- Modify: `package.json` (`web-push`, `@types/web-push`)
- Test: `tests/push/push.test.ts`

**Interfaces:**
- Produces (`src/push/push.ts`), all state in the `config` table:
  - `getVapidPublicKey(): Promise<string>` — generates the pair with `webpush.generateVAPIDKeys()` on first call; stores it under `push.vapid`.
  - `subscriptionSchema` (zod): `{ endpoint: https URL, max 2048 chars; keys: { p256dh: string; auth: string } }`
  - `saveSubscription(sub: z.infer<typeof subscriptionSchema>): Promise<void>` (key `push.subscription`; one subscription, last write wins)
  - `clearSubscription(): Promise<void>`
  - `sendPush(msg: { title: string; body: string; url: string }): Promise<'sent' | 'no-subscription' | 'gone'>` — VAPID subject `WALLET_VAPID_SUBJECT` ?? `'mailto:wallet-sync@localhost'`; TTL 6 h; 404/410 → `clearSubscription()` and `'gone'`; other errors throw.
- API: `GET /api/push/key` → `{ publicKey }`; `PUT /api/push/subscription` (body validated by `subscriptionSchema`, 400 on failure); `DELETE /api/push/subscription`; `POST /api/push/test` → sends `{ title: 'Wallet', body: 'Notifications work.', url: '/' }`.
- `public/sw.js`: `push` → `showNotification(title, { body, data: { url } })`; `notificationclick` → focus an open client or `clients.openWindow(url)`.
- Manifest: `name 'Wallet Sync'`, `short_name 'Wallet'`, `start_url '/'`, `display 'standalone'`, `background_color` and `theme_color '#0f1115'`, icons `/icons/192`, `/icons/512`.

- [ ] **Step 1: Write the failing tests** (mock `web-push`; temp SQLite DB):
  - `sendPush returns no-subscription when none is saved`
  - `sendPush clears the subscription on 410 and returns gone` (mock `sendNotification` rejects `{ statusCode: 410 }`; afterwards `config['push.subscription']` is absent)
  - `getVapidPublicKey generates once and returns the same key on the next call` (`generateVAPIDKeys` called once)
  - `subscriptionSchema rejects an http endpoint`
- [ ] **Step 2:** Run `npx vitest run tests/push/push.test.ts`. Expected: FAIL.
- [ ] **Step 3:** `npm install web-push @types/web-push`; implement `src/push/push.ts`.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all PASS.
- [ ] **Step 5:** Implement the manifest, icons, layout metadata, `sw.js`, API routes and `NotificationsCard`. Read `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md` first.
- [ ] **Step 6:** `npm run build`. Expected: build succeeds; `/manifest.webmanifest` and `/icons/192` are listed.
- [ ] **Step 7:** Commit with `/ledger`.

### Task 6: Container, compose fragment, runbook

**Files:**
- Modify: `next.config.ts` (`output: 'standalone'`; keep `serverExternalPackages: ['keytar', 'better-sqlite3']`)
- Modify: `src/storage/db.ts` (`dataDir = process.env.WALLET_DATA_DIR ?? join(homedir(), '.wallet-broker-sync')`)
- Create: `Dockerfile`, `.dockerignore`
- Create: `deploy/compose.wallet-sync.yml`
- Create: `docs/deploy.md`
- Modify: `.gitignore` (add `.superpowers/`)

**Interfaces:**
- Image: build stage `node:24-bookworm-slim` + `python3 make g++` (better-sqlite3 native build), `npm ci`, `npm run build`. Runtime stage `node:24-bookworm-slim`, user `node`, copies `.next/standalone`, `.next/static` → `.next/static`, `public`, and `src/storage/migrations` (db.ts resolves `process.cwd()/src/storage/migrations`). `ENV NODE_ENV=production PORT=8090 HOSTNAME=0.0.0.0 WALLET_DATA_DIR=/data`. `HEALTHCHECK` with `node -e` fetch of `http://127.0.0.1:8090/api/health`. `CMD ["node", "server.js"]`.
- Compose service `wallet-sync`: `build.context: ${WALLET_SYNC_DIR:?absolute path to the investment-wallet-sync checkout}`; `restart: unless-stopped`; `networks: [default, ai]` (the `ai` network is declared in body-ledger's `compose.body-ledger.yml`); `ports: ["127.0.0.1:8090:8090"]`; volume `wallet_sync_data:/data`; env passthrough: `WALLET_COUCH_URL`, `WALLET_COUCH_DB`, `WALLET_COUCH_LOGIN`, `WALLET_COUCH_TOKEN`, `WALLET_ALLOWED_USERS` (`:?` required), `WALLET_ALLOWED_HOSTS`, `WALLET_VAPID_SUBJECT`.
- `docs/deploy.md` (on the Mac Pro, in the body-ledger checkout): add the `WALLET_*` vars and `WALLET_SYNC_DIR` to `.env`; append the fragment to `COMPOSE_FILE`; `docker compose up -d --build wallet-sync`; one-time state copy (`docker compose stop wallet-sync`, `docker compose cp <path>/audit.sqlite wallet-sync:/data/audit.sqlite`, start); `tailscale serve --bg --https=8090 8090`; login name via `tailscale whois $(tailscale ip -4)`; iPhone: open the URL in Safari → Share → Add to Home Screen → open from the icon → Settings → Enable notifications → Send test.

- [ ] **Step 1:** Make the code and config changes above.
- [ ] **Step 2:** `npx vitest run`. Expected: all PASS.
- [ ] **Step 3:** `docker build -t wallet-sync .` on the work Mac. Expected: success. (The Mac Pro builds its own x64 image from the same Dockerfile.)
- [ ] **Step 4:** Smoke run with a scratch volume and real env from the Keychain values:
  `docker run --rm -d --name ws -p 127.0.0.1:8090:8090 -e WALLET_ALLOWED_USERS=me@test -e WALLET_COUCH_URL=... -e WALLET_COUCH_DB=... -e WALLET_COUCH_LOGIN=... -e WALLET_COUCH_TOKEN=... wallet-sync`
  Expected: `curl -s localhost:8090/api/health` → `{"ok":true,...}`; `curl -s -o /dev/null -w '%{http_code}' localhost:8090/` → `403`; with `-H 'Tailscale-User-Login: me@test'` → `200` or `307`; after ~70 s, `/api/health` shows a non-null `mirrorSyncedAt`; `docker logs ws` contains no token.
- [ ] **Step 5:** `docker rm -f ws`. Commit with `/ledger`.
- [ ] **Step 6:** Hand `docs/deploy.md` to the user for the Mac Pro steps (the deploy itself is the user's action: it changes the body-ledger `.env` and Tailscale config on another machine).
