import { db, portfolioTable, positionsTable, tradesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "./logger";
import * as scaling from "./scalingEngine";

const STARTING_CAPITAL = 50;
const PER_TRADE_CASH_FRACTION = 0.33;
const MIN_TRADE_VALUE = 5;

// In-memory scale-in tracking: symbol → { entryComposite, scaleIns }
const _scaleIns = new Map<string, { entryComposite: number; scaleIns: number }>();

const lastPrices = new Map<string, number>();

export function setLastPrice(symbol: string, price: number) {
  lastPrices.set(symbol, price);
}

export function getLastPrice(symbol: string): number | undefined {
  return lastPrices.get(symbol);
}

export async function ensurePortfolio(): Promise<{ id: number; cash: number; startingCapital: number }> {
  const existing = await db.select().from(portfolioTable).limit(1);
  if (existing.length > 0) {
    return { id: existing[0].id, cash: existing[0].cash, startingCapital: existing[0].startingCapital };
  }
  const [created] = await db
    .insert(portfolioTable)
    .values({ startingCapital: STARTING_CAPITAL, cash: STARTING_CAPITAL })
    .returning();
  logger.info({ startingCapital: STARTING_CAPITAL }, "Initialized paper portfolio");
  return { id: created.id, cash: created.cash, startingCapital: created.startingCapital };
}

async function getOpenPosition(symbol: string) {
  const rows = await db.select().from(positionsTable).where(eq(positionsTable.symbol, symbol)).limit(1);
  return rows[0] ?? null;
}

export async function executeBuy(symbol: string, price: number, signalId?: number, composite = 0.5): Promise<boolean> {
  const portfolio = await ensurePortfolio();
  const existing = await getOpenPosition(symbol);
  const cfg = scaling.getConfig();
  const multiplier = scaling.calcMultiplier(composite);
  const track = _scaleIns.get(symbol);

  // ── Scale-in path: add to an existing position ─────────────────────────────
  if (existing) {
    if (!cfg.scaleInEnabled || !scaling.shouldScaleIn(track?.scaleIns ?? 0, composite, track?.entryComposite ?? 0.15)) {
      return false;
    }

    const addAllocation = Math.max(MIN_TRADE_VALUE * 0.5, portfolio.cash * PER_TRADE_CASH_FRACTION * multiplier * 0.5);
    if (portfolio.cash < addAllocation) return false;

    const addQty = addAllocation / price;
    const newTotalQty = existing.quantity + addQty;
    const newAvgPrice = ((existing.quantity * existing.avgEntryPrice) + (addQty * price)) / newTotalQty;
    const newCash = portfolio.cash - addAllocation;

    await db.transaction(async (tx) => {
      await tx.update(portfolioTable).set({ cash: newCash, updatedAt: new Date() }).where(eq(portfolioTable.id, portfolio.id));
      await tx.update(positionsTable).set({ quantity: newTotalQty, avgEntryPrice: newAvgPrice, updatedAt: new Date() }).where(eq(positionsTable.id, existing.id));
      await tx.insert(tradesTable).values({ symbol, side: "SCALE_IN", quantity: addQty, price, value: addAllocation, realizedPnl: null, signalId: signalId ?? null });
    });

    _scaleIns.set(symbol, { entryComposite: track?.entryComposite ?? composite, scaleIns: (track?.scaleIns ?? 0) + 1 });
    logger.info({ symbol, addQty, price, addAllocation, scaleIns: (track?.scaleIns ?? 0) + 1 }, "Paper SCALE-IN executed");
    return true;
  }

  // ── New position ───────────────────────────────────────────────────────────
  const baseAllocation = Math.max(MIN_TRADE_VALUE, portfolio.cash * PER_TRADE_CASH_FRACTION);
  const allocation = baseAllocation * multiplier;
  if (allocation > portfolio.cash || portfolio.cash < MIN_TRADE_VALUE) {
    logger.warn({ symbol, cash: portfolio.cash }, "Insufficient cash to open position");
    return false;
  }

  const quantity = allocation / price;
  const newCash = portfolio.cash - allocation;

  await db.transaction(async (tx) => {
    await tx.update(portfolioTable).set({ cash: newCash, updatedAt: new Date() }).where(eq(portfolioTable.id, portfolio.id));
    await tx.insert(positionsTable).values({ symbol, quantity, avgEntryPrice: price });
    await tx.insert(tradesTable).values({ symbol, side: "BUY", quantity, price, value: allocation, realizedPnl: null, signalId: signalId ?? null });
  });

  _scaleIns.set(symbol, { entryComposite: composite, scaleIns: 0 });
  logger.info({ symbol, quantity, price, allocation, multiplier }, "Paper BUY executed");
  return true;
}

export async function executeSell(symbol: string, price: number, signalId?: number): Promise<boolean> {
  const portfolio = await ensurePortfolio();
  const position = await getOpenPosition(symbol);
  if (!position) {
    return false;
  }

  const proceeds = position.quantity * price;
  const cost = position.quantity * position.avgEntryPrice;
  const realizedPnl = proceeds - cost;
  const newCash = portfolio.cash + proceeds;

  await db.transaction(async (tx) => {
    await tx
      .update(portfolioTable)
      .set({ cash: newCash, updatedAt: new Date() })
      .where(eq(portfolioTable.id, portfolio.id));

    await tx.delete(positionsTable).where(eq(positionsTable.id, position.id));

    await tx.insert(tradesTable).values({
      symbol,
      side: "SELL",
      quantity: position.quantity,
      price,
      value: proceeds,
      realizedPnl,
      signalId: signalId ?? null,
    });
  });

  _scaleIns.delete(symbol);
  logger.info({ symbol, quantity: position.quantity, price, realizedPnl }, "Paper SELL executed");
  return true;
}

// ─── Stop-loss / take-profit check ────────────────────────────────────────────
export async function checkSlTp(symbol: string, currentPrice: number): Promise<"stop_loss" | "take_profit" | null> {
  const position = await getOpenPosition(symbol);
  if (!position) return null;

  if (scaling.isStopLoss(position.avgEntryPrice, currentPrice)) {
    logger.info({ symbol, entry: position.avgEntryPrice, current: currentPrice }, "Paper stop-loss triggered");
    await executeSell(symbol, currentPrice);
    return "stop_loss";
  }

  if (scaling.isTakeProfit(position.avgEntryPrice, currentPrice)) {
    logger.info({ symbol, entry: position.avgEntryPrice, current: currentPrice }, "Paper take-profit triggered");
    await executeSell(symbol, currentPrice);
    return "take_profit";
  }

  return null;
}

export interface PortfolioSnapshot {
  startingCapital: number;
  cash: number;
  equity: number;
  pnl: number;
  pnlPercent: number;
  positions: Array<{
    symbol: string;
    quantity: number;
    avgEntryPrice: number;
    currentPrice: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
    openedAt: string;
  }>;
  trades: Array<{
    id: number;
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    value: number;
    realizedPnl: number | null;
    timestamp: string;
  }>;
  totalTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalRealizedPnl: number;
}

export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const portfolio = await ensurePortfolio();
  const openPositions = await db.select().from(positionsTable);
  const allTrades = await db.select().from(tradesTable).orderBy(desc(tradesTable.createdAt));

  const positions = openPositions.map((pos) => {
    const currentPrice = lastPrices.get(pos.symbol) ?? pos.avgEntryPrice;
    const marketValue = pos.quantity * currentPrice;
    const cost = pos.quantity * pos.avgEntryPrice;
    const unrealizedPnl = marketValue - cost;
    const unrealizedPnlPercent = cost > 0 ? (unrealizedPnl / cost) * 100 : 0;
    return {
      symbol: pos.symbol,
      quantity: pos.quantity,
      avgEntryPrice: pos.avgEntryPrice,
      currentPrice,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent,
      openedAt: pos.openedAt.toISOString(),
    };
  });

  const positionValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const equity = portfolio.cash + positionValue;
  const pnl = equity - portfolio.startingCapital;
  const pnlPercent = (pnl / portfolio.startingCapital) * 100;

  const sells = allTrades.filter((t) => t.side === "SELL" && t.realizedPnl !== null);
  const wins = sells.filter((t) => (t.realizedPnl ?? 0) > 0).length;
  const losses = sells.filter((t) => (t.realizedPnl ?? 0) <= 0).length;
  const winRate = sells.length > 0 ? (wins / sells.length) * 100 : 0;
  const totalRealizedPnl = sells.reduce((sum, t) => sum + (t.realizedPnl ?? 0), 0);

  return {
    startingCapital: portfolio.startingCapital,
    cash: portfolio.cash,
    equity,
    pnl,
    pnlPercent,
    positions,
    trades: allTrades.slice(0, 50).map((t) => ({
      id: t.id,
      symbol: t.symbol,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      value: t.value,
      realizedPnl: t.realizedPnl,
      timestamp: t.createdAt.toISOString(),
    })),
    totalTrades: allTrades.length,
    closedTrades: sells.length,
    wins,
    losses,
    winRate,
    totalRealizedPnl,
  };
}

export async function resetPortfolio(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(tradesTable);
    await tx.delete(positionsTable);
    await tx.delete(portfolioTable);
  });
  logger.info("Paper portfolio reset");
}
