import { db, signalsTable } from "@workspace/db";
import { logger } from "./logger";

// ─── Re-export trading engine (same logic as routes/trader.ts) ───────────────

interface OHLCVRow { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface Features { returns: number; ma20: number; emaFast: number; emaSlow: number; volatility: number; rsi: number; macd: number; macdSignal: number; macdHist: number; bbUpper: number; bbLower: number; bbPct: number; atr: number; stochK: number; stochD: number; momentum: number; zScore: number; volumeTrend: number; }
interface FactorScores { trend: number; momentum: number; meanReversion: number; volatility: number; volume: number; composite: number; }

export interface RecentSignal {
  symbol: string;
  signal: string;
  confidence: number;
  price: number;
  composite: number;
  timestamp: string;
}

const BINANCE_SYMBOL_MAP: Record<string, string> = {
  "BTC/USDT": "BTCUSDT", "ETH/USDT": "ETHUSDT", "SOL/USDT": "SOLUSDT", "BNB/USDT": "BNBUSDT",
};

async function fetchOHLCV(symbol: string, timeframe: string, limit: number): Promise<OHLCVRow[]> {
  const sym = BINANCE_SYMBOL_MAP[symbol] ?? symbol.replace("/", "");
  const intervalMap: Record<string, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h" };
  const interval = intervalMap[timeframe] ?? "1m";
  const url = `https://api.binance.us/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const raw = (await res.json()) as unknown[][];
  return raw.map((c) => ({
    time: c[0] as number, open: parseFloat(c[1] as string), high: parseFloat(c[2] as string),
    low: parseFloat(c[3] as string), close: parseFloat(c[4] as string), volume: parseFloat(c[5] as string),
  }));
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(prev);
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); result.push(prev); }
  return result;
}

function rsi(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  const diffs = closes.slice(1).map((c, i) => c - closes[i]);
  let avgGain = diffs.slice(0, period).filter((d) => d > 0).reduce((a, b) => a + b, 0) / period;
  let avgLoss = diffs.slice(0, period).filter((d) => d < 0).reduce((a, b) => a + Math.abs(b), 0) / period;
  for (let i = period; i < diffs.length; i++) {
    avgGain = (avgGain * (period - 1) + (diffs[i] > 0 ? diffs[i] : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diffs[i] < 0 ? Math.abs(diffs[i]) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function computeFeatures(candles: OHLCVRow[]): Features & { price: number } {
  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const rawReturns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
  const recentReturns10 = rawReturns.slice(-10);
  const avgReturn = recentReturns10.reduce((a, b) => a + b, 0) / recentReturns10.length;
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const emaFastSeries = ema(closes, 12);
  const emaSlowSeries = ema(closes, 26);
  const emaFast = emaFastSeries[emaFastSeries.length - 1];
  const emaSlow = emaSlowSeries[emaSlowSeries.length - 1];
  const variance = recentReturns10.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / recentReturns10.length;
  const volatility = Math.sqrt(variance);
  const rsiVal = rsi(closes, 14);
  const macdLine = emaFast - emaSlow;
  const macdSeries = emaFastSeries.map((f, i) => {
    const slowIdx = i - (emaFastSeries.length - emaSlowSeries.length);
    return slowIdx >= 0 ? f - emaSlowSeries[slowIdx] : 0;
  }).filter((_, i) => i >= emaFastSeries.length - emaSlowSeries.length);
  const macdSignalSeries = ema(macdSeries, 9);
  const macdSignal = macdSignalSeries[macdSignalSeries.length - 1];
  const macdHist = macdLine - macdSignal;
  const w20 = closes.slice(-20);
  const std20 = Math.sqrt(w20.reduce((a, b) => a + (b - ma20) ** 2, 0) / 20);
  const bbUpper = ma20 + 2 * std20, bbLower = ma20 - 2 * std20;
  const currentPrice = closes[n - 1];
  const bbPct = bbUpper === bbLower ? 0.5 : (currentPrice - bbLower) / (bbUpper - bbLower);
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
  }
  let atrVal = trs.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  for (let i = 14; i < trs.length; i++) atrVal = (atrVal * 13 + trs[i]) / 14;
  const kPeriod = 14;
  const kVals: number[] = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const w = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...w.map((c) => c.high));
    const low = Math.min(...w.map((c) => c.low));
    kVals.push(high === low ? 50 : ((candles[i].close - low) / (high - low)) * 100);
  }
  const stochK = kVals[kVals.length - 1];
  const stochD = kVals.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, kVals.length);
  const momentum = n >= 11 ? (closes[n - 1] / closes[n - 11] - 1) : 0;
  const zScore = std20 > 0 ? (currentPrice - ma20) / std20 : 0;
  let obv = 0;
  const obvSeries: number[] = [0];
  const volSlice = candles.slice(-21);
  for (let i = 1; i < volSlice.length; i++) {
    obv += volSlice[i].close > volSlice[i - 1].close ? volSlice[i].volume : volSlice[i].close < volSlice[i - 1].close ? -volSlice[i].volume : 0;
    obvSeries.push(obv);
  }
  const maxAbs = Math.max(...obvSeries.map(Math.abs)) || 1;
  const volumeTrend = Math.max(-1, Math.min(1, (obvSeries[obvSeries.length - 1] - obvSeries[0]) / maxAbs / obvSeries.length));
  return { returns: avgReturn, ma20, emaFast, emaSlow, volatility, rsi: rsiVal, macd: macdLine, macdSignal, macdHist, bbUpper, bbLower, bbPct, atr: atrVal, stochK, stochD, momentum, zScore, volumeTrend, price: currentPrice };
}

function clamp(v: number, min = -1, max = 1) { return Math.max(min, Math.min(max, v)); }

function computeFactorScores(features: Features): FactorScores {
  const emaCrossScore = clamp((features.emaFast - features.emaSlow) / features.ma20 * 50);
  const macdHistScore = clamp(features.macdHist / (Math.abs(features.macd) || 1));
  const trend = clamp(emaCrossScore * 0.6 + macdHistScore * 0.4);
  const momentumScore = clamp(features.momentum * 20);
  const stochScore = clamp((features.stochK - 50) / 50);
  const momentum = clamp(momentumScore * 0.6 + stochScore * 0.4);
  const rsiScore = clamp(-((features.rsi - 50) / 30));
  const bbScore = clamp(-(features.bbPct - 0.5) * 4);
  const zScore = clamp(-features.zScore / 2);
  const meanReversion = clamp(rsiScore * 0.4 + bbScore * 0.3 + zScore * 0.3);
  const atrPct = features.atr / features.ma20;
  const volatility = clamp(1 - atrPct * 100);
  const volume = clamp(features.volumeTrend);
  const composite = clamp(trend * 0.30 + momentum * 0.25 + meanReversion * 0.25 + volatility * 0.10 + volume * 0.10);
  return {
    trend: Math.round(trend * 1000) / 1000,
    momentum: Math.round(momentum * 1000) / 1000,
    meanReversion: Math.round(meanReversion * 1000) / 1000,
    volatility: Math.round(volatility * 1000) / 1000,
    volume: Math.round(volume * 1000) / 1000,
    composite: Math.round(composite * 1000) / 1000,
  };
}

function signalFromFactors(factors: FactorScores): { signal: "BUY" | "SELL" | "HOLD"; confidence: number } {
  const score = factors.composite;
  const confidence = Math.round((score + 1) / 2 * 1000) / 1000;
  const signal: "BUY" | "SELL" | "HOLD" = score > 0.15 ? "BUY" : score < -0.15 ? "SELL" : "HOLD";
  return { signal, confidence };
}

// ─── Auto-Trader State ────────────────────────────────────────────────────────

export interface AutoTraderState {
  isRunning: boolean;
  intervalSeconds: number;
  totalRuns: number;
  signalsGenerated: number;
  lastRun: string | null;
  nextRun: string | null;
  activeSymbols: string[];
  lastSignals: RecentSignal[];
}

const DEFAULT_SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
const DEFAULT_TIMEFRAME = "1m";
const DEFAULT_INTERVAL_S = 60;
const MAX_RECENT_SIGNALS = 20;

let state: AutoTraderState = {
  isRunning: false,
  intervalSeconds: DEFAULT_INTERVAL_S,
  totalRuns: 0,
  signalsGenerated: 0,
  lastRun: null,
  nextRun: null,
  activeSymbols: DEFAULT_SYMBOLS,
  lastSignals: [],
};

let timer: ReturnType<typeof setInterval> | null = null;

async function runCycle() {
  const runStart = new Date().toISOString();
  state.totalRuns++;
  state.lastRun = runStart;
  state.nextRun = new Date(Date.now() + state.intervalSeconds * 1000).toISOString();

  logger.info({ totalRuns: state.totalRuns }, "Auto-trader cycle started");

  const results = await Promise.allSettled(
    state.activeSymbols.map(async (symbol) => {
      const candles = await fetchOHLCV(symbol, DEFAULT_TIMEFRAME, 100);
      if (candles.length < 35) throw new Error("Not enough candles");
      const { price, ...features } = computeFeatures(candles);
      const factors = computeFactorScores(features);
      const { signal, confidence } = signalFromFactors(factors);

      await db.insert(signalsTable).values({
        signal, confidence, price, symbol,
        timeframe: DEFAULT_TIMEFRAME,
        returns: features.returns,
        ma: features.ma20,
        volatility: features.volatility,
        rsi: features.rsi,
        macd: features.macd,
      });

      const recent: RecentSignal = {
        symbol, signal, confidence, price,
        composite: factors.composite,
        timestamp: new Date().toISOString(),
      };

      state.signalsGenerated++;
      state.lastSignals = [recent, ...state.lastSignals].slice(0, MAX_RECENT_SIGNALS);

      logger.info({ symbol, signal, confidence, price, composite: factors.composite }, "Signal generated");
      return recent;
    })
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    failures.forEach((f) => logger.warn({ err: (f as PromiseRejectedResult).reason }, "Symbol fetch failed"));
  }
}

export function getState(): AutoTraderState { return { ...state }; }

export function start(intervalSeconds?: number) {
  if (timer) clearInterval(timer);
  if (intervalSeconds) state.intervalSeconds = intervalSeconds;
  state.isRunning = true;
  state.nextRun = new Date(Date.now() + state.intervalSeconds * 1000).toISOString();

  // Run immediately on start
  runCycle().catch((err) => logger.error({ err }, "Auto-trader cycle error"));

  timer = setInterval(() => {
    runCycle().catch((err) => logger.error({ err }, "Auto-trader cycle error"));
  }, state.intervalSeconds * 1000);

  logger.info({ intervalSeconds: state.intervalSeconds, symbols: state.activeSymbols }, "Auto-trader started");
}

export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  state.isRunning = false;
  state.nextRun = null;
  logger.info("Auto-trader stopped");
}
