---
name: Real-trade scaling safety
description: Safety rules for adding to live Coinbase and Base DEX positions
---

Live and DEX scale-ins must remain disabled by default. When enabled, only add on a materially stronger signal, enforce a small number of additions, and cap each addition below a normal initial allocation.

**Why:** Scaling changes real-money exposure and can amplify noisy signals; the user needs an explicit opt-in and bounded downside.

**How to apply:** Preserve the disabled default, validate scaling configuration ranges at the server boundary, and keep stop-loss, take-profit, cooldown, and position persistence active for scaled positions.