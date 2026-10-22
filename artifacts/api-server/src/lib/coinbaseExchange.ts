import ccxt, { type Order, type Balances } from "ccxt";
import { logger } from "./logger";

export interface ExchangeBalance {
  total: number;
  free: number;
  used: number;
  currency: string;
}

export interface ExchangeOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  amount: number;
  price: number;
  cost: number;
  status: string;
  filled: number;
  timestamp: number;
}

type AnyExchange = InstanceType<typeof ccxt["coinbaseadvanced"]>;

let _exchange: AnyExchange | null = null;

// ─── Symbol translation ───────────────────────────────────────────────────────
// The quant engine uses Binance-style pairs (BTC/USDT, ETH/USDT, SOL/USDT).
// Coinbase Advanced Trade uses USD pairs — translate before every exchange call.
const COIN_SYMBOL_MAP: Record<string, string> = {
  "BTC/USDT": "BTC/USD",
  "ETH/USDT": "ETH/USD",
  "SOL/USDT": "SOL/USD",
};

export function toExchangeSymbol(symbol: string): string {
  return COIN_SYMBOL_MAP[symbol] ?? symbol;
}

export function isConfigured(): boolean {
  return !!(process.env.COINBASE_API_KEY && process.env.COINBASE_API_SECRET);
}

export function getExchange(): AnyExchange {
  if (_exchange) return _exchange;

  const apiKey = process.env.COINBASE_API_KEY;
  const apiSecret = process.env.COINBASE_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("Coinbase API keys not configured. Set COINBASE_API_KEY and COINBASE_API_SECRET.");
  }

  // Secrets stored in Replit may have literal \n instead of real newlines,
  // and may have leading/trailing whitespace — normalise both
  const cleanKey = apiKey.trim();
  const cleanSecret = apiSecret.trim().replace(/\\n/g, "\n");

  _exchange = new ccxt["coinbaseadvanced"]({
    apiKey: cleanKey,
    secret: cleanSecret,
    enableRateLimit: true,
    options: {
      defaultType: "spot",
      // Skip the slow /v2/currencies/crypto endpoint that times out in production
      fetchCurrencies: false,
    },
  });

  logger.info("Coinbase Advanced Trade exchange initialised");

  // Pre-warm markets in the background so the first trade call doesn't block
  _exchange.loadMarkets().catch((err: unknown) => {
    logger.warn({ err }, "Coinbase: market pre-warm failed (non-fatal, will retry on first trade)");
  });

  return _exchange;
}

export function resetExchange() {
  _exchange = null;
}

function getBalanceField(raw: Balances, field: "free" | "used" | "total", currency: string): number {
  const dict = (raw[field] as unknown) as Record<string, number> | undefined;
  return dict?.[currency] ?? 0;
}

export async function fetchBalances(): Promise<ExchangeBalance[]> {
  const ex = getExchange();
  const raw = await ex.fetchBalance();
  const result: ExchangeBalance[] = [];
  const totals = (raw["total"] as unknown) as Record<string, number> | undefined;
  for (const [currency, total] of Object.entries(totals ?? {})) {
    if ((total as number) > 0) {
      result.push({
        currency,
        total: total as number,
        free: getBalanceField(raw, "free", currency),
        used: getBalanceField(raw, "used", currency),
      });
    }
  }
  return result;
}

export async function fetchUsdcBalance(): Promise<number> {
  const ex = getExchange();
  const raw = await ex.fetchBalance();
  // Coinbase accounts hold USD (not USDT). Check USD first, then USDC as fallback.
  return (
    getBalanceField(raw, "free", "USD") ||
    getBalanceField(raw, "free", "USDC") ||
    getBalanceField(raw, "free", "USDT")
  );
}

/**
 * Market BUY spending `usdAmount` of quote currency.
 * Coinbase Advanced requires market buys to be expressed as a cost (quote
 * amount); passing a base quantity without a price throws InvalidOrder in ccxt.
 */
export async function placeMarketBuy(symbol: string, usdAmount: number): Promise<ExchangeOrder> {
  const ex = getExchange();
  const cbSymbol = toExchangeSymbol(symbol); // e.g. BTC/USDT → BTC/USD
  logger.info({ symbol, cbSymbol, usdAmount }, "Placing real market BUY (by cost)");
  const order = await ex.createMarketBuyOrderWithCost(cbSymbol, usdAmount);
  return resolveFill(cbSymbol, normaliseOrder(order));
}

export async function placeMarketSell(symbol: string, quantity: number): Promise<ExchangeOrder> {
  const ex = getExchange();
  const cbSymbol = toExchangeSymbol(symbol); // e.g. BTC/USDT → BTC/USD
  await ex.loadMarkets();
  const amount = Number(ex.amountToPrecision(cbSymbol, quantity));
  if (!(amount > 0)) throw new Error(`Sell amount ${quantity} rounds to zero for ${cbSymbol}`);
  logger.info({ symbol, cbSymbol, quantity: amount }, "Placing real market SELL");
  const order = await ex.createMarketSellOrder(cbSymbol, amount);
  return resolveFill(cbSymbol, normaliseOrder(order));
}

/**
 * Market orders are often acknowledged before they fill. Poll the order a few
 * times so we record the real filled quantity and average price.
 */
async function resolveFill(cbSymbol: string, order: ExchangeOrder): Promise<ExchangeOrder> {
  if (!order.id || (order.filled > 0 && order.price > 0 && order.status === "closed")) return order;
  const ex = getExchange();
  let latest = order;
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    try {
      latest = normaliseOrder(await ex.fetchOrder(order.id, cbSymbol));
      if (latest.status === "closed" || latest.status === "canceled" || latest.status === "rejected") break;
    } catch (err) {
      logger.warn({ err, orderId: order.id }, "Coinbase: fetchOrder failed while resolving fill");
    }
  }
  if (latest.status === "canceled" || latest.status === "rejected") {
    throw new Error(`Order ${order.id} ${latest.status} by exchange`);
  }
  return latest;
}

export async function fetchOpenOrders(symbol?: string): Promise<ExchangeOrder[]> {
  const ex = getExchange();
  const orders = await ex.fetchOpenOrders(symbol);
  return orders.map(normaliseOrder);
}

function normaliseOrder(o: Order): ExchangeOrder {
  return {
    id: o.id ?? "",
    symbol: o.symbol ?? "",
    side: (o.side ?? "buy") as "buy" | "sell",
    type: o.type ?? "market",
    amount: o.amount ?? 0,
    price: o.average ?? o.price ?? 0,
    cost: o.cost ?? 0,
    status: o.status ?? "unknown",
    filled: o.filled ?? 0,
    timestamp: o.timestamp ?? Date.now(),
  };
}
