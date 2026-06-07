// ─── Scaling Engine ───────────────────────────────────────────────────────────
// Centralised config + helpers used by paper, live, and DEX traders.

export interface ScalingConfig {
  enabled:        boolean;
  mode:           "fixed" | "tiered" | "linear";
  stopLossPct:    number;   // % drop from entry to auto-sell  (0 = off)
  takeProfitPct:  number;   // % gain from entry to auto-sell  (0 = off)
  scaleInEnabled: boolean;  // allow adding to an existing position
  maxScaleIns:    number;   // max additional entries (1–3)
}

const DEFAULTS: ScalingConfig = {
  enabled:        false,
  mode:           "tiered",
  stopLossPct:    3,
  takeProfitPct:  5,
  scaleInEnabled: false,
  maxScaleIns:    2,
};

let _cfg: ScalingConfig = { ...DEFAULTS };

export function getConfig(): ScalingConfig { return { ..._cfg }; }

export function setConfig(patch: Partial<ScalingConfig>): ScalingConfig {
  _cfg = { ..._cfg, ...patch };
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

// ─── SL / TP helpers ──────────────────────────────────────────────────────────
export function isStopLoss(entryPrice: number, currentPrice: number): boolean {
  if (!_cfg.stopLossPct || _cfg.stopLossPct <= 0) return false;
  return ((entryPrice - currentPrice) / entryPrice) * 100 >= _cfg.stopLossPct;
}

export function isTakeProfit(entryPrice: number, currentPrice: number): boolean {
  if (!_cfg.takeProfitPct || _cfg.takeProfitPct <= 0) return false;
  return ((currentPrice - entryPrice) / entryPrice) * 100 >= _cfg.takeProfitPct;
}

// ─── Scale-in: should we add to an existing position? ────────────────────────
// Returns true when the new signal composite is meaningfully stronger than the
// entry composite (implies a higher-conviction re-entry is warranted).
export function shouldScaleIn(
  existingScaleIns: number,
  newComposite: number,
  entryComposite: number,
): boolean {
  if (!_cfg.scaleInEnabled) return false;
  if (existingScaleIns >= _cfg.maxScaleIns) return false;
  // Only scale in if the new signal is at least 20% stronger than the entry
  return Math.abs(newComposite) >= Math.abs(entryComposite) * 1.20;
}
