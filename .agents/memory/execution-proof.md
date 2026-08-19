---
name: Execution proof
description: How to distinguish simulated trades from authenticated exchange and chain execution
---

Real trade records must retain a provider proof: a Coinbase order ID for exchange execution or a Base transaction hash for DEX execution. Paper trades are simulated and must never be presented as real execution.

**Why:** Internal logs and portfolio rows alone cannot prove that money moved; provider identifiers are required for reconciliation.

**How to apply:** Keep the audit view read-only, report proof coverage separately for paper and real trades, and do not delete historical duplicate paper rows without explicit approval.