# Running Market-Signal-Trade 24/7

## 0. Before anything else: rotate the leaked Coinbase key

A Coinbase API secret was committed in plaintext to `.replit` (commit `2671930`,
9 Oct 2026). This repo is **public**, so treat that key as compromised:

1. Coinbase → Settings → API → **delete** the old key.
2. Create a new key: **View + Trade only. Never enable Transfer/Withdraw.**
   If you can, allowlist your server's IP.
3. Put the new key in your host's secret store (Replit Secrets / `.env` on a VPS).
   Never put it in a committed file.

Removing it from the latest commit does **not** remove it from git history.
Rotating the key is what actually fixes it.

## 1. Pick a host (must be always-on, single instance)

| Option | 24/7? | Notes |
|---|---|---|
| Replit **Autoscale** (current setting) | ❌ | Scales to zero when idle, so the loop stops. It can also run more than one copy, which means duplicate orders. |
| Replit **Reserved VM** | ✅ | Easiest. Deploy → change type to *Reserved VM*. Uses Replit Postgres. |
| VPS (Hetzner/DigitalOcean/Lightsail, ~$5–6/mo) + Docker | ✅ | `docker compose up -d --build`. Restarts after crashes and reboots. |
| Fly.io / Railway | ✅ | Use the Dockerfile. Set min instances = max instances = 1. |

**Run exactly one instance.** Every instance trades on its own.

### Replit Reserved VM
1. Secrets: add everything from `.env.example` (at least `ADMIN_TOKEN`; Coinbase keys only when going live).
2. Deploy → *Reserved VM* → Deploy.
3. In the dashboard, click **Set admin token** in the Risk Controls card and paste your `ADMIN_TOKEN`.

### VPS + Docker
```bash
git clone https://github.com/liainday3-netizen/Market-signal-trade && cd Market-signal-trade
cp .env.example .env && nano .env      # fill in values + POSTGRES_PASSWORD
docker compose up -d --build
docker compose logs -f bot
```
The API listens on `127.0.0.1:8080`. To reach the dashboard remotely, put Caddy or nginx with HTTPS in front, or use an SSH tunnel.

## 2. Monitoring
- **Alerts:** set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (or `DISCORD_WEBHOOK_URL`).
  You get alerts for every real buy/sell, failed orders, kill-switch events, a stalled loop, crashes, and restarts.
- **Uptime monitor:** point UptimeRobot or Better Stack at `https://<host>/api/healthz/deep`.
  It returns **503** if the trading loop hasn't processed data for 5 minutes, even when the web server is still up.
- The built-in watchdog forces a WebSocket reconnect when data goes stale. Crashes exit with a non-zero code, so Docker/Replit restarts the process.

## 3. Risk controls (`/api/trader/risk`, admin token required)
| Control | Default | Change via |
|---|---|---|
| Live arm (`LIVE_TRADING_ENABLED=true`) | **off** (paper only) | env var + restart |
| Max per trade | $10 | `POST /risk/limits {"maxPerTradeUsd":…}` |
| Max open positions (all venues) | 2 | `maxOpenPositions` |
| Max total exposure | $25 | `maxTotalExposureUsd` |
| Daily max loss (realized + unrealized, UTC day) | $5 | `maxDailyLossUsd` |
| Circuit breaker: consecutive order failures | 3 | `maxConsecutiveFailures` |
| Auto-flatten on daily-loss breach | off | `flattenOnBreach` |
| Kill switch | off | Dashboard button, `POST /risk/kill {"flatten":true?}`, or `KILL_SWITCH=1` env |

The risk layer only blocks **new** exposure. Stop-loss, take-profit and signal exits always run.

## 4. Go-live checklist
- [ ] Old Coinbase key deleted; new key is View+Trade only
- [ ] Hosting is Reserved VM / VPS, single instance
- [ ] `ADMIN_TOKEN` set; dashboard control actions prompt for it
- [ ] Alerts arrive (restarting the bot sends "Trading bot started")
- [ ] Uptime monitor on `/api/healthz/deep`
- [ ] At least 1–2 weeks of paper trading reviewed (win rate, drawdown, fees)
- [ ] Risk limits set to amounts you can afford to lose
- [ ] Set `LIVE_TRADING_ENABLED=true`, restart, then enable Live mode in the dashboard
