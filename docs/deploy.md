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
curl -s 127.0.0.1:8090/api/health
tailscale serve --bg --https=8090 http://127.0.0.1:8090
```

The first start reads the Wallet feed once from the beginning, because the mirror now also stores record rules and labels. This takes about 15 seconds.

## 4. Install on the iPhone

1. Open `https://<mac-pro>.<tailnet>.ts.net:8090` in Safari.
2. Tap Share, then Add to Home Screen.
3. Open the app from the Home Screen icon.
4. Go to Settings, then tap Enable under Notifications.
5. Tap Send test.
