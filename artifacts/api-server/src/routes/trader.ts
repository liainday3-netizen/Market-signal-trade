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
  ma20: number;
  emaFast: number;
  emaSlow: number;
  volatility: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  bbUpper: number;
  bbLower: number;
  bbPct: number;
  atr: number;
  stochK: number;
  stochD: number;
  momentum: number;
  zScore: number;
  volumeTrend: number;
}

interface FactorScores {
  trend: number;
  momentum: number;
  meanReversion: number;
  volatility: number;
  volume: number;
  composite: number;
}

interface BacktestStats {
  winRate: number;
  avgReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  profitFactor: number;
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

// ─── Indicator Library ───────────────────────────────────────────────────────

/** Exponential moving average using standard 2/(n+1) smoothing factor */
function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

/** Wilder's smoothed RSI (proper EMA with alpha = 1/period) */
function rsi(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  const diffs = closes.slice(1).map((c, i) => c - closes[i]);
  let avgGain = diffs.slice(0, period).filter((d) => d > 0).reduce((a, b) => a + b, 0) / period;
  let avgLoss = diffs.slice(0, period).filter((d) => d < 0).reduce((a, b) => a + Math.abs(b), 0) / period;
  for (let i = period; i < diffs.length; i++) {
    const gain = diffs[i] > 0 ? diffs[i] : 0;
    const loss = diffs[i] < 0 ? Math.abs(diffs[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Bollinger Bands — SMA ± k*std over `period` */
function bollingerBands(closes: number[], period: number, k: number): { upper: number; lower: number; middle: number } {
  const window = closes.slice(-period);
  const middle = window.reduce((a, b) => a + b, 0) / period;
  const variance = window.reduce((a, b) => a + (b - middle) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return { upper: middle + k * std, lower: middle - k * std, middle };
}

/** Average True Range using Wilder's smoothing */
function atr(candles: OHLCVRow[], period: number): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hcp = Math.abs(candles[i].high - candles[i - 1].close);
    const lcp = Math.abs(candles[i].low - candles[i - 1].close);
    trs.push(Math.max(hl, hcp, lcp));
  }
  let smoothed = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    smoothed = (smoothed * (period - 1) + trs[i]) / period;
  }
  return smoothed;
}

/** Fast Stochastic %K and %D */
function stochastic(candles: OHLCVRow[], kPeriod: number, dPeriod: number): { k: number; d: number } {
  if (candles.length < kPeriod) return { k: 50, d: 50 };
  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const window = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...window.map((c) => c.high));
    const low = Math.min(...window.map((c) => c.low));
    const k = high === low ? 50 : ((candles[i].close - low) / (high - low)) * 100;
    kValues.push(k);
  }
  const k = kValues[kValues.length - 1];
  const d = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / Math.min(dPeriod, kValues.length);
  return { k, d };
}

/** On-Balance Volume slope (positive = accumulation) */
function volumeTrend(candles: OHLCVRow[], period: number): number {
  const slice = candles.slice(-period - 1);
  let obv = 0;
  const obvSeries: number[] = [0];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].close > slice[i - 1].close) obv += slice[i].volume;
    else if (slice[i].close < slice[i - 1].close) obv -= slice[i].volume;
    obvSeries.push(obv);
  }
  const n = obvSeries.length;
  if (n < 2) return 0;
  const slope = (obvSeries[n - 1] - obvSeries[0]) / n;
  const maxAbs = Math.max(...obvSeries.map(Math.abs)) || 1;
  return Math.max(-1, Math.min(1, slope / maxAbs));
}

// ─── Full Quantitative Feature Set ───────────────────────────────────────────

function computeFeatures(candles: OHLCVRow[]): Features & { price: number } {
  const closes = candles.map((c) => c.close);
  const n = closes.length;

  // Returns
  const rawReturns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
  const recentReturns10 = rawReturns.slice(-10);
  const avgReturn = recentReturns10.reduce((a, b) => a + b, 0) / recentReturns10.length;

  // MA20
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;

  // EMAs (fast=12, slow=26)
  const emaFastSeries = ema(closes, 12);
  const emaSlowSeries = ema(closes, 26);
  const emaFast = emaFastSeries[emaFastSeries.length - 1];
  const emaSlow = emaSlowSeries[emaSlowSeries.length - 1];

  // Volatility (annualized over 10-period)
  const variance = recentReturns10.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / recentReturns10.length;
  const volatility = Math.sqrt(variance);

  // RSI (14, Wilder smoothed)
  const rsiVal = rsi(closes, 14);

  // MACD + Signal line (9-period EMA of MACD)
  const macdLine = emaFast - emaSlow;
  const macdSeries = emaFastSeries.map((f, i) => {
    const slowIdx = i - (emaFastSeries.length - emaSlowSeries.length);
    return slowIdx >= 0 ? f - emaSlowSeries[slowIdx] : 0;
  }).filter((_, i) => i >= emaFastSeries.length - emaSlowSeries.length);
  const macdSignalSeries = ema(macdSeries, 9);
  const macdSignal = macdSignalSeries[macdSignalSeries.length - 1];
  const macdHist = macdLine - macdSignal;

  // Bollinger Bands (20, 2σ)
  const bb = bollingerBands(closes, 20, 2);
  const currentPrice = closes[n - 1];
  const bbPct = bb.upper === bb.lower ? 0.5 : (currentPrice - bb.lower) / (bb.upper - bb.lower);

  // ATR (14)
  const atrVal = atr(candles, 14);

  // Stochastic (14, 3)
  const { k: stochK, d: stochD } = stochastic(candles, 14, 3);

  // Momentum (10-period)
  const momentum = n >= 11 ? (closes[n - 1] / closes[n - 11] - 1) : 0;

  // Z-score of price vs 20 SMA
  const window20 = closes.slice(-20);
  const std20 = Math.sqrt(window20.reduce((a, b) => a + (b - ma20) ** 2, 0) / 20);
  const zScore = std20 > 0 ? (currentPrice - ma20) / std20 : 0;

  // Volume trend (OBV normalized)
  const volTrend = volumeTrend(candles, 20);

  return {
    returns: avgReturn,
    ma20,
    emaFast,
    emaSlow,
    volatility,
    rsi: rsiVal,
    macd: macdLine,
    macdSignal,
    macdHist,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    bbPct,
    atr: atrVal,
    stochK,
    stochD,
    momentum,
    zScore,
    volumeTrend: volTrend,
    price: currentPrice,
  };
}

// ─── Multi-Factor Quantitative Model ─────────────────────────────────────────
// Each factor produces a score in [-1, +1] where +1 = strong bullish

function clamp(v: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function computeFactorScores(features: Features): FactorScores {
  // 1. TREND: EMA crossover + MACD histogram direction
  const emaCrossScore = clamp((features.emaFast - features.emaSlow) / features.ma20 * 50);
  const macdHistScore = clamp(features.macdHist / (Math.abs(features.macd) || 1));
  const trend = clamp(emaCrossScore * 0.6 + macdHistScore * 0.4);

  // 2. MOMENTUM: Rate of change + Stochastic direction
  const momentumScore = clamp(features.momentum * 20);
  const stochScore = clamp((features.stochK - 50) / 50);
  const momentum = clamp(momentumScore * 0.6 + stochScore * 0.4);

  // 3. MEAN REVERSION: RSI extremes + Bollinger %B + Z-score
  // RSI: oversold (<30) = bullish (+1), overbought (>70) = bearish (-1)
  const rsiScore = clamp(-((features.rsi - 50) / 30));
  // Bollinger: below lower band = bullish, above upper = bearish
  const bbScore = clamp(-(features.bbPct - 0.5) * 4);
  // Z-score: extreme negative = bullish (mean reversion)
  const zScore = clamp(-features.zScore / 2);
  const meanReversion = clamp(rsiScore * 0.4 + bbScore * 0.3 + zScore * 0.3);

  // 4. VOLATILITY REGIME: Low ATR/price = trending, high = uncertain
  const atrPct = features.atr / features.ma20;
  // Normalize: 0.5% ATR is "normal" for BTC; higher = higher uncertainty → penalize
  const volScore = clamp(1 - atrPct * 100);

  // 5. VOLUME CONFIRMATION
  const volume = clamp(features.volumeTrend);

  // COMPOSITE: weighted average (trend heavy, then momentum, then mean reversion)
  const composite = clamp(
    trend * 0.30 +
    momentum * 0.25 +
    meanReversion * 0.25 +
    volScore * 0.10 +
    volume * 0.10
  );

  return {
    trend: Math.round(trend * 1000) / 1000,
    momentum: Math.round(momentum * 1000) / 1000,
    meanReversion: Math.round(meanReversion * 1000) / 1000,
    volatility: Math.round(volScore * 1000) / 1000,
    volume: Math.round(volume * 1000) / 1000,
    composite: Math.round(composite * 1000) / 1000,
  };
}

function signalFromFactors(factors: FactorScores): { signal: "BUY" | "SELL" | "HOLD"; confidence: number } {
  const score = factors.composite;
  // Map [-1, +1] to probability [0, 1]
  const confidence = Math.round((score + 1) / 2 * 1000) / 1000;

  let signal: "BUY" | "SELL" | "HOLD";
  if (score > 0.15) signal = "BUY";
  else if (score < -0.15) signal = "SELL";
  else signal = "HOLD";

  return { signal, confidence };
}

// ─── Walk-Forward Backtester ──────────────────────────────────────────────────

function runBacktest(candles: OHLCVRow[]): BacktestStats {
  const startAt = 30; // need enough history for indicators
  const tradeReturns: number[] = [];
  let grossGains = 0;
  let grossLosses = 0;
  let peak = 1;
  let equity = 1;
  let maxDrawdown = 0;

  for (let i = startAt; i < candles.length - 1; i++) {
    const slice = candles.slice(0, i + 1);
    const feat = computeFeatures(slice);
    const factors = computeFactorScores(feat);
    const { signal } = signalFromFactors(factors);
    if (signal === "HOLD") continue;

    const entryPrice = candles[i].close;
    const exitPrice = candles[i + 1].close;
    const ret = (exitPrice - entryPrice) / entryPrice * (signal === "BUY" ? 1 : -1);
    tradeReturns.push(ret);

    equity *= 1 + ret;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;

    if (ret > 0) grossGains += ret;
    else grossLosses += Math.abs(ret);
  }

  if (tradeReturns.length === 0) {
    return { winRate: 0, avgReturn: 0, sharpeRatio: 0, maxDrawdown: 0, totalTrades: 0, profitFactor: 0 };
  }

  const wins = tradeReturns.filter((r) => r > 0).length;
  const winRate = wins / tradeReturns.length;
  const avgReturn = tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length;
  const variance = tradeReturns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / tradeReturns.length;
  const stdReturn = Math.sqrt(variance);
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
  const profitFactor = grossLosses > 0 ? grossGains / grossLosses : grossGains > 0 ? 999 : 0;

  return {
    winRate: Math.round(winRate * 1000) / 1000,
    avgReturn: Math.round(avgReturn * 100000) / 100000,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 1000) / 1000,
    totalTrades: tradeReturns.length,
    profitFactor: Math.round(profitFactor * 100) / 100,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get("/signal", async (req, res) => {
  try {
    const symbol = (req.query["symbol"] as string) ?? "BTC/USDT";
    const timeframe = (req.query["timeframe"] as string) ?? "1m";

    const candles = await fetchOHLCV(symbol, timeframe, 100);
    if (candles.length < 35) {
      res.status(500).json({ error: "Not enough market data" });
      return;
    }

    const { price, ...features } = computeFeatures(candles);
    const factorScores = computeFactorScores(features);
    const { signal, confidence } = signalFromFactors(factorScores);
    const backtest = runBacktest(candles);

    const record = {
      signal,
      confidence,
      price,
      symbol,
      timeframe,
      returns: features.returns,
      ma: features.ma20,
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
      factorScores,
      backtest,
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
