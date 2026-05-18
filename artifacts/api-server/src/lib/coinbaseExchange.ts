import * as ccxt from "ccxt";
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

let _exchange: ccxt.coinbaseadvanced | null = null;

export function isConfigured(): boolean {
  return !!(process.env.COINBASE_API_KEY && process.env.COINBASE_API_SECRET);
}

export function getExchange(): ccxt.coinbaseadvanced {
  if (_exchange) return _exchange;

  const apiKey = process.env.COINBASE_API_KEY;
  const apiSecret = process.env.COINBASE_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("Coinbase API keys not configured. Set COINBASE_API_KEY and COINBASE_API_SECRET.");
  }

  _exchange = new ccxt.coinbaseadvanced({
    apiKey,
    apiSecret,
    enableRateLimit: true,
    options: { defaultType: "spot" },
  });

  logger.info("Coinbase Advanced Trade exchange initialised");
  return _exchange;
}

export function resetExchange() {
  _exchange = null;
}

export async function fetchBalances(): Promise<ExchangeBalance[]> {
  const ex = getExchange();
  const raw = await ex.fetchBalance();
  const result: ExchangeBalance[] = [];
  for (const [currency, info] of Object.entries(raw.total ?? {})) {
    const total = info as number;
    if (total > 0) {
      result.push({
        currency,
        total,
        free: (raw.free?.[currency] as number) ?? 0,
        used: (raw.used?.[currency] as number) ?? 0,
      });
    }
  }
  return result;
}

export async function fetchUsdcBalance(): Promise<number> {
  const ex = getExchange();
  const raw = await ex.fetchBalance();
  return (raw.free?.["USDC"] as number) ?? (raw.free?.["USD"] as number) ?? 0;
}

export async function placeMarketBuy(symbol: string, usdcAmount: number): Promise<ExchangeOrder> {
  const ex = getExchange();
  const ticker = await ex.fetchTicker(symbol);
  const price = ticker.last ?? ticker.bid ?? 0;
  if (!price) throw new Error(`Cannot determine price for ${symbol}`);

  const quantity = usdcAmount / price;

  logger.info({ symbol, usdcAmount, quantity, price }, "Placing real market BUY");
  const order = await ex.createMarketBuyOrder(symbol, quantity);
  return normaliseOrder(order);
}

export async function placeMarketSell(symbol: string, quantity: number): Promise<ExchangeOrder> {
  const ex = getExchange();
  logger.info({ symbol, quantity }, "Placing real market SELL");
  const order = await ex.createMarketSellOrder(symbol, quantity);
  return normaliseOrder(order);
}

export async function fetchOpenOrders(symbol?: string): Promise<ExchangeOrder[]> {
  const ex = getExchange();
  const orders = await ex.fetchOpenOrders(symbol);
  return orders.map(normaliseOrder);
}

function normaliseOrder(o: ccxt.pro.Order): ExchangeOrder {
  return {
    id: o.id,
    symbol: o.symbol,
    side: o.side as "buy" | "sell",
    type: o.type,
    amount: o.amount,
    price: o.average ?? o.price ?? 0,
    cost: o.cost ?? 0,
    status: o.status,
    filled: o.filled ?? 0,
    timestamp: o.timestamp ?? Date.now(),
  };
}
