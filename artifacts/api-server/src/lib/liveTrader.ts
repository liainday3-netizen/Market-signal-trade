import { db, tradesTable, livePositionsTable, settingsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "./logger";
import * as exchange from "./coinbaseExchange";
import * as scaling from "./scalingEngine";

const MIN_TRADE_USDC  = 5;
const PER_TRADE_FRACTION = 0.33;
const COOLDOWN_MS     = 5 * 60 * 1000; // 5-min re-entry cooldown after selling

export interface LivePosition {
  symbol:        string;
  quantity:      number;
  avgEntryPrice: number;
  openedAt:      string;
}

export interface LiveTraderState {
  enabled:    boolean;
  configured: boolean;
  budgetUsdc: number;
  positions:  Record<string, LivePosition>;
}

const state: LiveTraderState = {
  enabled:    false,
  configured: false,
  budgetUsdc: 15,
  positions:  {},
};

// Per-symbol trailing high-water mark and cooldown tracking
const _hwLive    = new Map<string, number>();
const _cooldowns = new Map<string, number>();
const _scaleIns  = new Map<string, { entryComposite: number; scaleIns: number }>();

// ─── Settings persistence helpers ─────────────────────────────────────────────
async function saveSetting(key: string, value: unknown): Promise<void> {
  await db.insert(settingsTable)
    .values({ key, value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(value) } });
}

async function loadSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  if (!rows.length) return fallback;
  try { return JSON.parse(rows[0].value) as T; } catch { return fallback; }
}

// ─── Persist live position to DB ──────────────────────────────────────────────
async function upsertLivePosition(symbol: string, qty: number, avgEntry: number, hwp?: number): Promise<void> {
  await db.insert(livePositionsTable).values({
    symbol, quantity: qty, avgEntryPrice: avgEntry, highWaterPrice: hwp ?? null,
  }).onConflictDoUpdate({
    target: livePositionsTable.symbol,
    set: { quantity: qty, avgEntryPrice: avgEntry, highWaterPrice: hwp ?? null },
  });
}

async function deleteLivePosition(symbol: string): Promise<void> {
  await db.delete(livePositionsTable).where(eq(livePositionsTable.symbol, symbol));
}

// ─── Startup: restore state from DB ───────────────────────────────────────────
export async function loadPersistedState(): Promise<void> {
  try {
    state.configured = exchange.isConfigured();
    state.enabled    = await loadSetting<boolean>("live.enabled", false);
    state.budgetUsdc = await loadSetting<number>("live.budget",  15);

    // Restore any open live positions from DB
    const saved = await db.select().from(livePositionsTable);
    state.positions = {};
    for (const row of saved) {
      state.positions[row.symbol] = {
        symbol:        row.symbol,
        quantity:      row.quantity,
        avgEntryPrice: row.avgEntryPrice,
        openedAt:      row.openedAt.toISOString(),
      };
      if (row.highWaterPrice) _hwLive.set(row.symbol, row.highWaterPrice);
    }

    logger.info(
      { enabled: state.enabled, budget: state.budgetUsdc, openPositions: Object.keys(state.positions) },
      "Live trader state restored from DB",
    );
  } catch (err) {
    logger.error({ err }, "Live trader: failed to restore persisted state");
  }
}

// ─── Public state getters / setters ───────────────────────────────────────────
export function getState(): LiveTraderState {
  return { ...state, positions: { ...state.positions } };
}

export async function setEnabled(enabled: boolean): Promise<void> {
  if (enabled && !exchange.isConfigured()) {
    throw new Error("Coinbase API keys are not configured.");
  }
  state.enabled    = enabled;
  state.configured = exchange.isConfigured();
  await saveSetting("live.enabled", enabled);
  logger.info({ enabled }, "Live trader toggled");
}

export async function setBudget(usdc: number): Promise<void> {
  if (usdc < MIN_TRADE_USDC) throw new Error(`Budget must be at least $${MIN_TRADE_USDC}`);
  state.budgetUsdc = usdc;
  await saveSetting("live.budget", usdc);
}

export function refreshConfigured(): void {
  state.configured = exchange.isConfigured();
}

// ─── Trade execution ──────────────────────────────────────────────────────────
export async function executeBuy(symbol: string, price: number, signalId?: number, composite = 0.5): Promise<boolean> {
  if (!state.enabled || !state.configured) return false;

  // Re-entry cooldown: prevent whipsaw buys immediately after a stop-loss
  const lastSell = _cooldowns.get(symbol);
  if (lastSell && Date.now() - lastSell < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastSell)) / 1000);
    logger.debug({ symbol, cooldownSecs: remaining }, "Live BUY skipped — in cooldown");
    return false;
  }

  const existing = state.positions[symbol];
  const track = _scaleIns.get(symbol);
  const multiplier = scaling.calcMultiplier(composite);

  let freeUsdc: number;
  try {
    freeUsdc = await exchange.fetchUsdcBalance();
  } catch (err) {
    logger.error({ err }, "Live: failed to fetch balance");
    return false;
  }

  const scalingIn = Boolean(existing);
  if (scalingIn && !scaling.shouldScaleIn(track?.scaleIns ?? 0, composite, track?.entryComposite ?? 0.15)) {
    logger.info({ symbol, composite }, "Live: scale-in skipped — signal not stronger than entry");
    return false;
  }
  const allocation = scalingIn
    ? Math.min(state.budgetUsdc, freeUsdc * PER_TRADE_FRACTION * multiplier * 0.5)
    : Math.min(
        Math.max(MIN_TRADE_USDC, freeUsdc * PER_TRADE_FRACTION) * multiplier,
        state.budgetUsdc,
      );

  if (allocation < MIN_TRADE_USDC || freeUsdc < allocation || freeUsdc < MIN_TRADE_USDC) {
    logger.warn({ symbol, freeUsdc, allocation }, "Live: insufficient USD balance");
    return false;
  }

  try {
    const order     = await exchange.placeMarketBuy(symbol, allocation);
    const fillPrice = order.price  > 0 ? order.price  : price;
    const qty       = order.filled > 0 ? order.filled : allocation / fillPrice;

    if (existing) {
      const totalQty = existing.quantity + qty;
      const avgPrice = ((existing.quantity * existing.avgEntryPrice) + (qty * fillPrice)) / totalQty;
      state.positions[symbol] = { ...existing, quantity: totalQty, avgEntryPrice: avgPrice };
      _scaleIns.set(symbol, {
        entryComposite: track?.entryComposite ?? composite,
        scaleIns: (track?.scaleIns ?? 0) + 1,
      });
      await upsertLivePosition(symbol, totalQty, avgPrice, _hwLive.get(symbol) ?? avgPrice);
      await db.insert(tradesTable).values({
        symbol, side: "LIVE_SCALE_IN", quantity: qty, price: fillPrice,
        value: allocation, realizedPnl: null, signalId: signalId ?? null,
        executionId: order.id,
      });
      logger.info({ symbol, qty, fillPrice, allocation }, "Live SCALE-IN executed");
      return true;
    }

    state.positions[symbol] = { symbol, quantity: qty, avgEntryPrice: fillPrice, openedAt: new Date().toISOString() };
    _scaleIns.set(symbol, { entryComposite: composite, scaleIns: 0 });
    _hwLive.set(symbol, fillPrice);

    // Persist to DB so restarts don't lose the open position
    await upsertLivePosition(symbol, qty, fillPrice, fillPrice);

    await db.insert(tradesTable).values({
      symbol, side: "LIVE_BUY", quantity: qty, price: fillPrice,
      value: allocation, realizedPnl: null, signalId: signalId ?? null,
      executionId: order.id,
    });

    logger.info({ symbol, qty, fillPrice, allocation, orderId: order.id }, "Live BUY executed");
    return true;
  } catch (err) {
    logger.error({ err, symbol }, "Live BUY failed");
    return false;
  }
}

export async function executeSell(symbol: string, price: number, signalId?: number): Promise<boolean> {
  if (!state.enabled || !state.configured) return false;
  const position = state.positions[symbol];
  if (!position) { logger.info({ symbol }, "Live: no open position to sell"); return false; }

  try {
    const order     = await exchange.placeMarketSell(symbol, position.quantity);
    const fillPrice = order.price  > 0 ? order.price  : price;
    const proceeds  = position.quantity * fillPrice;
    const cost      = position.quantity * position.avgEntryPrice;
    const realizedPnl = proceeds - cost;

    delete state.positions[symbol];
    _hwLive.delete(symbol);
    _scaleIns.delete(symbol);
    _cooldowns.set(symbol, Date.now()); // start cooldown timer

    // Remove position from DB
    await deleteLivePosition(symbol);

    // Auto-compound: grow budget by fraction of realized profit
    const compound = scaling.compoundAmount(realizedPnl);
    if (compound > 0) {
      state.budgetUsdc += compound;
      await saveSetting("live.budget", state.budgetUsdc);
      logger.info({ compound, newBudget: state.budgetUsdc }, "Live auto-compound applied");
    }

    await db.insert(tradesTable).values({
      symbol, side: "LIVE_SELL",
      quantity: position.quantity, price: fillPrice,
      value: proceeds, realizedPnl,
      signalId: signalId ?? null,
      executionId: order.id,
    });

    logger.info({ symbol, qty: position.quantity, fillPrice, realizedPnl, orderId: order.id }, "Live SELL executed");
    return true;
  } catch (err) {
    logger.error({ err, symbol }, "Live SELL failed");
    return false;
  }
}

// ─── Trailing stop / take-profit monitor ─────────────────────────────────────
export function checkSlTp(symbol: string, currentPrice: number): void {
  const position = state.positions[symbol];
  if (!position) { _hwLive.delete(symbol); return; }

  const prev = _hwLive.get(symbol) ?? position.avgEntryPrice;
  const hw   = Math.max(prev, currentPrice);
  _hwLive.set(symbol, hw);

  // Persist updated high-water mark (async, fire-and-forget)
  if (hw !== prev) {
    upsertLivePosition(symbol, position.quantity, position.avgEntryPrice, hw).catch(() => {});
  }

  const stopRef = scaling.highWaterPrice(position.avgEntryPrice, hw);
  if (scaling.isStopLoss(stopRef, currentPrice)) {
    logger.info({ symbol, entry: position.avgEntryPrice, hw, current: currentPrice }, "Live trailing stop-loss triggered");
    executeSell(symbol, currentPrice).catch(() => {});
  } else if (scaling.isTakeProfit(position.avgEntryPrice, currentPrice)) {
    logger.info({ symbol, entry: position.avgEntryPrice, current: currentPrice }, "Live take-profit triggered");
    executeSell(symbol, currentPrice).catch(() => {});
  }
}

// ─── Portfolio snapshot ───────────────────────────────────────────────────────
export async function getLivePortfolio() {
  const liveTrades = await db.select().from(tradesTable).orderBy(desc(tradesTable.createdAt));
  const liveOnly   = liveTrades.filter((t) => t.side.startsWith("LIVE_"));
  const sells      = liveOnly.filter((t) => t.side === "LIVE_SELL" && t.realizedPnl !== null);
  const wins       = sells.filter((t) => (t.realizedPnl ?? 0) > 0).length;
  const losses     = sells.filter((t) => (t.realizedPnl ?? 0) <= 0).length;
  const totalRealizedPnl = sells.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
  const winRate    = sells.length > 0 ? (wins / sells.length) * 100 : 0;

  let exchangeBalances: exchange.ExchangeBalance[] = [];
  let freeUsdc = 0;
  if (state.configured) {
    try {
      exchangeBalances = await exchange.fetchBalances();
      freeUsdc         = await exchange.fetchUsdcBalance();
    } catch (err) {
      logger.warn({ err }, "Live: failed to fetch exchange balances");
    }
  }

  return {
    enabled: state.enabled, configured: state.configured,
    budgetUsdc: state.budgetUsdc, freeUsdc,
    openPositions: Object.values(state.positions),
    trades: liveOnly.slice(0, 50).map((t) => ({
      id: t.id, symbol: t.symbol, side: t.side,
      quantity: t.quantity, price: t.price, value: t.value,
      realizedPnl: t.realizedPnl,
      executionId: t.executionId,
      txHash: t.txHash,
      timestamp: t.createdAt.toISOString(),
    })),
    totalTrades: liveOnly.length, closedTrades: sells.length,
    wins, losses, winRate, totalRealizedPnl, exchangeBalances,
  };
}
