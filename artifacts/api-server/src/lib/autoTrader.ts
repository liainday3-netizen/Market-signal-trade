import { db, signalsTable } from "@workspace/db";
import { logger } from "./logger";
import { setLastPrice, executeBuy, executeSell, ensurePortfolio, checkSlTp } from "./paperTrader";
import * as liveTrader from "./liveTrader";
import * as dexTrader from "./baseDexTrader";
import * as binanceWs from "./binanceWs";
import * as scaling from "./scalingEngine";
import type { OHLCVRow } from "./binanceWs";
import { applyCoherence, calculateCoherence, type CoherenceResult, type TimeframeFactorSnapshot } from "./coherence";

// ─── Indicator helpers ────────────────────────────────────────────────────────

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

function computeFeatures(candles: OHLCVRow[]) {
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
  return { returns: avgReturn, ma20, emaFast, emaSlow, volatility, rsi: rsiVal, macd: macdLine, macdSignal, macdHist, bbUpper, bbLower, bbPct, atr: atrVal, stochK, momentum, zScore, volumeTrend, price: currentPrice };
}

function clamp(v: number, min = -1, max = 1) { return Math.max(min, Math.min(max, v)); }

function computeFactorScores(f: ReturnType<typeof computeFeatures>) {
  const emaCross = clamp((f.emaFast - f.emaSlow) / f.ma20 * 50);
  const macdHistScore = clamp(f.macdHist / (Math.abs(f.macd) || 1));
  const trend = clamp(emaCross * 0.6 + macdHistScore * 0.4);
  const momentumScore = clamp(f.momentum * 20);
  const stochScore = clamp((f.stochK - 50) / 50);
  const momentum = clamp(momentumScore * 0.6 + stochScore * 0.4);
  const rsiScore = clamp(-((f.rsi - 50) / 30));
  const bbScore = clamp(-(f.bbPct - 0.5) * 4);
  const zScoreF = clamp(-f.zScore / 2);
  const meanReversion = clamp(rsiScore * 0.4 + bbScore * 0.3 + zScoreF * 0.3);
  const atrPct = f.atr / f.ma20;
  const volatility = clamp(1 - atrPct * 100);
  const volume = clamp(f.volumeTrend);
  // Weights tuned for 1-min crypto: mean-reversion leads (0.30), trend reduced (0.20)
  // to filter out noisy micro-trend breakouts; volatility raised (0.15) to require edge.
  const composite = clamp(trend * 0.20 + momentum * 0.25 + meanReversion * 0.30 + volatility * 0.15 + volume * 0.10);
  return { trend, momentum, meanReversion, volatility, volume, composite: Math.round(composite * 1000) / 1000 };
}

// ─── Fetch via REST (used to seed WS buffers) ─────────────────────────────────

const BINANCE_SYMBOL_MAP: Record<string, string> = {
  "BTC/USDT": "BTCUSDT", "ETH/USDT": "ETHUSDT", "SOL/USDT": "SOLUSDT",
};

async function fetchOHLCV(symbol: string, timeframe: string, limit: number): Promise<OHLCVRow[]> {
  const sym = BINANCE_SYMBOL_MAP[symbol] ?? symbol.replace("/", "");
  const url = `https://api.binance.us/api/v3/klines?symbol=${sym}&interval=${timeframe}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance REST ${res.status}`);
  const raw = (await res.json()) as unknown[][];
  return raw.map((c) => ({
    time: c[0] as number, open: parseFloat(c[1] as string), high: parseFloat(c[2] as string),
    low: parseFloat(c[3] as string), close: parseFloat(c[4] as string), volume: parseFloat(c[5] as string),
  }));
}

// ─── Core signal processing ───────────────────────────────────────────────────

async function processSymbol(symbol: string, candles: OHLCVRow[]) {
  const features = computeFeatures(candles);
  const factors = computeFactorScores(features);
  const timeframeSnapshots: TimeframeFactorSnapshot[] = [{ timeframe: "1m", factors }];
  try {
    const [fiveMinuteCandles, fifteenMinuteCandles] = await Promise.all([
      fetchOHLCV(symbol, "5m", 100),
      fetchOHLCV(symbol, "15m", 100),
    ]);
    if (fiveMinuteCandles.length >= 35) {
      timeframeSnapshots.push({ timeframe: "5m", factors: computeFactorScores(computeFeatures(fiveMinuteCandles)) });
    }
    if (fifteenMinuteCandles.length >= 35) {
      timeframeSnapshots.push({ timeframe: "15m", factors: computeFactorScores(computeFeatures(fifteenMinuteCandles)) });
    }
  } catch (err) {
    logger.warn({ err, symbol }, "Unable to load coherence timeframes");
  }
  const coherence = calculateCoherence(factors, timeframeSnapshots, 0.25);
  const { signal, confidence } = applyCoherence(factors, coherence, 0.25);
  const price = features.price;

  const [insertedSignal] = await db.insert(signalsTable).values({
    signal, confidence, price, symbol,
    timeframe: "1m",
    returns: features.returns,
    ma: features.ma20,
    volatility: features.volatility,
    rsi: features.rsi,
    macd: features.macd,
  }).returning({ id: signalsTable.id });

  setLastPrice(symbol, price);

  // Keep DEX auto-refill calibrated with the real ETH price
  if (symbol === "ETH/USDT") dexTrader.updateEthPrice(price);

  const composite = factors.composite;

  // ── SL/TP check (runs before new signals, using current candle close price) ─
  let paperSlTpFired = false;
  let dexSlTpFired   = false;
  try {
    const sltp = await checkSlTp(symbol, price);
    if (sltp) {
      paperSlTpFired = true;
      logger.info({ symbol, price, trigger: sltp }, "Paper SL/TP triggered");
    }
  } catch (err) {
    logger.error({ err, symbol }, "SL/TP check failed");
  }
  // Live SL/TP
  try { liveTrader.checkSlTp(symbol, price); } catch (_) { /* noop */ }
  // DEX SL/TP — track whether it fired so signal-SELL doesn't double-execute
  try {
    const dexPosBefore = dexTrader.getState().positions[symbol];
    dexTrader.checkSlTp(symbol, price);
    const dexPosAfter = dexTrader.getState().positions[symbol];
    if (dexPosBefore && !dexPosAfter) dexSlTpFired = true;
  } catch (_) { /* noop */ }

  // ── Paper trades ──────────────────────────────────────────────────────────
  // Skip signal-based SELL if SL/TP already closed the position this tick
  try {
    if (signal === "BUY") await executeBuy(symbol, price, insertedSignal?.id, composite);
    else if (signal === "SELL" && !paperSlTpFired) await executeSell(symbol, price, insertedSignal?.id);
  } catch (err) {
    logger.error({ err, symbol, signal }, "Paper trade failed");
  }

  // ── Live trades ───────────────────────────────────────────────────────────
  try {
    if (signal === "BUY") await liveTrader.executeBuy(symbol, price, insertedSignal?.id, composite);
    else if (signal === "SELL") await liveTrader.executeSell(symbol, price, insertedSignal?.id);
  } catch (err) {
    logger.error({ err, symbol, signal }, "Live trade failed");
  }

  // ── DEX trades on Base chain ──────────────────────────────────────────────
  // Skip signal-SELL if SL/TP already closed the DEX position this tick
  try {
    if (signal === "BUY") await dexTrader.executeBuy(symbol, price, insertedSignal?.id, composite);
    else if (signal === "SELL" && !dexSlTpFired) await dexTrader.executeSell(symbol, price, insertedSignal?.id);
  } catch (err) {
    logger.error({ err, symbol, signal }, "DEX trade failed");
  }

  const recent: RecentSignal = {
    symbol,
    signal,
    confidence,
    price,
    composite: factors.composite,
    coherence,
    timestamp: new Date().toISOString(),
  };
  state.signalsGenerated++;
  state.totalRuns++;
  state.lastRun = new Date().toISOString();
  state.nextRun = null;
  state.lastSignals = [recent, ...state.lastSignals].slice(0, MAX_RECENT_SIGNALS);

  logger.info({ symbol, signal, confidence, price, composite: factors.composite, coherenceScore: coherence.score, source: "websocket" }, "Signal generated");
}

// ─── Auto-Trader State ────────────────────────────────────────────────────────

export interface RecentSignal {
  symbol: string;
  signal: string;
  confidence: number;
  price: number;
  composite: number;
  coherence: CoherenceResult;
  timestamp: string;
}

export interface AutoTraderState {
  isRunning: boolean;
  intervalSeconds: number;
  totalRuns: number;
  signalsGenerated: number;
  lastRun: string | null;
  nextRun: string | null;
  activeSymbols: string[];
  lastSignals: RecentSignal[];
  wsStatus: binanceWs.WsStatus;
  dataSource: "websocket" | "rest";
}

const DEFAULT_SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
const DEFAULT_INTERVAL_S = 60;
const MAX_RECENT_SIGNALS = 30;

let state: AutoTraderState = {
  isRunning: false,
  intervalSeconds: DEFAULT_INTERVAL_S,
  totalRuns: 0,
  signalsGenerated: 0,
  lastRun: null,
  nextRun: null,
  activeSymbols: DEFAULT_SYMBOLS,
  lastSignals: [],
  wsStatus: "DISCONNECTED",
  dataSource: "websocket",
};

// Fallback REST timer (fires if no WS signal for 2x interval)
let _fallbackTimer: ReturnType<typeof setInterval> | null = null;
let _lastSignalAt = 0;

function onCandleClose({ symbol, candles }: { symbol: string; candles: OHLCVRow[] }) {
  _lastSignalAt = Date.now();
  processSymbol(symbol, candles).catch((err) =>
    logger.error({ err, symbol }, "processSymbol error"),
  );
}

function onStatusChange(status: binanceWs.WsStatus) {
  state.wsStatus = status;
}

// REST fallback: if WS hasn't delivered a candle close in 2× interval, poll REST
async function runRestFallback() {
  if (!state.isRunning) return;
  const elapsed = (Date.now() - _lastSignalAt) / 1000;
  if (elapsed < state.intervalSeconds * 2) return;

  logger.warn({ elapsed }, "WS idle — running REST fallback cycle");
  for (const symbol of state.activeSymbols) {
    try {
      const candles = await fetchOHLCV(symbol, "1m", 100);
      if (candles.length >= 35) await processSymbol(symbol, candles);
    } catch (err) {
      logger.error({ err, symbol }, "REST fallback failed");
    }
  }
}

export function getState(): AutoTraderState { return { ...state }; }

export function start(intervalSeconds?: number) {
  if (intervalSeconds) state.intervalSeconds = intervalSeconds;
  state.isRunning = true;
  state.dataSource = "websocket";
  _lastSignalAt = Date.now();

  // Auto-enable scaling engine when loop starts
  scaling.setConfig({ enabled: true });

  ensurePortfolio().catch((err) => logger.error({ err }, "Portfolio init failed"));

  // Wire WS events
  binanceWs.wsEvents.off("candleClose", onCandleClose);
  binanceWs.wsEvents.off("statusChange", onStatusChange);
  binanceWs.wsEvents.on("candleClose", onCandleClose);
  binanceWs.wsEvents.on("statusChange", onStatusChange);

  binanceWs.connect(state.activeSymbols, fetchOHLCV);

  // Fallback REST poll every interval
  if (_fallbackTimer) clearInterval(_fallbackTimer);
  _fallbackTimer = setInterval(runRestFallback, state.intervalSeconds * 1000);

  logger.info({ symbols: state.activeSymbols, intervalSeconds: state.intervalSeconds }, "Auto-trader started (WS mode)");
}

export function stop() {
  state.isRunning = false;
  binanceWs.wsEvents.off("candleClose", onCandleClose);
  binanceWs.wsEvents.off("statusChange", onStatusChange);
  binanceWs.disconnect();
  if (_fallbackTimer) { clearInterval(_fallbackTimer); _fallbackTimer = null; }
  state.wsStatus = "DISCONNECTED";
  state.nextRun = null;
  logger.info("Auto-trader stopped");
}
