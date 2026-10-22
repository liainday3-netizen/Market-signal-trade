// Connects the pure risk manager to the database and the traders.
import { db, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import * as risk from "./riskManager";
import * as liveTrader from "./liveTrader";
import * as dexTrader from "./baseDexTrader";
import { getLastPrice } from "./paperTrader";
import { logger } from "./logger";

const store: risk.SettingsStore = {
  async load<T>(key: string, fallback: T): Promise<T> {
    const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
    if (!rows.length) return fallback;
    try { return JSON.parse(rows[0].value) as T; } catch { return fallback; }
  },
  async save(key: string, value: unknown): Promise<void> {
    const v = JSON.stringify(value);
    await db.insert(settingsTable).values({ key, value: v })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: v, updatedAt: new Date() } });
  },
};

/** Realized PnL of real-money sells since 00:00 UTC today. */
async function realizedTodayUsd(): Promise<number> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(realized_pnl), 0)::float AS pnl
    FROM trades
    WHERE side IN ('LIVE_SELL', 'DEX_SELL')
      AND realized_pnl IS NOT NULL
      AND created_at >= date_trunc('day', (now() AT TIME ZONE 'UTC'))
  `);
  const row = (res as unknown as { rows: Array<{ pnl: number | string }> }).rows[0];
  return Number(row?.pnl ?? 0);
}

export async function initRisk(): Promise<void> {
  risk.setPriceGetter(getLastPrice);
  risk.setRealizedTodayGetter(realizedTodayUsd);
  risk.setFlattener(async () => {
    await liveTrader.flattenAll(getLastPrice).catch((err) => logger.error({ err }, "Flatten live failed"));
    await dexTrader.flattenAll(getLastPrice).catch((err) => logger.error({ err }, "Flatten DEX failed"));
  });
  await risk.init(store);
}
