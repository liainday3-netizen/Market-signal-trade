---
name: Signal coherence gate
description: The shared signal safety rule for indicator and multi-timeframe agreement.
---

BUY and SELL signals must pass both indicator agreement and complete 1m/5m/15m timeframe agreement. Missing timeframe data is not treated as agreement; the result must be HOLD.

**Why:** The trader can place live Coinbase or Base DEX orders from the auto-loop, so an incomplete market-data set must never create a new real-money signal. The coherence layer is intentionally suppressive: it can turn a raw directional signal into HOLD, but cannot create BUY or SELL.

**How to apply:** Keep the shared coherence evaluator between factor scoring and every execution path. If thresholds or factor weights change, preserve the fail-closed behavior and expose the reason/score in the API and dashboard so suppressed trades are explainable.