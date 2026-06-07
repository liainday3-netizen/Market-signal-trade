---
name: Paper trader race condition fix
description: How the duplicate-position race condition was caused and fixed in executeBuy
---

## The bug
`executeBuy` read `getOpenPosition(symbol)` outside a transaction, then inserted inside one. Two concurrent BUY signals for the same symbol both saw no position and both inserted — creating duplicates.

## The fix (paperTrader.ts)
Move all logic inside a `db.transaction()` that first issues:
```sql
SELECT id, cash FROM portfolio LIMIT 1 FOR UPDATE
```
The `FOR UPDATE` row lock on the portfolio row serialises all concurrent BUY attempts — only one can hold the lock at a time. A second line of defence: the `INSERT INTO positions ... ON CONFLICT DO NOTHING` combined with the DB-level `UNIQUE INDEX positions_symbol_unique ON positions(symbol)`.

**Why:** Crypto auto-traders fire signals for multiple symbols near-simultaneously. Without serialisation, duplicate positions accumulate silently.

**How to apply:** `tx.execute(rawSqlString)` in Drizzle/pg returns `{ rows: T[] }`, NOT a directly iterable array. Access via `.rows[0]`, not array destructuring.

## DB constraint
Added directly via SQL (not drizzle-kit, which prompts interactively when rows exist):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS positions_symbol_unique ON positions(symbol);
```
Schema file also updated to reflect this (`unique("positions_symbol_unique").on(t.symbol)`).
