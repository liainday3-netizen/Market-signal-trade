// ─── Risk Manager ─────────────────────────────────────────────────────────────
// Single gate in front of every REAL-money entry (Coinbase live + Base DEX).
// Paper trading is not gated. Exits (sells / stop-losses) are NEVER blocked —
// the risk layer can only stop new exposure, never trap you in a position.
//
// Controls:
//   • Kill switch        — manual (API/env) or automatic; blocks all new entries
//   • Daily max loss     — realized + unrealized PnL for the day (UTC) across venues
//   • Max per-trade USD  — hard cap regardless of budget/scaling
//   • Max open positions — across all real venues
//   • Max total exposure — sum of open position cost basis across real venues
//   • Circuit breaker    — N consecutive order failures engages the kill switch
//   • Live-trading arm   — LIVE_TRADING_ENABLED=true must be set in env, or no
//                          new real-money position is ever opened (fail-closed
//                          default). Exits for positions that already exist
//                          keep running so stops still protect you.
import { sendAlert } from "./alerts";
import { logger } from "./logger";

export interface RiskLimits {
  maxPerTradeUsd: number;
  maxOpenPositions: number;
  maxTotalExposureUsd: number;
  maxDailyLossUsd: number;
  maxConsecutiveFailures: number;
  flattenOnBreach: boolean;
}

export const DEFAULT_LIMITS: RiskLimits = {
  maxPerTradeUsd: 10,
  maxOpenPositions: 2,
  maxTotalExposureUsd: 25,
  maxDailyLossUsd: 5,
  maxConsecutiveFailures: 3,
  flattenOnBreach: false,
};

export interface VenuePosition { symbol: string; quantity: number; avgEntryPrice: number }

export interface RiskSnapshot {
  openPositions: Array<VenuePosition & { venue: string }>;
  exposureUsd: number;
  realizedTodayUsd: number;
  unrealizedUsd: number;
  dayPnlUsd: number;
  /** True when realized PnL could not be read — entries are blocked (fail closed) */
  pnlUnavailable?: boolean;
}

export interface EntryRequest { venue: string; symbol: string; usd: number }

export type EntryDecision =
  | { allowed: true; usd: number; reason?: string }
  | { allowed: false; reason: string };

export interface RiskStatus {
  liveArmed: boolean;
  killSwitch: { engaged: boolean; reason: string | null; since: string | null; forcedByEnv: boolean };
  limits: RiskLimits;
  consecutiveFailures: number;
  snapshot: RiskSnapshot;
}

/** Pure decision function — unit-tested. */
export function evaluateEntry(
  limits: RiskLimits,
  snap: RiskSnapshot,
  req: EntryRequest,
  opts: { liveArmed: boolean; killSwitchEngaged: boolean },
): EntryDecision {
  if (!opts.liveArmed) return { allowed: false, reason: "LIVE_TRADING_ENABLED is not set — real orders are disarmed" };
  if (opts.killSwitchEngaged) return { allowed: false, reason: "Kill switch engaged" };
  if (!Number.isFinite(req.usd) || req.usd <= 0) return { allowed: false, reason: "Invalid order size" };
  if (snap.pnlUnavailable) return { allowed: false, reason: "PnL unavailable (database error) — entry blocked" };
  if (snap.dayPnlUsd <= -Math.abs(limits.maxDailyLossUsd)) {
    return { allowed: false, reason: `Daily loss limit reached (${snap.dayPnlUsd.toFixed(2)} USD)` };
  }
  const alreadyOpen = snap.openPositions.some((p) => p.venue === req.venue && p.symbol === req.symbol);
  if (!alreadyOpen && snap.openPositions.length >= limits.maxOpenPositions) {
    return { allowed: false, reason: `Max open positions (${limits.maxOpenPositions}) reached` };
  }
  let usd = Math.min(req.usd, limits.maxPerTradeUsd);
  const headroom = limits.maxTotalExposureUsd - snap.exposureUsd;
  if (headroom <= 0) return { allowed: false, reason: `Max total exposure (${limits.maxTotalExposureUsd} USD) reached` };
  usd = Math.min(usd, headroom);
  const reason = usd < req.usd ? `Size capped from ${req.usd.toFixed(2)} to ${usd.toFixed(2)} USD by risk limits` : undefined;
  return { allowed: true, usd, reason };
}

/** Validate/clamp a limits patch coming from the API. */
export function sanitizeLimits(base: RiskLimits, patch: Partial<RiskLimits>): RiskLimits {
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  return {
    maxPerTradeUsd: num(patch.maxPerTradeUsd, 1, 100_000, base.maxPerTradeUsd),
    maxOpenPositions: Math.floor(num(patch.maxOpenPositions, 1, 50, base.maxOpenPositions)),
    maxTotalExposureUsd: num(patch.maxTotalExposureUsd, 1, 1_000_000, base.maxTotalExposureUsd),
    maxDailyLossUsd: num(patch.maxDailyLossUsd, 0.5, 100_000, base.maxDailyLossUsd),
    maxConsecutiveFailures: Math.floor(num(patch.maxConsecutiveFailures, 1, 20, base.maxConsecutiveFailures)),
    flattenOnBreach: typeof patch.flattenOnBreach === "boolean" ? patch.flattenOnBreach : base.flattenOnBreach,
  };
}

// ─── Stateful manager ─────────────────────────────────────────────────────────

export interface SettingsStore {
  load<T>(key: string, fallback: T): Promise<T>;
  save(key: string, value: unknown): Promise<void>;
}

type PositionsGetter = () => VenuePosition[];
type PriceGetter = (symbol: string) => number | undefined;
type RealizedTodayGetter = () => Promise<number>;
type Flattener = () => Promise<void>;

const _venues = new Map<string, PositionsGetter>();
let _priceGetter: PriceGetter = () => undefined;
let _realizedToday: RealizedTodayGetter = async () => 0;
let _flattener: Flattener | null = null;
let _store: SettingsStore | null = null;

let _limits: RiskLimits = { ...DEFAULT_LIMITS };
let _kill = { engaged: false, reason: null as string | null, since: null as string | null };
let _consecutiveFailures = 0;

export function isLiveArmed(): boolean {
  return (process.env.LIVE_TRADING_ENABLED ?? "").trim().toLowerCase() === "true";
}
function killForcedByEnv(): boolean {
  return ["1", "true", "yes"].includes((process.env.KILL_SWITCH ?? "").trim().toLowerCase());
}
export function isKillSwitchEngaged(): boolean { return _kill.engaged || killForcedByEnv(); }

export function registerVenue(name: string, getPositions: PositionsGetter): void { _venues.set(name, getPositions); }
export function setPriceGetter(fn: PriceGetter): void { _priceGetter = fn; }
export function setRealizedTodayGetter(fn: RealizedTodayGetter): void { _realizedToday = fn; }
export function setFlattener(fn: Flattener): void { _flattener = fn; }

export async function init(store: SettingsStore): Promise<void> {
  _store = store;
  _limits = sanitizeLimits(DEFAULT_LIMITS, await store.load<Partial<RiskLimits>>("risk.limits", {}));
  _kill = await store.load("risk.killSwitch", _kill);
  logger.info({ limits: _limits, killSwitch: _kill, liveArmed: isLiveArmed(), killEnv: killForcedByEnv() }, "Risk manager initialised");
  if (!isLiveArmed()) logger.warn("LIVE_TRADING_ENABLED is not 'true' — real-money orders are DISARMED (paper only)");
}

export async function snapshot(): Promise<RiskSnapshot> {
  const openPositions: RiskSnapshot["openPositions"] = [];
  let exposureUsd = 0;
  let unrealizedUsd = 0;
  for (const [venue, get] of _venues) {
    for (const p of get()) {
      openPositions.push({ ...p, venue });
      const cost = p.quantity * p.avgEntryPrice;
      exposureUsd += cost;
      const px = _priceGetter(p.symbol);
      if (px && px > 0) unrealizedUsd += p.quantity * px - cost;
    }
  }
  let realizedTodayUsd = 0;
  let pnlUnavailable = false;
  try { realizedTodayUsd = await _realizedToday(); } catch (err) {
    logger.error({ err }, "Risk: failed to compute realized PnL — blocking entries (fail closed)");
    pnlUnavailable = true;
  }
  return { openPositions, exposureUsd, realizedTodayUsd, unrealizedUsd, dayPnlUsd: realizedTodayUsd + unrealizedUsd, pnlUnavailable };
}

/** Call before every real-money BUY / scale-in. Returns the (possibly reduced) USD size. */
export async function checkEntry(req: EntryRequest): Promise<EntryDecision> {
  const snap = await snapshot();
  const decision = evaluateEntry(_limits, snap, req, { liveArmed: isLiveArmed(), killSwitchEngaged: isKillSwitchEngaged() });
  if (!decision.allowed) {
    logger.info({ ...req, reason: decision.reason }, "Risk: entry blocked");
    if (decision.reason.startsWith("Daily loss")) await onDailyLossBreach(snap);
  } else if (decision.reason) {
    logger.info({ ...req, sized: decision.usd, reason: decision.reason }, "Risk: entry resized");
  }
  return decision;
}

/** Called after each price tick so the daily-loss breaker trips even without a new BUY. */
export async function evaluateOnTick(): Promise<void> {
  if (isKillSwitchEngaged() || _venues.size === 0) return;
  const snap = await snapshot();
  if (snap.pnlUnavailable) return;
  if (snap.openPositions.length === 0 && snap.realizedTodayUsd === 0) return;
  if (snap.dayPnlUsd <= -Math.abs(_limits.maxDailyLossUsd)) await onDailyLossBreach(snap);
}

async function onDailyLossBreach(snap: RiskSnapshot): Promise<void> {
  if (isKillSwitchEngaged()) return;
  await engageKillSwitch(`Daily loss limit hit: ${snap.dayPnlUsd.toFixed(2)} USD (limit -${_limits.maxDailyLossUsd})`);
  if (_limits.flattenOnBreach) await flattenAll("daily loss breach");
}

export function recordOrderSuccess(): void { _consecutiveFailures = 0; }

export async function recordOrderFailure(venue: string, symbol: string, err: unknown): Promise<void> {
  _consecutiveFailures++;
  const msg = err instanceof Error ? err.message : String(err);
  sendAlert("warn", `Order failed on ${venue} ${symbol}: ${msg} (${_consecutiveFailures} in a row)`, `orderfail:${venue}:${symbol}`);
  if (_consecutiveFailures >= _limits.maxConsecutiveFailures && !isKillSwitchEngaged()) {
    await engageKillSwitch(`${_consecutiveFailures} consecutive order failures (last: ${msg})`);
  }
}

export async function engageKillSwitch(reason: string): Promise<void> {
  _kill = { engaged: true, reason, since: new Date().toISOString() };
  await _store?.save("risk.killSwitch", _kill).catch((err) => logger.error({ err }, "Risk: failed to persist kill switch"));
  sendAlert("critical", `KILL SWITCH ENGAGED — ${reason}. New entries blocked; exits still active.`, "killswitch");
}

export async function releaseKillSwitch(): Promise<void> {
  _kill = { engaged: false, reason: null, since: null };
  _consecutiveFailures = 0;
  await _store?.save("risk.killSwitch", _kill);
  sendAlert("warn", killForcedByEnv() ? "Kill switch released in app, but KILL_SWITCH env is still set" : "Kill switch released — new entries allowed", "killswitch-release");
}

export async function flattenAll(reason: string): Promise<void> {
  if (!_flattener) { logger.warn("Risk: no flattener registered"); return; }
  sendAlert("critical", `Flattening all real positions (${reason})`, "flatten");
  await _flattener();
}

export async function setLimits(patch: Partial<RiskLimits>): Promise<RiskLimits> {
  _limits = sanitizeLimits(_limits, patch);
  await _store?.save("risk.limits", _limits);
  logger.info({ limits: _limits }, "Risk limits updated");
  return { ..._limits };
}

export function getLimits(): RiskLimits { return { ..._limits }; }

export async function getStatus(): Promise<RiskStatus> {
  return {
    liveArmed: isLiveArmed(),
    killSwitch: { ..._kill, engaged: isKillSwitchEngaged(), forcedByEnv: killForcedByEnv() },
    limits: { ..._limits },
    consecutiveFailures: _consecutiveFailures,
    snapshot: await snapshot(),
  };
}

/** Test hook */
export function _resetForTests(): void {
  _venues.clear();
  _priceGetter = () => undefined;
  _realizedToday = async () => 0;
  _flattener = null;
  _store = null;
  _limits = { ...DEFAULT_LIMITS };
  _kill = { engaged: false, reason: null, since: null };
  _consecutiveFailures = 0;
}
