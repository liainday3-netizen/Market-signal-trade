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
import { db, tradesTable } from "@workspace/db";
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
const SLIPPAGE = 0.01;

// ─── Client helpers ────────────────────────────────────────────────────────────
function getAccount() {
  const raw = process.env.DEX_WALLET_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const pk = raw.startsWith("0x") ? raw : (`0x${raw}` as `0x${string}`);
  try { return privateKeyToAccount(pk as `0x${string}`); } catch { return null; }
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
  const receipt = await (c.pub as any).waitForTransactionReceipt({ hash });
  logger.info({ hash, status: receipt.status }, "Swap confirmed");
  return hash;
}

// ─── BUY ──────────────────────────────────────────────────────────────────────
export async function executeBuy(symbol: string, price: number, signalId?: number, composite = 0.5): Promise<boolean> {
  if (!_state.enabled || !_state.configured) return false;
  if (!SYMBOL_MAP[symbol]) return false; // SOL not on Base

  if (_state.positions[symbol]) {
    logger.info({ symbol }, "DEX: already have open position, skipping BUY");
    return false;
  }

  const c = clients();
  if (!c) return false;

  const usdcRaw = await c.pub.readContract({
    address: TOKENS.USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [c.account.address],
  }) as bigint;
  const usdcBalance = parseFloat(formatUnits(usdcRaw, TOKEN_DECIMALS.USDC));
  const multiplier = scaling.calcMultiplier(composite);
  const spendUsdc = Math.min(MAX_PER_TRADE_USDC, usdcBalance * 0.33) * multiplier;

  if (spendUsdc < 1) {
    logger.warn({ symbol, usdcBalance }, "DEX: insufficient USDC to BUY");
    return false;
  }

  const { token, key, fee } = SYMBOL_MAP[symbol]!;
  const decimals = TOKEN_DECIMALS[key];
  const amountIn     = parseUnits(spendUsdc.toFixed(TOKEN_DECIMALS.USDC), TOKEN_DECIMALS.USDC);
  const expectedOut  = spendUsdc / price;
  const amountOutMin = parseUnits((expectedOut * (1 - SLIPPAGE)).toFixed(decimals), decimals);

  try {
    const hash = await swap(TOKENS.USDC, token, fee, amountIn, amountOutMin);
    _state.totalTrades++;
    _state.positions[symbol] = {
      symbol,
      quantity: expectedOut,
      avgEntryPrice: price,
      openedAt: new Date().toISOString(),
    };

    await db.insert(tradesTable).values({
      symbol, side: "DEX_BUY", price,
      quantity: expectedOut, value: spendUsdc,
      realizedPnl: null, signalId: signalId ?? null,
    });

    logger.info({ symbol, spendUsdc, price, hash }, "DEX BUY executed");
    return true;
  } catch (err) {
    logger.error({ err, symbol }, "DEX BUY failed");
    return false;
  }
}

// ─── SELL ─────────────────────────────────────────────────────────────────────
export async function executeSell(symbol: string, price: number, signalId?: number): Promise<boolean> {
  if (!_state.enabled || !_state.configured) return false;
  if (!SYMBOL_MAP[symbol]) return false;

  const position = _state.positions[symbol];
  if (!position) {
    logger.info({ symbol }, "DEX: no open position to sell");
    return false;
  }

  const c = clients();
  if (!c) return false;

  const { token, key, fee } = SYMBOL_MAP[symbol]!;
  const decimals = TOKEN_DECIMALS[key];

  const tokenRaw = await c.pub.readContract({
    address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [c.account.address],
  }) as bigint;
  const tokenBalance = parseFloat(formatUnits(tokenRaw, decimals));

  if (tokenBalance < 1e-8) {
    logger.warn({ symbol }, "DEX: on-chain token balance is zero, clearing position");
    delete _state.positions[symbol];
    return false;
  }

  const expectedUsdc = tokenBalance * price;
  const amountOutMin = parseUnits((expectedUsdc * (1 - SLIPPAGE)).toFixed(TOKEN_DECIMALS.USDC), TOKEN_DECIMALS.USDC);

  try {
    const hash = await swap(token, TOKENS.USDC, fee, tokenRaw, amountOutMin);
    const cost         = position.quantity * position.avgEntryPrice;
    const realizedPnl  = expectedUsdc - cost;

    _state.totalTrades++;
    delete _state.positions[symbol];
    _hwDex.delete(symbol);

    // Auto-compound: grow budget by fraction of realized profit
    const compound = scaling.compoundAmount(realizedPnl);
    if (compound > 0) {
      _state.budgetUsdc += compound;
      logger.info({ compound, newBudget: _state.budgetUsdc }, "DEX auto-compound applied");
    }

    await db.insert(tradesTable).values({
      symbol, side: "DEX_SELL", price,
      quantity: tokenBalance, value: expectedUsdc,
      realizedPnl, signalId: signalId ?? null,
    });

    logger.info({ symbol, tokenBalance, price, realizedPnl, hash }, "DEX SELL executed");
    return true;
  } catch (err) {
    logger.error({ err, symbol }, "DEX SELL failed");
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
    executeSell(symbol, currentPrice).catch(() => {});
  } else if (scaling.isTakeProfit(position.avgEntryPrice, currentPrice)) {
    logger.info({ symbol, entry: position.avgEntryPrice, current: currentPrice }, "DEX take-profit triggered");
    executeSell(symbol, currentPrice).catch(() => {});
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
      timestamp:   t.createdAt.toISOString(),
    })),
    totalTrades: dexOnly.length,
    closedTrades: sells.length,
    wins, losses, winRate, totalPnl,
  };
}
