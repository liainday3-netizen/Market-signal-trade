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

  _exchange = new ccxt["coinbaseadvanced"]({
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
  return getBalanceField(raw, "free", "USDC") || getBalanceField(raw, "free", "USD");
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
