---
name: Risk manager gate
description: Every real-money entry passes through riskManager.checkEntry; exits are never blocked.
---

All Coinbase and DEX BUY/scale-in paths call `risk.checkEntry` and use the returned (possibly reduced) size. `LIVE_TRADING_ENABLED=true` env is required to open real positions. Sells, stop-losses and take-profits bypass risk checks, so a position is never trapped.

**Why:** The bot runs unattended 24/7 with real money; one shared gate prevents runaway losses and keeps the go-live switch explicit.

**How to apply:** New execution venues must call `risk.registerVenue` and gate entries via `checkEntry`, wrap orders in `withLock(venue:symbol)`, and call `recordOrderSuccess/Failure`. Never add a code path that opens a real position without the gate.
