import app from "./app";
import { logger } from "./lib/logger";
import { start as startAutoTrader, stop as stopAutoTrader } from "./lib/autoTrader";
import { init as initDexTrader, loadPersistedState as restoreDexTrader } from "./lib/baseDexTrader";
import { initRisk } from "./lib/riskWiring";
import { sendAlert, alertsConfigured } from "./lib/alerts";
import { pool } from "@workspace/db";
import { loadPersistedState as restoreLiveTrader } from "./lib/liveTrader";
import { setConfig as setScalingConfig } from "./lib/scalingEngine";
import { db, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

/** Ensure persistence tables exist — safe to run on every boot (IF NOT EXISTS). */
async function ensureTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS live_positions (
        id               SERIAL PRIMARY KEY,
        symbol           TEXT NOT NULL,
        quantity         REAL NOT NULL,
        avg_entry_price  REAL NOT NULL,
        high_water_price REAL,
        opened_at        TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at       TIMESTAMP DEFAULT NOW() NOT NULL,
        CONSTRAINT live_positions_symbol_unique UNIQUE (symbol)
      );
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS execution_id TEXT;
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS tx_hash TEXT;
    `);
    logger.info("Persistence tables verified");
  } catch (err) {
    logger.warn({ err }, "Table verification failed — state will not persist across restarts");
  }
}

async function boot() {
  // Create/verify persistence tables on every start (idempotent)
  await ensureTables();

  // Restore persisted scaling config before traders start
  try {
    const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, "scaling.config")).limit(1);
    if (rows.length) {
      const cfg = JSON.parse(rows[0].value);
      setScalingConfig(cfg);
      logger.info(cfg, "Scaling config restored from DB");
    }
  } catch (err) {
    logger.warn({ err }, "Could not restore scaling config — using defaults");
  }

  // Restore live trader positions + enabled state from DB
  await restoreLiveTrader();

  // DEX: read wallet from env, then restore positions + enabled flag
  initDexTrader();
  await restoreDexTrader();

  // Risk limits + kill switch (persisted)
  await initRisk();

  if (process.env.NODE_ENV === "production" && !process.env.ADMIN_TOKEN) {
    logger.error("ADMIN_TOKEN is not set — all control endpoints are locked until it is configured");
  }
  if (!alertsConfigured()) logger.warn("No alert channel configured (TELEGRAM_* or DISCORD_WEBHOOK_URL) — alerts go to logs only");

  const server = app.listen(port, () => {
    logger.info({ port }, "Server listening");
    startAutoTrader(60);
    sendAlert("info", "Trading bot started", "boot");
  });

  // ── Graceful shutdown: stop new signals, let in-flight orders finish ───────
  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn({ sig }, "Shutting down");
    sendAlert("warn", `Bot shutting down (${sig})`, "shutdown");
    stopAutoTrader();
    server.close();
    setTimeout(() => {
      pool.end().catch(() => undefined).finally(() => process.exit(0));
    }, 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// ── Never die silently ────────────────────────────────────────────────────────
// An unhandled rejection is logged + alerted but the loop keeps running.
// An uncaught exception leaves the process in an unknown state: alert and exit
// non-zero so the supervisor (Docker/systemd/Reserved VM) restarts it cleanly.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
  sendAlert("warn", `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`, "unhandled-rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — exiting for restart");
  sendAlert("critical", `Crashed: ${err.message} — restarting`, "uncaught");
  setTimeout(() => process.exit(1), 1500);
});

boot().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
