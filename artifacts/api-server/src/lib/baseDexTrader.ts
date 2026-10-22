import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { db, tradesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as risk from "./riskManager";
import { withLock } from "./keyedMutex";
import { sendAlert } from "./alerts";
import * as scaling from "./scalingEngine";
import { logger } from "./logger";

// ─── Token addresses on Base mainnet ─────────────────────────────────────────
const TOKENS = {
  USDC:  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
  WETH:  "0x4200000000000000000000000000000000000006" as Address,
  cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Address,
} as const;

const TOKEN_DECIMALS = { USDC: 6, WETH: 18, cbBTC: 8 } as const;

// ─── Uniswap v3 SwapRouter02 on Base ─────────────────────────────────────────
const SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481" as Address;

// Signal symbol → token on Base
const SYMBOL_MAP: Record<string, { token: Address; key: keyof typeof TOKEN_DECIMALS; fee: number }> = {
  "ETH/USDT": { token: TOKENS.WETH,  key: "WETH",  fee: 500  },  // 0.05% WETH/USDC pool
  "BTC/USDT": { token: TOKENS.cbBTC, key: "cbBTC", fee: 3000 },  // 0.30% cbBTC/USDC pool
  // SOL has no native representation on Base — skip
};

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  { name: "balanceOf",  type: "function", stateMutability: "view",        inputs: [{ name: "account", type: "address" }],                                      outputs: [{ type: "uint256" }] },
  { name: "allowance",  type: "function", stateMutability: "view",        inputs: [{ name: "owner",   type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve",    type: "function", stateMutability: "nonpayable",  inputs: [{ name: "spender", type: "address" }, { name: "amount",  type: "uint256" }], outputs: [{ type: "bool"    }] },
] as const;

// WETH deposit (wrap native ETH → WETH)
const WETH_ABI = [
  { name: "deposit",   type: "function", stateMutability: "payable",     inputs: [],                                                                           outputs: []                    },
  { name: "balanceOf", type: "function", stateMutability: "view",        inputs: [{ name: "account", type: "address" }],                                      outputs: [{ type: "uint256" }] },
] as const;

const SWAP_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [{
      name: "params", type: "tuple",
      components: [
        { name: "tokenIn",            type: "address" },
        { name: "tokenOut",           type: "address" },
        { name: "fee",                type: "uint24"  },
        { name: "recipient",          type: "address" },
        { name: "amountIn",           type: "uint256" },
        { name: "amountOutMinimum",   type: "uint256" },
        { name: "sqrtPriceLimitX96",  type: "uint160" },
      ],
    }],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

// ─── In-memory private key override (set via UI connect form) ─────────────────
// This overrides DEX_WALLET_PRIVATE_KEY env var for the current server session.
// It is never logged or persisted to disk. Users should also save to Replit
// Secrets as DEX_WALLET_PRIVATE_KEY for persistence across restarts.
let _overrideKey: string | null = null;

// Last known ETH price — updated by autoTrader when processing ETH/USDT candles
let _lastEthPrice = 0;
export function updateEthPrice(price: number): void { _lastEthPrice = price; }

// Guard: only one auto-refill at a time
let _refilling = false;
const _scaleIns = new Map<string, { entryComposite: number; scaleIns: number }>();

// ─── State ─────────────────────────────────────────────────────────────────────
export interface DexPosition {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  openedAt: string;
}

export interface DexTraderState {
  enabled: boolean;
  configured: boolean;
  walletAddress: string | null;
  budgetUsdc: number;
  totalTrades: number;
  positions: Record<string, DexPosition>;
}

const _state: DexTraderState = {
  enabled: false,
  configured: false,
  walletAddress: null,
  budgetUsdc: 15,
  totalTrades: 0,
  positions: {},
};

const MAX_PER_TRADE_USDC = 5;

// Expose open DEX positions to the risk manager.
risk.registerVenue("base-dex", () => Object.values(_state.positions));

// ─── Persistence (positions + enabled flag survive restarts) ──────────────────
async function persistPositions(): Promise<void> {
  const value = JSON.stringify(_state.positions);
  await db.insert(settingsTable).values({ key: "dex.positions", value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value } })
    .catch((err: unknown) => logger.error({ err }, "DEX: failed to persist positions"));
}

export async function loadPersistedState(): Promise<void> {
  try {
    const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, "dex.positions")).limit(1);
    if (rows.length) _state.positions = JSON.parse(rows[0].value) as Record<string, DexPosition>;
    const en = await db.select().from(settingsTable).where(eq(settingsTable.key, "dex.enabled")).limit(1);
    if (en.length && en[0].value === "true" && _state.configured) _state.enabled = true;
    logger.info({ enabled: _state.enabled, openPositions: Object.keys(_state.positions) }, "DEX state restored from DB");
  } catch (err) {
    logger.error({ err }, "DEX: failed to restore persisted state");
  }
}
const SLIPPAGE = 0.01;

// ─── Client helpers ────────────────────────────────────────────────────────────
function getAccount() {
  const raw = (_overrideKey ?? process.env.DEX_WALLET_PRIVATE_KEY)?.trim();
  if (!raw) return null;
  const pk = raw.startsWith("0x") ? raw : (`0x${raw}` as `0x${string}`);
  try { return privateKeyToAccount(pk as `0x${string}`); } catch { return null; }
}

/** Connect a wallet via private key entered in the UI.
 *  Stores key in memory only — never logged or written to disk.
 *  Throws if the key is invalid. */
export function connectPrivateKey(rawKey: string): { address: string } {
  const trimmed = rawKey.trim();
  const pk = (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
  const account = privateKeyToAccount(pk); // throws on invalid key
  _overrideKey = trimmed;
  _state.configured    = true;
  _state.walletAddress = account.address;
  _state.enabled       = false; // require explicit enable after connecting
  logger.info({ address: account.address }, "DEX wallet connected via UI");
  return { address: account.address };
}

/** Disconnect the in-memory wallet (falls back to env var if present). */
export function disconnectWallet(): void {
  _overrideKey = null;
  _state.enabled = false;
  const fallback = getAccount();
  _state.configured    = !!fallback;
  _state.walletAddress = fallback?.address ?? null;
  logger.info({ fallbackConfigured: _state.configured }, "DEX wallet disconnected");
}

function clients() {
  const account = getAccount();
  if (!account) return null;
  const transport = http("https://mainnet.base.org");
  return {
    pub:  createPublicClient({ chain: base, transport }),
    wal:  createWalletClient({ chain: base, account, transport }),
    account,
  };
}

// ─── Init ──────────────────────────────────────────────────────────────────────
export function init() {
  const account = getAccount();
  _state.configured   = !!account;
  _state.walletAddress = account?.address ?? null;
  logger.info({ configured: _state.configured, wallet: _state.walletAddress }, "DEX trader initialized");
}

export function getState(): DexTraderState {
  return { ..._state, positions: { ..._state.positions } };
}

export function setEnabled(enabled: boolean) {
  if (enabled && !_state.configured) throw new Error("DEX wallet private key not configured.");
  _state.enabled = enabled;
  logger.info({ enabled }, "DEX trader " + (enabled ? "enabled" : "disabled"));
}

export function setBudget(usdc: number) {
  _state.budgetUsdc = usdc;
}

// ─── On-chain balances ─────────────────────────────────────────────────────────
export async function getBalances() {
  const c = clients();
  if (!c) return null;
  const addr = c.account.address;

  const [usdcRaw, wethRaw, cbbtcRaw, ethRaw] = await Promise.all([
    c.pub.readContract({ address: TOKENS.USDC,  abi: ERC20_ABI, functionName: "balanceOf", args: [addr] }) as Promise<bigint>,
    c.pub.readContract({ address: TOKENS.WETH,  abi: ERC20_ABI, functionName: "balanceOf", args: [addr] }) as Promise<bigint>,
    c.pub.readContract({ address: TOKENS.cbBTC, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] }) as Promise<bigint>,
    c.pub.getBalance({ address: addr }),
  ]);

  return {
    address: addr,
    usdc:   parseFloat(formatUnits(usdcRaw,  TOKEN_DECIMALS.USDC)),
    weth:   parseFloat(formatUnits(wethRaw,  TOKEN_DECIMALS.WETH)),
    cbbtc:  parseFloat(formatUnits(cbbtcRaw, TOKEN_DECIMALS.cbBTC)),
    ethGas: parseFloat(formatUnits(ethRaw,   18)),
  };
}

// ─── Approve ───────────────────────────────────────────────────────────────────
async function ensureApproval(
  pub: any,
  wal: any,
  token: Address,
  owner: Address,
  amount: bigint,
) {
  const allowance = await pub.readContract({
    address: token, abi: ERC20_ABI, functionName: "allowance", args: [owner, SWAP_ROUTER],
  }) as bigint;
  if (allowance >= amount) return;

  logger.info({ token }, "Approving token spend");
  const hash = await (wal as any).writeContract({
    chain: base,
    address: token, abi: ERC20_ABI, functionName: "approve",
    args: [SWAP_ROUTER, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
  }) as `0x${string}`;
  await (pub as any).waitForTransactionReceipt({ hash });
  logger.info({ hash }, "Approval confirmed");
}

// ─── Core swap ─────────────────────────────────────────────────────────────────
async function swap(
  tokenIn: Address,
  tokenOut: Address,
  fee: number,
  amountIn: bigint,
  amountOutMin: bigint,
): Promise<Hash> {
  const c = clients();
  if (!c) throw new Error("DEX wallet not configured");

  await ensureApproval(c.pub, c.wal, tokenIn, c.account.address, amountIn);

  const hash = await (c.wal as any).writeContract({
    chain: base,
    address: SWAP_ROUTER,
    abi: SWAP_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn, tokenOut, fee,
      recipient: c.account.address,
      amountIn,
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: 0n,
    }],
  }) as `0x${string}`;

  logger.info({ hash, tokenIn, tokenOut }, "Swap tx submitted");
  const receipt = await (c.pub as any).waitForTransactionReceipt({ hash, timeout: 120_000 });
  logger.info({ hash, status: receipt.status }, "Swap confirmed");
  if (receipt.status !== "success") throw new Error(`Swap ${hash} reverted on-chain`);
  return hash;
}

// ─── Auto-refill: swap ETH → USDC when balance is too low to trade ────────────
const MIN_USDC_TO_TRADE   = 3;   // below this, attempt a refill before buying
const REFILL_TARGET_USDC  = 15;  // try to top up to this amount
const GAS_RESERVE_ETH     = 0.003; // always leave this much ETH for gas (~$6-10)

async function autoRefillUsdc(): Promise<void> {
  if (_refilling) return; // already in progress
  if (_lastEthPrice <= 0) return; // ETH price not yet known — skip

  const c = clients();
  if (!c) return;

  const usdcRaw = await c.pub.readContract({
    address: TOKENS.USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [c.account.address],
  }) as bigint;
  const usdcBalance = parseFloat(formatUnits(usdcRaw, TOKEN_DECIMALS.USDC));

  if (usdcBalance >= MIN_USDC_TO_TRADE) return; // enough USDC — nothing to do

  const ethRaw   = await c.pub.getBalance({ address: c.account.address });
  const ethBal   = parseFloat(formatUnits(ethRaw, 18));
  const ethAvail = Math.max(0, ethBal - GAS_RESERVE_ETH);

  if (ethAvail <= 0) {
    logger.warn({ ethBal, usdcBalance }, "DEX auto-refill: not enough ETH above gas reserve");
    return;
  }

  // Use tracked ETH price (always correct regardless of which signal triggered the BUY)
  const ethPrice    = _lastEthPrice;
  const usdcNeeded  = REFILL_TARGET_USDC - usdcBalance;
  const ethToSwap   = Math.min(ethAvail, usdcNeeded / ethPrice);
  // Use 9 decimal places to avoid float precision issues with parseUnits
  const amountIn    = parseUnits(ethToSwap.toFixed(9), 18);
  const expectedOut = ethToSwap * ethPrice;
  const amountOutMin = parseUnits((expectedOut * (1 - SLIPPAGE)).toFixed(TOKEN_DECIMALS.USDC), TOKEN_DECIMALS.USDC);

  _refilling = true;
  logger.info({ ethToSwap, expectedUsdc: expectedOut, currentUsdc: usdcBalance, ethPrice }, "DEX auto-refill: wrapping ETH → USDC");

  try {
    // Step 1: wrap native ETH → WETH via deposit()
    const wrapHash = await (c.wal as any).writeContract({
      chain: base,
      address: TOKENS.WETH,
      abi: WETH_ABI,
      functionName: "deposit",
      value: amountIn,
    }) as `0x${string}`;
    await (c.pub as any).waitForTransactionReceipt({ hash: wrapHash });
    logger.info({ wrapHash, ethToSwap }, "DEX auto-refill: ETH wrapped to WETH");

    // Step 2: approve + swap WETH → USDC
    await ensureApproval(c.pub, c.wal, TOKENS.WETH, c.account.address, amountIn);
    const swapHash = await swap(TOKENS.WETH, TOKENS.USDC, 500, amountIn, amountOutMin);
    logger.info({ swapHash, expectedUsdc: expectedOut }, "DEX auto-refill: WETH swapped to USDC");
  } catch (err) {
    logger.error({ err }, "DEX auto-refill failed (non-fatal — will proceed with available USDC)");
  } finally {
    _refilling = false;
  }
}

// ─── BUY ──────────────────────────────────────────────────────────────────────
export async function executeBuy(symbol: string, price: number, signalId?: number, composite = 0.5): Promise<boolean> {
  if (!_state.enabled || !_state.configured) return false;
  if (!SYMBOL_MAP[symbol]) return false; // SOL not on Base
  return withLock(`dex:${symbol}`, () => executeBuyLocked(symbol, price, signalId, composite));
}

async function executeBuyLocked(symbol: string, price: number, signalId: number | undefined, composite: number): Promise<boolean> {

  const existing = _state.positions[symbol];
  const track = _scaleIns.get(symbol);
  const multiplier = scaling.calcMultiplier(composite);
  const scalingIn = Boolean(existing);
  if (scalingIn && !scaling.shouldScaleIn(track?.scaleIns ?? 0, composite, track?.entryComposite ?? 0.15)) {
    logger.info({ symbol, composite }, "DEX: scale-in skipped — signal not stronger than entry");
    return false;
  }

  const c = clients();
  if (!c) return false;

  // Auto-refill USDC from ETH if balance is too low before attempting the trade
  await autoRefillUsdc();

  const usdcRaw = await c.pub.readContract({
    address: TOKENS.USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [c.account.address],
  }) as bigint;
  const usdcBalance = parseFloat(formatUnits(usdcRaw, TOKEN_DECIMALS.USDC));
  let spendUsdc = scalingIn
    ? Math.min(MAX_PER_TRADE_USDC, usdcBalance * 0.33) * multiplier * 0.5
    : Math.min(MAX_PER_TRADE_USDC, usdcBalance * 0.33) * multiplier;

  if (spendUsdc < 1) {
    logger.warn({ symbol, usdcBalance }, "DEX: insufficient USDC to BUY");
    return false;
  }

  // ── Risk gate ─────────────────────────────────────────────────────────────
  const decision = await risk.checkEntry({ venue: "base-dex", symbol, usd: spendUsdc });
  if (!decision.allowed) return false;
  spendUsdc = decision.usd;
  if (spendUsdc < 1) return false;

  const { token, key, fee } = SYMBOL_MAP[symbol]!;
  const decimals = TOKEN_DECIMALS[key];
  const amountIn     = parseUnits(spendUsdc.toFixed(TOKEN_DECIMALS.USDC), TOKEN_DECIMALS.USDC);
  const expectedOut  = spendUsdc / price;
  const amountOutMin = parseUnits((expectedOut * (1 - SLIPPAGE)).toFixed(decimals), decimals);

  try {
    const hash = await swap(TOKENS.USDC, token, fee, amountIn, amountOutMin);
    risk.recordOrderSuccess();
    _state.totalTrades++;
    sendAlert("info", `DEX ${existing ? "SCALE-IN" : "BUY"} ${symbol}: $${spendUsdc.toFixed(2)} @ ~${price.toFixed(2)} (tx ${hash})`, `dexbuy:${hash}`);
    if (existing) {
      const totalQty = existing.quantity + expectedOut;
      const avgPrice = ((existing.quantity * existing.avgEntryPrice) + (expectedOut * price)) / totalQty;
      _state.positions[symbol] = { ...existing, quantity: totalQty, avgEntryPrice: avgPrice };
      _scaleIns.set(symbol, {
        entryComposite: track?.entryComposite ?? composite,
        scaleIns: (track?.scaleIns ?? 0) + 1,
      });
      await db.insert(tradesTable).values({
        symbol, side: "DEX_SCALE_IN", price,
        quantity: expectedOut, value: spendUsdc,
        realizedPnl: null, signalId: signalId ?? null,
        txHash: hash,
      });
      await persistPositions();
      logger.info({ symbol, expectedOut, spendUsdc, price, hash }, "DEX SCALE-IN executed");
      return true;
    }

    _state.positions[symbol] = {
      symbol,
      quantity: expectedOut,
      avgEntryPrice: price,
      openedAt: new Date().toISOString(),
    };
    _scaleIns.set(symbol, { entryComposite: composite, scaleIns: 0 });

    await db.insert(tradesTable).values({
      symbol, side: "DEX_BUY", price,
      quantity: expectedOut, value: spendUsdc,
      realizedPnl: null, signalId: signalId ?? null,
      txHash: hash,
    });

    await persistPositions();
    logger.info({ symbol, spendUsdc, price, hash }, "DEX BUY executed");
    return true;
  } catch (err) {
    logger.error({ err, symbol }, "DEX BUY failed");
    await risk.recordOrderFailure("base-dex", symbol, err);
    return false;
  }
}

// ─── SELL ─────────────────────────────────────────────────────────────────────
export async function executeSell(symbol: string, price: number, signalId?: number): Promise<boolean> {
  // Exits are never blocked by the risk layer or the enabled flag.
  if (!_state.configured) return false;
  if (!SYMBOL_MAP[symbol]) return false;
  return withLock(`dex:${symbol}`, () => executeSellLocked(symbol, price, signalId));
}

async function executeSellLocked(symbol: string, price: number, signalId?: number): Promise<boolean> {

  const position = _state.positions[symbol];
  if (!position) {
    logger.info({ symbol }, "DEX: no open position to sell");
    return false;
  }

  const c = clients();
  if (!c) return false;

  const { token, key, fee } = SYMBOL_MAP[symbol]!;
  const decimals = TOKEN_DECIMALS[key];

   const walletTokenRaw = await c.pub.readContract({
    address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [c.account.address],
  }) as bigint;
   const walletTokenBalance = parseFloat(formatUnits(walletTokenRaw, decimals));

   if (walletTokenBalance < 1e-8) {
    logger.warn({ symbol }, "DEX: on-chain token balance is zero, clearing position");
    delete _state.positions[symbol];
    await persistPositions();
    sendAlert("warn", `DEX ${symbol}: tracked position had zero on-chain balance — cleared`, `dexzero:${symbol}`);
    return false;
  }

   // Sell only the quantity tracked by this bot. Never liquidate unrelated
   // tokens already held in the wallet.
   const trackedQuantity = Math.min(position.quantity, walletTokenBalance);
   const tokenRaw = parseUnits(trackedQuantity.toFixed(decimals), decimals);
   const expectedUsdc = trackedQuantity * price;
  const amountOutMin = parseUnits((expectedUsdc * (1 - SLIPPAGE)).toFixed(TOKEN_DECIMALS.USDC), TOKEN_DECIMALS.USDC);

  try {
    const hash = await swap(token, TOKENS.USDC, fee, tokenRaw, amountOutMin);
    risk.recordOrderSuccess();
    const cost         = position.quantity * position.avgEntryPrice;
    const realizedPnl  = expectedUsdc - cost;

    _state.totalTrades++;
    delete _state.positions[symbol];
    _hwDex.delete(symbol);
    _scaleIns.delete(symbol);

    // Auto-compound: grow budget by fraction of realized profit
    const compound = scaling.compoundAmount(realizedPnl);
    if (compound > 0) {
      _state.budgetUsdc += compound;
      logger.info({ compound, newBudget: _state.budgetUsdc }, "DEX auto-compound applied");
    }

    await db.insert(tradesTable).values({
      symbol, side: "DEX_SELL", price,
      quantity: trackedQuantity, value: expectedUsdc,
      realizedPnl, signalId: signalId ?? null,
      txHash: hash,
    });

    await persistPositions();
    logger.info({ symbol, trackedQuantity, price, realizedPnl, hash }, "DEX SELL executed");
    sendAlert("info", `DEX SELL ${symbol}: ${trackedQuantity} @ ~${price.toFixed(2)} | PnL ${realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)} USD (tx ${hash})`, `dexsell:${hash}`);
    return true;
  } catch (err) {
    logger.error({ err, symbol }, "DEX SELL failed");
    await risk.recordOrderFailure("base-dex", symbol, err);
    sendAlert("critical", `DEX SELL FAILED ${symbol} — position still open, check wallet manually`, `dexsellfail:${symbol}`);
    return false;
  }
}

// Trailing high-water per symbol
const _hwDex = new Map<string, number>();

// ─── Stop-loss / take-profit check ────────────────────────────────────────────
export function checkSlTp(symbol: string, currentPrice: number): void {
  const position = _state.positions[symbol];
  if (!position) { _hwDex.delete(symbol); return; }

  const prev = _hwDex.get(symbol) ?? position.avgEntryPrice;
  const hw = Math.max(prev, currentPrice);
  _hwDex.set(symbol, hw);

  const stopRef = scaling.highWaterPrice(position.avgEntryPrice, hw);
  if (scaling.isStopLoss(stopRef, currentPrice)) {
    logger.info({ symbol, entry: position.avgEntryPrice, hw, current: currentPrice }, "DEX trailing stop-loss triggered");
    executeSell(symbol, currentPrice).catch((err) => logger.error({ err, symbol }, "DEX stop-loss sell error"));
  } else if (scaling.isTakeProfit(position.avgEntryPrice, currentPrice)) {
    logger.info({ symbol, entry: position.avgEntryPrice, current: currentPrice }, "DEX take-profit triggered");
    executeSell(symbol, currentPrice).catch((err) => logger.error({ err, symbol }, "DEX take-profit sell error"));
  }
}

/** Close every open DEX position (kill switch "flatten"). */
export async function flattenAll(getPrice: (symbol: string) => number | undefined): Promise<void> {
  for (const symbol of Object.keys(_state.positions)) {
    // Use the latest market price for the slippage floor — entry price could
    // make the swap revert after a drop.
    const px = getPrice(symbol) ?? _state.positions[symbol]?.avgEntryPrice ?? 0;
    await executeSell(symbol, px);
  }
}

// ─── Portfolio snapshot ────────────────────────────────────────────────────────
export async function getDexPortfolio() {
  const trades = await db.select().from(tradesTable).orderBy();
  const dexOnly = trades.filter((t) => t.side.startsWith("DEX_"));
  const sells    = dexOnly.filter((t) => t.side === "DEX_SELL" && t.realizedPnl !== null);
  const wins     = sells.filter((t) => (t.realizedPnl ?? 0) > 0).length;
  const losses   = sells.filter((t) => (t.realizedPnl ?? 0) <= 0).length;
  const totalPnl = sells.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
  const winRate  = sells.length > 0 ? (wins / sells.length) * 100 : 0;

  let balances = null;
  if (_state.configured) {
    try { balances = await getBalances(); } catch (_) {}
  }

  return {
    enabled:    _state.enabled,
    configured: _state.configured,
    walletAddress: _state.walletAddress,
    budgetUsdc: _state.budgetUsdc,
    openPositions: Object.values(_state.positions),
    balances,
    trades: dexOnly.slice(-50).reverse().map((t) => ({
      id:          t.id,
      symbol:      t.symbol,
      side:        t.side,
      quantity:    t.quantity,
      price:       t.price,
      value:       t.value,
       realizedPnl: t.realizedPnl,
       executionId: t.executionId,
       txHash:      t.txHash,
       timestamp:   t.createdAt.toISOString(),
    })),
    totalTrades: dexOnly.length,
    closedTrades: sells.length,
    wins, losses, winRate, totalPnl,
  };
}
