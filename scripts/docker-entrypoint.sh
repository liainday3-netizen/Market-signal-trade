#!/bin/sh
# Apply the Drizzle schema (safe on a fresh or up-to-date DB; never forces
# destructive changes), then start the bot. Signals are forwarded via exec.
set -e
echo "[entrypoint] applying database schema…"
pnpm --filter @workspace/db run push || echo "[entrypoint] WARN: schema push failed — check DATABASE_URL / pending changes"
exec node artifacts/api-server/dist/index.cjs
