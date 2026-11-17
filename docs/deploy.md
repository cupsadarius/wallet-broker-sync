# Deploy on the Mac Pro

The app runs as the `wallet-sync` service in the body-ledger compose stack. Tailscale serve publishes it to the tailnet.

## 1. Configure

In the body-ledger checkout on the Mac Pro, add these lines to `.env`:

```sh
WALLET_SYNC_DIR=/absolute/path/to/investment-wallet-sync
WALLET_COUCH_URL=https://couch-prod-eu-1.budgetbakers.com
WALLET_COUCH_DB=bb-<user id>
WALLET_COUCH_LOGIN=<login>
WALLET_COUCH_TOKEN=<token>
WALLET_ALLOWED_USERS=<your tailscale login>
WALLET_ALLOWED_HOSTS=<mac-pro>.<tailnet>.ts.net
WALLET_SYNC_PORT=8092   # host port; 8090 and 8091 are taken on the Mac Pro
```

- Get the Couch values on the work Mac: open Settings in the app, or read the Keychain entry `wallet-broker-sync`.
- Get the Tailscale login with `tailscale whois $(tailscale ip -4)`.
- Append `:<path to investment-wallet-sync>/deploy/compose.wallet-sync.yml` to `COMPOSE_FILE`.

## 2. Move the data

Do this step before the first start. The copy keeps the import history, the price history, and the Wallet mirror, so the app does not sync from the beginning.

On the work Mac, make a consistent copy. This is safe while the dev server runs:

```sh
sqlite3 ~/.wallet-broker-sync/audit.sqlite ".backup /tmp/audit.sqlite"
scp /tmp/audit.sqlite <mac-pro>:~/audit.sqlite
```

On the Mac Pro, in the body-ledger checkout:

```sh
docker compose build wallet-sync
docker compose run --rm --no-deps --user root --entrypoint sh \
  -v ~/audit.sqlite:/in/audit.sqlite:ro wallet-sync \
  -c 'cp /in/audit.sqlite /data/audit.sqlite && rm -f /data/audit.sqlite-wal /data/audit.sqlite-shm && chown node:node /data/audit.sqlite'
```

> **Warning:** If the service already ran on an empty volume, stop it first with `docker compose stop wallet-sync`. The command above deletes the old `-wal` and `-shm` files. A stale write-ahead log next to a new database file corrupts it.

## 3. Start

```sh
docker compose up -d wallet-sync
curl -s 127.0.0.1:8092/api/health
tailscale serve --bg --https=8092 http://127.0.0.1:8092
```

The first start reads the Wallet feed once from the beginning, because the mirror now also stores record rules and labels. This takes about 15 seconds.

## 4. Install on the iPhone

1. Open `https://<mac-pro>.<tailnet>.ts.net:8092` in Safari.
2. Tap Share, then Add to Home Screen.
3. Open the app from the Home Screen icon.
4. Go to Settings, then tap Enable under Notifications.
5. Tap Send test.

## 5. Connect opencode to the MCP server

The app serves a read-only MCP server at `/mcp` (streamable HTTP, stateless). The opencode container reaches it on the `ai` network as `http://wallet-sync:8090/mcp`. Tailscale is not in this path, so `/mcp` needs a bearer token, not a Tailscale login.

1. Add the token to body-ledger's `.env`:

   ```sh
   WALLET_MCP_TOKEN=<openssl rand -hex 32>
   ```

   The compose fragment passes it to `wallet-sync` and to `opencode`. It also puts `wallet-sync` in front of `WALLET_ALLOWED_HOSTS`, so the Host `wallet-sync:8090` passes the host check. You do not add `wallet-sync` to `.env`. Without the token, `/mcp` answers 404.

2. Add the server to body-ledger's `opencode/opencode.json`, deny its tools by default, and add the `wallet-sync` agent. opencode 2.x reads MCP servers from `mcp.servers` and has no `enabled` key, so move `health` there too:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "mcp": {
       "servers": {
         "health": { "...": "unchanged, without \"enabled\"" },
         "wallet": {
           "type": "remote",
           "url": "http://wallet-sync:8090/mcp",
           "headers": { "Authorization": "Bearer {env:WALLET_MCP_TOKEN}" },
           "codemode": false
         }
       }
     },
     "websearch": { "provider": "random" },
     "permissions": [
       { "action": "wallet_*", "resource": "*", "effect": "deny" }
     ],
     "agents": {
       "wallet-sync": {
         "description": "wallet-sync's Ask answers: the wallet MCP tools only",
         "mode": "primary",
         "hidden": true,
         "permissions": [{ "action": "wallet_*", "resource": "*", "effect": "allow" }]
       }
     }
   }
   ```

   - `codemode: false` puts each wallet tool on the model's own tool list, so each answer can list the tools it called. With Code Mode, every call shows as `execute`.
   - `websearch` picks a search provider. Without it, the first `websearch` call waits for a form that no one answers, and fails after about a minute.

3. Recreate the services: `docker compose up -d wallet-sync opencode`.

4. Check the endpoint from the Mac Pro:

   ```sh
   curl -s 127.0.0.1:8092/mcp -H "Authorization: Bearer $WALLET_MCP_TOKEN" \
     -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

### Money data only in wallet-sync sessions

`"disabled": true` does not work for this: opencode then never connects the server, and no session can turn it on. Instead, the server stays connected and a permission rule hides its tools. opencode names MCP tools `<server>_<tool>` (for example `wallet_query_records`), and the last matching rule wins.

- **Default (any session):** the config rule `wallet_*` → `deny` hides the tools.
- **wallet-sync sessions:** the Ask answer step creates its session with the agent `wallet-sync`, whose rules allow `wallet_*` after the config deny. The session rules are `[{"action": "*", "resource": "*", "effect": "deny"}, {"action": "wallet_*", "resource": "*", "effect": "allow"}]`, so this step has no web tools, as the two-step research pattern requires.
- **body-ledger sessions:** `run_tools` in `server/src/health/ai/llm.py` creates sessions with the rules allow `*`, then deny `wallet_*`. The deny comes last, so it wins wherever opencode puts session rules.

> **Caution:** The opencode docs say that agent rules come after config rules. They do not say where session rules sit. The agent makes the wallet tools work in both cases. After the change, check both sides as in section 6.

### Tools

All tools are read-only. Each result has `asOf` (the last Wallet mirror sync), and each amount has its currency. IBANs and bank account numbers show only their last 4 characters.

| Tool | Returns |
|---|---|
| `list_accounts` | Accounts with balance (opening balance plus records) in the account currency |
| `query_records` | Records filtered by dates, account, category, text; `groupBy` category or month; `currency` converts with `fx_history` |
| `holdings` | Positions with price, value, cost, and unrealized P&L in the base currency; filter by broker or account |
| `performance` | XIRR (money-weighted) and time-weighted return per broker and in total |
| `net_worth` | Month-end cash, investments, and total in the base currency |
| `spending_by_category` | Income and expense per category for a period (default: this month) |
| `list_categories` | Categories with id and group |
| `rules_and_labels` | Wallet record rules (MagicRule) and labels (HashTag) |
| `price_history` | Daily closes for a Wallet symbol or Yahoo ticker |
| `fx_history` | Daily FX rates for a currency pair |
| `data_freshness` | Last mirror sync, last import per broker, latest price and FX dates |

To add a tool, add one entry to `TOOLS` in `src/mcp/tools.ts`.

## 6. Ask tab

The Ask tab sends each question to body-ledger's `opencode` service, with the OpenCode Go model `opencode-go/claude-haiku-5-5` (as body-ledger's research job). No free models: their providers may keep prompts.

Each question runs in two opencode sessions:

1. **Research:** a new session sees only the questions of the chat. It may use `websearch` and `webfetch`; every other tool, and `wallet_*`, is denied. It replies `NONE` when the question needs no outside facts. The app deletes this session after the step.
2. **Answer:** the chat's own session (one per chat, so follow-ups keep their context) gets the research and the question. It may use only `wallet_*`. It replies with text and an optional json-render spec, which the app checks against its catalog. An invalid spec is dropped, and the text alone shows.

The job runs on the server, so it finishes when the phone disconnects. A push notification says when the answer is ready. Each answer lists the tools it called: own data and web.

### Environment

| Variable | Default | Use |
|---|---|---|
| `WALLET_OPENCODE_URL` | `http://opencode:4096` | The opencode server, on the `ai` network |
| `WALLET_OPENCODE_PASSWORD` | empty | opencode's `OPENCODE_SERVER_PASSWORD` (user `opencode`) |

The compose fragment passes both to `wallet-sync`:

```yaml
      WALLET_OPENCODE_URL: http://opencode:4096
      WALLET_OPENCODE_PASSWORD: ${OPENCODE_SERVER_PASSWORD:-}
```

`OPENCODE_SERVER_PASSWORD` is already in body-ledger's `.env`. The opencode service needs no new variable: the fragment already gives it `WALLET_MCP_TOKEN`.

### Check the permissions

After `docker compose up -d wallet-sync opencode`, ask opencode how it decides for a wallet tool in each kind of session. The endpoint evaluates the rules; it runs no model. Use a throwaway container on the `ai` network, with `P` set to `OPENCODE_SERVER_PASSWORD`:

```sh
oc() { docker run --rm --network garmin-grafana_ai curlimages/curl:8.11.1 -s -u "opencode:$P" \
  -H 'content-type: application/json' "$@"; }
for s in '"permissions":[{"action":"*","resource":"*","effect":"allow"},{"action":"wallet_*","resource":"*","effect":"deny"}]' \
         '"agent":"wallet-sync","permissions":[{"action":"*","resource":"*","effect":"deny"},{"action":"wallet_*","resource":"*","effect":"allow"}]'; do
  id=$(oc -d "{\"location\":{\"directory\":\"/work\"},$s}" http://opencode:4096/api/session | sed 's/.*"id":"\([^"]*\)".*/\1/')
  oc -d '{"action":"wallet_list_accounts","resources":["*"]}' "http://opencode:4096/api/session/$id/permission"; echo
  oc -X DELETE "http://opencode:4096/api/session/$id"
done
```

Make sure the first line (a body-ledger session) shows `"effect":"deny"` and the second (a wallet-sync answer session) shows `"effect":"allow"`. Also check that `GET /api/mcp` lists `health` and `wallet` as connected.
