// ─── Scaling Engine ───────────────────────────────────────────────────────────
// Centralised config + helpers used by paper, live, and DEX traders.

export interface ScalingConfig {
  enabled:          boolean;
  mode:             "fixed" | "tiered" | "linear";
  stopLossPct:      number;      // % drop to auto-sell (0 = off)
  takeProfitPct:    number;      // % gain to auto-sell (0 = off)
  trailingStop:     boolean;     // stop-loss follows price up (trailing)
  scaleInEnabled:   boolean;     // allow adding to an existing position
  maxScaleIns:      number;      // max additional entries (1–3)
  autoCompound:     boolean;     // reinvest a fraction of realized profits
  compoundFraction: number;      // fraction of profit reinvested (0.0–1.0)
}

const DEFAULTS: ScalingConfig = {
  enabled:          true,     // on by default → activates with auto-loop
  mode:             "tiered",
  stopLossPct:      3,
  takeProfitPct:    5,
  trailingStop:     true,     // trailing stop protects gains automatically
  scaleInEnabled:   false,
  maxScaleIns:      2,
  autoCompound:     true,     // reinvest 50% of profits by default
  compoundFraction: 0.5,
};

let _cfg: ScalingConfig = { ...DEFAULTS };

export function getConfig(): ScalingConfig { return { ..._cfg }; }

export function setConfig(patch: Partial<ScalingConfig>): ScalingConfig {
  const mode = patch.mode === "fixed" || patch.mode === "tiered" || patch.mode === "linear"
    ? patch.mode
    : undefined;
  _cfg = {
    ..._cfg,
    ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
    ...(mode ? { mode } : {}),
    ...(typeof patch.stopLossPct === "number" ? { stopLossPct: Math.max(0, Math.min(50, patch.stopLossPct)) } : {}),
    ...(typeof patch.takeProfitPct === "number" ? { takeProfitPct: Math.max(0, Math.min(200, patch.takeProfitPct)) } : {}),
    ...(typeof patch.trailingStop === "boolean" ? { trailingStop: patch.trailingStop } : {}),
    ...(typeof patch.scaleInEnabled === "boolean" ? { scaleInEnabled: patch.scaleInEnabled } : {}),
    ...(typeof patch.maxScaleIns === "number" ? { maxScaleIns: Math.max(1, Math.min(3, Math.floor(patch.maxScaleIns))) } : {}),
    ...(typeof patch.autoCompound === "boolean" ? { autoCompound: patch.autoCompound } : {}),
    ...(typeof patch.compoundFraction === "number" ? { compoundFraction: Math.max(0, Math.min(1, patch.compoundFraction)) } : {}),
  };
  return { ..._cfg };
}

export function resetConfig(): ScalingConfig {
  _cfg = { ...DEFAULTS };
  return { ..._cfg };
}

// ─── Position-size multiplier (0 < m ≤ 1) ────────────────────────────────────
// `composite` is the raw factor score: BUY > 0.15, SELL < −0.15.
export function calcMultiplier(composite: number): number {
  if (!_cfg.enabled) return 1.0;

  const abs = Math.abs(composite);

  switch (_cfg.mode) {
    case "linear": {
      const MIN = 0.15;
      return Math.min(1.0, Math.max(0.10, (abs - MIN) / (1.0 - MIN)));
    }
    case "tiered": {
      if (abs >= 0.70) return 1.00;
      if (abs >= 0.50) return 0.75;
      if (abs >= 0.30) return 0.50;
      return 0.25;
    }
    case "fixed":
    default:
      return 1.0;
  }
}

// ─── Stop-loss check ──────────────────────────────────────────────────────────
// `highWaterPrice` = entryPrice when trailingStop is off,
//                  = max(entryPrice, highestPriceSeen) when on.
export function isStopLoss(highWaterPrice: number, currentPrice: number): boolean {
  if (!_cfg.stopLossPct || _cfg.stopLossPct <= 0) return false;
  return ((highWaterPrice - currentPrice) / highWaterPrice) * 100 >= _cfg.stopLossPct;
}

export function isTakeProfit(entryPrice: number, currentPrice: number): boolean {
  if (!_cfg.takeProfitPct || _cfg.takeProfitPct <= 0) return false;
  return ((currentPrice - entryPrice) / entryPrice) * 100 >= _cfg.takeProfitPct;
}

// ─── Trailing high-water price ────────────────────────────────────────────────
// Returns the price used as the SL reference: entry or trailing high.
export function highWaterPrice(entryPrice: number, highestSeen: number): number {
  return _cfg.trailingStop ? Math.max(entryPrice, highestSeen) : entryPrice;
}

// ─── Auto-compound: returns how much extra to add to the budget ───────────────
export function compoundAmount(realizedPnl: number): number {
  if (!_cfg.autoCompound || !_cfg.compoundFraction) return 0;
  return Math.max(0, realizedPnl * _cfg.compoundFraction);
}

// ─── Scale-in: should we add to an existing position? ────────────────────────
export function shouldScaleIn(
  existingScaleIns: number,
  newComposite: number,
  entryComposite: number,
): boolean {
  if (!_cfg.scaleInEnabled || !Number.isFinite(newComposite) || !Number.isFinite(entryComposite)) return false;
  if (existingScaleIns >= _cfg.maxScaleIns) return false;
  const baseline = Math.max(Math.abs(entryComposite), 0.15);
  return Math.abs(newComposite) >= baseline * 1.20;
}
