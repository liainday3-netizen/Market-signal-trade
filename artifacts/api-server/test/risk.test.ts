import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as risk from "../src/lib/riskManager";
import { withLock } from "../src/lib/keyedMutex";
import { guardTraderRoutes } from "../src/middlewares/requireAdmin";

const L = risk.DEFAULT_LIMITS;
const emptySnap: risk.RiskSnapshot = { openPositions: [], exposureUsd: 0, realizedTodayUsd: 0, unrealizedUsd: 0, dayPnlUsd: 0 };
const armed = { liveArmed: true, killSwitchEngaged: false };

function memStore(): risk.SettingsStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async load<T>(k: string, f: T) { return (data.has(k) ? data.get(k) : f) as T; },
    async save(k: string, v: unknown) { data.set(k, JSON.parse(JSON.stringify(v))); },
  };
}

beforeEach(() => {
  risk._resetForTests();
  delete process.env.KILL_SWITCH;
  process.env.LIVE_TRADING_ENABLED = "true";
});

// ── Pure decision ────────────────────────────────────────────────────────────
test("blocks everything when live trading is not armed", () => {
  const d = risk.evaluateEntry(L, emptySnap, { venue: "coinbase", symbol: "BTC/USDT", usd: 5 }, { liveArmed: false, killSwitchEngaged: false });
  assert.equal(d.allowed, false);
});

test("blocks when kill switch engaged", () => {
  const d = risk.evaluateEntry(L, emptySnap, { venue: "coinbase", symbol: "BTC/USDT", usd: 5 }, { liveArmed: true, killSwitchEngaged: true });
  assert.equal(d.allowed, false);
});

test("caps order size at maxPerTradeUsd", () => {
  const d = risk.evaluateEntry(L, emptySnap, { venue: "coinbase", symbol: "BTC/USDT", usd: 500 }, armed);
  assert.ok(d.allowed);
  assert.equal(d.allowed && d.usd, L.maxPerTradeUsd);
});

test("caps order size at remaining exposure headroom", () => {
  const snap = { ...emptySnap, exposureUsd: L.maxTotalExposureUsd - 3, openPositions: [{ venue: "coinbase", symbol: "ETH/USDT", quantity: 1, avgEntryPrice: 1 }] };
  const d = risk.evaluateEntry(L, snap, { venue: "coinbase", symbol: "BTC/USDT", usd: 8 }, armed);
  assert.ok(d.allowed);
  assert.equal(d.allowed && d.usd, 3);
});

test("blocks at max exposure", () => {
  const snap = { ...emptySnap, exposureUsd: L.maxTotalExposureUsd };
  assert.equal(risk.evaluateEntry(L, snap, { venue: "coinbase", symbol: "BTC/USDT", usd: 5 }, armed).allowed, false);
});

test("blocks new symbol at max open positions but allows scale-in on existing", () => {
  const open = [
    { venue: "coinbase", symbol: "ETH/USDT", quantity: 1, avgEntryPrice: 1 },
    { venue: "base-dex", symbol: "BTC/USDT", quantity: 1, avgEntryPrice: 1 },
  ];
  const snap = { ...emptySnap, openPositions: open, exposureUsd: 2 };
  assert.equal(risk.evaluateEntry(L, snap, { venue: "coinbase", symbol: "SOL/USDT", usd: 5 }, armed).allowed, false);
  assert.equal(risk.evaluateEntry(L, snap, { venue: "coinbase", symbol: "ETH/USDT", usd: 5 }, armed).allowed, true);
});

test("blocks when daily loss limit reached", () => {
  const snap = { ...emptySnap, dayPnlUsd: -L.maxDailyLossUsd };
  const d = risk.evaluateEntry(L, snap, { venue: "coinbase", symbol: "BTC/USDT", usd: 5 }, armed);
  assert.equal(d.allowed, false);
  assert.match(!d.allowed ? d.reason : "", /Daily loss/);
});

test("rejects invalid sizes", () => {
  for (const usd of [0, -1, NaN, Infinity]) {
    assert.equal(risk.evaluateEntry(L, emptySnap, { venue: "x", symbol: "y", usd }, armed).allowed, false);
  }
});

test("sanitizeLimits clamps bad input", () => {
  const s = risk.sanitizeLimits(L, { maxPerTradeUsd: -5, maxOpenPositions: 999, maxDailyLossUsd: "x" as unknown as number });
  assert.equal(s.maxPerTradeUsd, 1);
  assert.equal(s.maxOpenPositions, 50);
  assert.equal(s.maxDailyLossUsd, L.maxDailyLossUsd);
});

// ── Stateful manager ─────────────────────────────────────────────────────────
test("daily loss including unrealized PnL trips kill switch and persists it", async () => {
  const store = memStore();
  risk.registerVenue("coinbase", () => [{ symbol: "BTC/USDT", quantity: 1, avgEntryPrice: 100 }]);
  risk.setPriceGetter(() => 90); // -10 unrealized
  await risk.init(store);
  const d = await risk.checkEntry({ venue: "coinbase", symbol: "ETH/USDT", usd: 5 });
  assert.equal(d.allowed, false);
  assert.equal(risk.isKillSwitchEngaged(), true);
  assert.equal((store.data.get("risk.killSwitch") as { engaged: boolean }).engaged, true);
});

test("evaluateOnTick trips the breaker without a new BUY, and flattens when configured", async () => {
  const store = memStore();
  let flattened = 0;
  risk.registerVenue("coinbase", () => [{ symbol: "BTC/USDT", quantity: 1, avgEntryPrice: 100 }]);
  risk.setPriceGetter(() => 50);
  risk.setFlattener(async () => { flattened++; });
  await risk.init(store);
  await risk.setLimits({ flattenOnBreach: true });
  await risk.evaluateOnTick();
  assert.equal(risk.isKillSwitchEngaged(), true);
  assert.equal(flattened, 1);
});

test("failing PnL lookup fails closed", async () => {
  risk.setRealizedTodayGetter(async () => { throw new Error("db down"); });
  await risk.init(memStore());
  const d = await risk.checkEntry({ venue: "coinbase", symbol: "BTC/USDT", usd: 5 });
  assert.equal(d.allowed, false);
  assert.equal(risk.isKillSwitchEngaged(), false, "transient DB error must not latch the kill switch");
});

test("consecutive order failures engage kill switch; success resets counter", async () => {
  await risk.init(memStore());
  await risk.recordOrderFailure("coinbase", "BTC/USDT", new Error("a"));
  await risk.recordOrderFailure("coinbase", "BTC/USDT", new Error("b"));
  risk.recordOrderSuccess();
  await risk.recordOrderFailure("coinbase", "BTC/USDT", new Error("c"));
  assert.equal(risk.isKillSwitchEngaged(), false);
  await risk.recordOrderFailure("coinbase", "BTC/USDT", new Error("d"));
  await risk.recordOrderFailure("coinbase", "BTC/USDT", new Error("e"));
  assert.equal(risk.isKillSwitchEngaged(), true);
});

test("KILL_SWITCH env forces engaged even after release", async () => {
  await risk.init(memStore());
  process.env.KILL_SWITCH = "1";
  await risk.releaseKillSwitch();
  assert.equal(risk.isKillSwitchEngaged(), true);
});

test("kill switch state survives restart via store", async () => {
  const store = memStore();
  await risk.init(store);
  await risk.engageKillSwitch("test");
  risk._resetForTests();
  await risk.init(store);
  assert.equal(risk.isKillSwitchEngaged(), true);
});

// ── Mutex ────────────────────────────────────────────────────────────────────
test("withLock serialises same key and prevents double sell", async () => {
  let position: number | null = 1;
  let sells = 0;
  const sell = () => withLock("coinbase:BTC", async () => {
    if (position === null) return false;
    await new Promise((r) => setTimeout(r, 20));
    position = null; sells++; return true;
  });
  const results = await Promise.all([sell(), sell(), sell()]);
  assert.equal(sells, 1);
  assert.deepEqual(results, [true, false, false]);
});

test("withLock releases after a throw", async () => {
  await assert.rejects(withLock("k", async () => { throw new Error("x"); }));
  assert.equal(await withLock("k", async () => 42), 42);
});

// ── Admin auth middleware ────────────────────────────────────────────────────
function run(method: string, path: string, headers: Record<string, string> = {}) {
  let status = 200; let nextCalled = false;
  const req = { method, path, headers } as never;
  const res = { status(s: number) { status = s; return this; }, json() { return this; } } as never;
  guardTraderRoutes(req, res, () => { nextCalled = true; });
  return { status, nextCalled };
}

test("auth: POST requires token; GET public; sensitive GET protected", () => {
  process.env.ADMIN_TOKEN = "s3cret";
  assert.equal(run("POST", "/live-mode").status, 401);
  assert.equal(run("POST", "/live-mode", { authorization: "Bearer wrong" }).status, 401);
  assert.equal(run("POST", "/live-mode", { authorization: "Bearer s3cret" }).nextCalled, true);
  assert.equal(run("GET", "/portfolio").nextCalled, true);
  assert.equal(run("GET", "/exchange/diagnose").status, 401);
  assert.equal(run("GET", "/risk").status, 401);
  delete process.env.ADMIN_TOKEN;
});

test("auth: production without ADMIN_TOKEN fails closed", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  delete process.env.ADMIN_TOKEN;
  assert.equal(run("POST", "/dex-wallet").status, 503);
  process.env.NODE_ENV = prev;
});
