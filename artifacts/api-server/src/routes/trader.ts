import { Router, type IRouter } from "express";
import { db, signalsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

interface OHLCVRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Features {
  returns: number;
  ma: number;
  volatility: number;
  rsi: number;
  macd: number;
}

const BINANCE_SYMBOL_MAP: Record<string, string> = {
  "BTC/USDT": "BTCUSDT",
  "ETH/USDT": "ETHUSDT",
  "SOL/USDT": "SOLUSDT",
  "BNB/USDT": "BNBUSDT",
};

async function fetchOHLCV(symbol: string, timeframe: string, limit: number): Promise<OHLCVRow[]> {
  const symbolEncoded = BINANCE_SYMBOL_MAP[symbol] ?? symbol.replace("/", "");
  const intervalMap: Record<string, string> = {
    "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d",
  };
  const interval = intervalMap[timeframe] ?? "1m";
  const url = `https://api.binance.us/api/v3/klines?symbol=${symbolEncoded}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const raw = (await res.json()) as unknown[][];
  return raw.map((c) => ({
    time: c[0] as number,
    open: parseFloat(c[1] as string),
    high: parseFloat(c[2] as string),
    low: parseFloat(c[3] as string),
    close: parseFloat(c[4] as string),
    volume: parseFloat(c[5] as string),
  }));
}

function computeFeatures(candles: OHLCVRow[]): Features & { price: number } {
  const closes = candles.map((c) => c.close);
  const n = closes.length;

  const returns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);

  const window = 10;
  const recentReturns = returns.slice(-window);
  const avgReturn = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;

  const maWindow = closes.slice(-window);
  const ma = maWindow.reduce((a, b) => a + b, 0) / window;

  const variance = recentReturns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / recentReturns.length;
  const volatility = Math.sqrt(variance);

  const rsiPeriod = 14;
  let gains = 0, losses = 0;
  const rsiSlice = returns.slice(-rsiPeriod);
  rsiSlice.forEach((r) => { if (r > 0) gains += r; else losses -= r; });
  const rs = losses === 0 ? 100 : gains / losses;
  const rsi = 100 - 100 / (1 + rs);

  const shortPeriod = 12, longPeriod = 26;
  const shortEma = closes.slice(-shortPeriod).reduce((a, b) => a + b, 0) / shortPeriod;
  const longEma = closes.slice(-longPeriod).reduce((a, b) => a + b, 0) / longPeriod;
  const macd = shortEma - longEma;

  return {
    returns: avgReturn,
    ma,
    volatility,
    rsi,
    macd,
    price: closes[n - 1],
  };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function relu(x: number): number {
  return Math.max(0, x);
}

function runModel(features: Features): { signal: "BUY" | "SELL" | "HOLD"; confidence: number } {
  const SEED = 42;
  function pseudoRand(i: number, j: number): number {
    const val = Math.sin(SEED + i * 13.37 + j * 7.11) * 43758.5453;
    return val - Math.floor(val);
  }

  const inputs = [
    features.returns * 100,
    (features.ma - 50000) / 50000,
    features.volatility * 100,
    (features.rsi - 50) / 50,
    features.macd / 1000,
  ];

  const hiddenSize = 32;
  const inputSize = 5;

  let hidden = Array(hiddenSize).fill(0) as number[];
  for (let j = 0; j < hiddenSize; j++) {
    let sum = pseudoRand(inputSize, j) * 0.1 - 0.05;
    for (let i = 0; i < inputSize; i++) {
      sum += inputs[i] * (pseudoRand(i, j) * 2 - 1) * 0.3;
    }
    hidden[j] = relu(sum);
  }

  let output = pseudoRand(hiddenSize, 0) * 0.1;
  for (let j = 0; j < hiddenSize; j++) {
    output += hidden[j] * (pseudoRand(j, hiddenSize) * 2 - 1) * 0.05;
  }

  const rawPred = sigmoid(output + features.returns * 50 + (features.rsi - 50) * 0.02);
  const confidence = Math.round(rawPred * 1000) / 1000;

  let signal: "BUY" | "SELL" | "HOLD";
  if (confidence > 0.57) signal = "BUY";
  else if (confidence < 0.43) signal = "SELL";
  else signal = "HOLD";

  return { signal, confidence };
}

router.get("/signal", async (req, res) => {
  try {
    const symbol = (req.query["symbol"] as string) ?? "BTC/USDT";
    const timeframe = (req.query["timeframe"] as string) ?? "1m";

    const candles = await fetchOHLCV(symbol, timeframe, 100);
    if (candles.length < 30) {
      res.status(500).json({ error: "Not enough market data" });
      return;
    }

    const { price, ...features } = computeFeatures(candles);
    const { signal, confidence } = runModel(features);

    const record = {
      signal,
      confidence,
      price,
      symbol,
      timeframe,
      returns: features.returns,
      ma: features.ma,
      volatility: features.volatility,
      rsi: features.rsi,
      macd: features.macd,
    };

    await db.insert(signalsTable).values(record);

    res.json({
      signal,
      confidence,
      price,
      symbol,
      timeframe,
      timestamp: new Date().toISOString(),
      features,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching signal");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/history", async (req, res) => {
  try {
    const limit = Math.min(parseInt((req.query["limit"] as string) ?? "50", 10), 200);
    const symbol = (req.query["symbol"] as string) ?? "BTC/USDT";

    const records = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.symbol, symbol))
      .orderBy(desc(signalsTable.createdAt))
      .limit(limit);

    res.json(records);
  } catch (err) {
    req.log.error({ err }, "Error fetching history");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/market", async (req, res) => {
  try {
    const symbol = (req.query["symbol"] as string) ?? "BTC/USDT";
    const timeframe = (req.query["timeframe"] as string) ?? "1m";
    const limit = Math.min(parseInt((req.query["limit"] as string) ?? "50", 10), 200);

    const candles = await fetchOHLCV(symbol, timeframe, limit);
    res.json(candles);
  } catch (err) {
    req.log.error({ err }, "Error fetching market data");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
