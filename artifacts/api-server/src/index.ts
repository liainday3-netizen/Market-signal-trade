import app from "./app";
import { logger } from "./lib/logger";
import { start as startAutoTrader } from "./lib/autoTrader";
import { init as initDexTrader } from "./lib/baseDexTrader";
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

  app.listen(port, () => {
    logger.info({ port }, "Server listening");
    initDexTrader();
    startAutoTrader(60);
  });
}

boot().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
