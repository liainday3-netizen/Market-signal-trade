import EventEmitter from "node:events";
import { logger } from "./logger";

export type WsStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "RECONNECTING";

export interface OHLCVRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiveTicker {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number;
}

const BINANCE_US_WS = "wss://stream.binance.us:9443";

const SYMBOL_STREAM: Record<string, string> = {
  "BTC/USDT": "btcusdt",
  "ETH/USDT": "ethusdt",
  "SOL/USDT": "solusdt",
};

const STREAM_SYMBOL: Record<string, string> = {
  "btcusdt": "BTC/USDT",
  "ethusdt": "ETH/USDT",
  "solusdt": "SOL/USDT",
};

// Exported event emitter — subscribers receive typed events
// "candleClose"  → { symbol, candles }
// "ticker"       → LiveTicker
// "statusChange" → WsStatus
export const wsEvents = new EventEmitter();
wsEvents.setMaxListeners(50);

const candleBuffers = new Map<string, OHLCVRow[]>();
const latestTickers = new Map<string, LiveTicker>();

let wsStatus: WsStatus = "DISCONNECTED";
let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _reconnectDelay = 1000;
let _shouldConnect = false;
let _symbols: string[] = [];
let _fetchOHLCV: ((sym: string, tf: string, limit: number) => Promise<OHLCVRow[]>) | null = null;

export function getWsStatus(): WsStatus { return wsStatus; }
export function getLatestTickers(): Map<string, LiveTicker> { return latestTickers; }
export function getLatestTicker(symbol: string): LiveTicker | undefined { return latestTickers.get(symbol); }
export function getCandleBuffer(symbol: string): OHLCVRow[] { return candleBuffers.get(symbol) ?? []; }

async function initBuffer(symbol: string) {
  if (!_fetchOHLCV) return;
  try {
    const candles = await _fetchOHLCV(symbol, "1m", 200);
    candleBuffers.set(symbol, candles);
    logger.info({ symbol, count: candles.length }, "WS: candle buffer seeded via REST");
  } catch (err) {
    logger.error({ err, symbol }, "WS: failed to seed candle buffer");
    if (!candleBuffers.has(symbol)) candleBuffers.set(symbol, []);
  }
}

function buildUrl(symbols: string[]): string {
  const streams = symbols.flatMap((s) => {
    const base = SYMBOL_STREAM[s] ?? s.replace("/", "").toLowerCase();
    return [`${base}@kline_1m`, `${base}@miniTicker`];
  });
  return `${BINANCE_US_WS}/stream?streams=${streams.join("/")}`;
}

function setStatus(s: WsStatus) {
  wsStatus = s;
  wsEvents.emit("statusChange", s);
}

function _doConnect() {
  if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
  setStatus("CONNECTING");
  logger.info({ symbols: _symbols }, "WS: connecting to Binance US");

  // Seed buffers for any symbol that lacks candle history
  for (const sym of _symbols) {
    if ((candleBuffers.get(sym)?.length ?? 0) < 50) {
      initBuffer(sym);
    }
  }

  const url = buildUrl(_symbols);
  _ws = new WebSocket(url);

  _ws.onopen = () => {
    _reconnectDelay = 1000;
    setStatus("CONNECTED");
    logger.info("WS: connected to Binance US streams");
  };

  _ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as { stream: string; data: unknown };
      const stream = msg.stream ?? "";
      const data = msg.data as Record<string, unknown>;
      if (stream.includes("@kline_")) handleKline(data);
      else if (stream.includes("@miniTicker")) handleMiniTicker(data);
    } catch (err) {
      logger.warn({ err }, "WS: message parse error");
    }
  };

  _ws.onclose = (event) => {
    _ws = null;
    if (!_shouldConnect) { setStatus("DISCONNECTED"); return; }
    setStatus("RECONNECTING");
    logger.warn({ code: event.code, reason: event.reason, delay: _reconnectDelay }, "WS: disconnected — will reconnect");
    _reconnectTimer = setTimeout(() => {
      _reconnectDelay = Math.min(_reconnectDelay * 2, 30000);
      _doConnect();
    }, _reconnectDelay);
  };

  _ws.onerror = (err) => {
    logger.error({ message: (err as ErrorEvent).message }, "WS: stream error");
  };
}

export function connect(
  symbols: string[],
  fetchOHLCV: (sym: string, tf: string, limit: number) => Promise<OHLCVRow[]>,
) {
  _symbols = symbols;
  _fetchOHLCV = fetchOHLCV;
  _shouldConnect = true;
  _doConnect();
}

export function disconnect() {
  _shouldConnect = false;
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
  setStatus("DISCONNECTED");
  logger.info("WS: disconnected by request");
}

function handleKline(data: Record<string, unknown>) {
  const symbolRaw = (data["s"] as string ?? "").toLowerCase();
  const symbol = STREAM_SYMBOL[symbolRaw];
  if (!symbol) return;

  const k = data["k"] as Record<string, unknown>;
  const isClosed = k["x"] as boolean;

  const candle: OHLCVRow = {
    time: k["t"] as number,
    open: parseFloat(k["o"] as string),
    high: parseFloat(k["h"] as string),
    low: parseFloat(k["l"] as string),
    close: parseFloat(k["c"] as string),
    volume: parseFloat(k["v"] as string),
  };

  const buf = candleBuffers.get(symbol) ?? [];

  if (isClosed) {
    // Finalise candle: replace in-progress or append
    if (buf.length > 0 && buf[buf.length - 1].time === candle.time) {
      buf[buf.length - 1] = candle;
    } else {
      buf.push(candle);
    }
    if (buf.length > 200) buf.splice(0, buf.length - 200);
    candleBuffers.set(symbol, buf);

    if (buf.length >= 35) {
      wsEvents.emit("candleClose", { symbol, candles: [...buf] });
    }
  } else {
    // Update live (in-progress) candle in buffer
    if (buf.length > 0 && buf[buf.length - 1].time === candle.time) {
      buf[buf.length - 1] = candle;
    } else if (buf.length > 0) {
      buf.push(candle);
      if (buf.length > 200) buf.splice(0, buf.length - 200);
    }
  }
}

function handleMiniTicker(data: Record<string, unknown>) {
  const symbolRaw = (data["s"] as string ?? "").toLowerCase();
  const symbol = STREAM_SYMBOL[symbolRaw];
  if (!symbol) return;

  const price = parseFloat(data["c"] as string);
  const open = parseFloat(data["o"] as string);
  const high = parseFloat(data["h"] as string);
  const low = parseFloat(data["l"] as string);
  const volume = parseFloat(data["v"] as string);
  const change = price - open;
  const changePercent = open > 0 ? (change / open) * 100 : 0;

  const ticker: LiveTicker = { symbol, price, change, changePercent, high, low, volume, timestamp: Date.now() };
  latestTickers.set(symbol, ticker);
  wsEvents.emit("ticker", ticker);
}
