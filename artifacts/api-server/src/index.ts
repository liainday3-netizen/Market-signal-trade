import app from "./app";
import { logger } from "./lib/logger";
import { start as startAutoTrader } from "./lib/autoTrader";
import { init as initDexTrader } from "./lib/baseDexTrader";
import { loadPersistedState as restoreLiveTrader } from "./lib/liveTrader";
import { setConfig as setScalingConfig } from "./lib/scalingEngine";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

async function boot() {
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
