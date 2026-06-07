import { db, tradesTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "./logger";
import * as exchange from "./coinbaseExchange";
import * as scaling from "./scalingEngine";

const MIN_TRADE_USDC = 5;
const PER_TRADE_FRACTION = 0.33;

export interface LivePosition {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  openedAt: string;
}

export interface LiveTraderState {
  enabled: boolean;
  configured: boolean;
  budgetUsdc: number;
  positions: Record<string, LivePosition>;
}

const state: LiveTraderState = {
  enabled: false,
  configured: false,
  budgetUsdc: 15,
  positions: {},
};

export function getState(): LiveTraderState {
  return { ...state, positions: { ...state.positions } };
}

export function setEnabled(enabled: boolean) {
  if (enabled && !exchange.isConfigured()) {
    throw new Error("Coinbase API keys are not configured.");
  }
  state.enabled = enabled;
  state.configured = exchange.isConfigured();
  logger.info({ enabled }, "Live trader toggled");
}

export function setBudget(usdc: number) {
  if (usdc < MIN_TRADE_USDC) throw new Error(`Budget must be at least $${MIN_TRADE_USDC}`);
  state.budgetUsdc = usdc;
}

export function refreshConfigured() {
  state.configured = exchange.isConfigured();
}

export async function executeBuy(symbol: string, price: number, signalId?: number, composite = 0.5): Promise<boolean> {
  if (!state.enabled || !state.configured) return false;
  if (state.positions[symbol]) {
    logger.info({ symbol }, "Live: already have open position, skipping BUY");
    return false;
  }

  let freeUsdc: number;
  try {
    freeUsdc = await exchange.fetchUsdcBalance();
  } catch (err) {
    logger.error({ err }, "Live: failed to fetch balance");
    return false;
  }

  const multiplier = scaling.calcMultiplier(composite);
  const allocation = Math.min(
    Math.max(MIN_TRADE_USDC, freeUsdc * PER_TRADE_FRACTION) * multiplier,
    state.budgetUsdc,
  );

  if (freeUsdc < allocation || freeUsdc < MIN_TRADE_USDC) {
    logger.warn({ symbol, freeUsdc, allocation }, "Live: insufficient USDC balance");
    return false;
  }

  try {
    const order = await exchange.placeMarketBuy(symbol, allocation);
    const fillPrice = order.price > 0 ? order.price : price;
    const qty = order.filled > 0 ? order.filled : allocation / fillPrice;

    state.positions[symbol] = {
      symbol,
      quantity: qty,
      avgEntryPrice: fillPrice,
      openedAt: new Date().toISOString(),
    };

    await db.insert(tradesTable).values({
      symbol,
      side: "LIVE_BUY",
      quantity: qty,
      price: fillPrice,
      value: allocation,
      realizedPnl: null,
      signalId: signalId ?? null,
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
  if (!position) {
    logger.info({ symbol }, "Live: no open position to sell");
    return false;
  }

  try {
    const order = await exchange.placeMarketSell(symbol, position.quantity);
    const fillPrice = order.price > 0 ? order.price : price;
    const proceeds = position.quantity * fillPrice;
    const cost = position.quantity * position.avgEntryPrice;
    const realizedPnl = proceeds - cost;

    delete state.positions[symbol];
    _hwLive.delete(symbol);

    // Auto-compound: grow budget by fraction of realized profit
    const compound = scaling.compoundAmount(realizedPnl);
    if (compound > 0) {
      state.budgetUsdc += compound;
      logger.info({ compound, newBudget: state.budgetUsdc }, "Live auto-compound applied");
    }

    await db.insert(tradesTable).values({
      symbol,
      side: "LIVE_SELL",
      quantity: position.quantity,
      price: fillPrice,
      value: proceeds,
      realizedPnl,
      signalId: signalId ?? null,
    });

    logger.info({ symbol, qty: position.quantity, fillPrice, realizedPnl, orderId: order.id }, "Live SELL executed");
    return true;
  } catch (err) {
    logger.error({ err, symbol }, "Live SELL failed");
    return false;
  }
}

// Trailing high-water per symbol
const _hwLive = new Map<string, number>();

export function checkSlTp(symbol: string, currentPrice: number): void {
  const position = state.positions[symbol];
  if (!position) { _hwLive.delete(symbol); return; }

  const prev = _hwLive.get(symbol) ?? position.avgEntryPrice;
  const hw = Math.max(prev, currentPrice);
  _hwLive.set(symbol, hw);

  const stopRef = scaling.highWaterPrice(position.avgEntryPrice, hw);
  if (scaling.isStopLoss(stopRef, currentPrice)) {
    logger.info({ symbol, entry: position.avgEntryPrice, hw, current: currentPrice }, "Live trailing stop-loss triggered");
    executeSell(symbol, currentPrice).catch(() => {});
  } else if (scaling.isTakeProfit(position.avgEntryPrice, currentPrice)) {
    logger.info({ symbol, entry: position.avgEntryPrice, current: currentPrice }, "Live take-profit triggered");
    executeSell(symbol, currentPrice).catch(() => {});
  }
}

export async function getLivePortfolio() {
  const liveTrades = await db
    .select()
    .from(tradesTable)
    .orderBy(desc(tradesTable.createdAt));

  const liveOnly = liveTrades.filter((t) => t.side.startsWith("LIVE_"));
  const sells = liveOnly.filter((t) => t.side === "LIVE_SELL" && t.realizedPnl !== null);
  const wins = sells.filter((t) => (t.realizedPnl ?? 0) > 0).length;
  const losses = sells.filter((t) => (t.realizedPnl ?? 0) <= 0).length;
  const totalRealizedPnl = sells.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
  const winRate = sells.length > 0 ? (wins / sells.length) * 100 : 0;

  let exchangeBalances: exchange.ExchangeBalance[] = [];
  let freeUsdc = 0;
  if (state.configured) {
    try {
      exchangeBalances = await exchange.fetchBalances();
      freeUsdc = await exchange.fetchUsdcBalance();
    } catch (_) {}
  }

  return {
    enabled: state.enabled,
    configured: state.configured,
    budgetUsdc: state.budgetUsdc,
    freeUsdc,
    openPositions: Object.values(state.positions),
    trades: liveOnly.slice(0, 50).map((t) => ({
      id: t.id,
      symbol: t.symbol,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      value: t.value,
      realizedPnl: t.realizedPnl,
      timestamp: t.createdAt.toISOString(),
    })),
    totalTrades: liveOnly.length,
    closedTrades: sells.length,
    wins,
    losses,
    winRate,
    totalRealizedPnl,
    exchangeBalances,
  };
}
