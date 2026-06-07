import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useGetScalingConfig,
  useSetScalingConfig,
  useResetScalingConfig,
  getGetScalingConfigQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TrendingUp, Shield, RotateCcw, ChevronDown, ChevronUp, Layers } from "lucide-react";

type ScalingMode = "fixed" | "tiered" | "linear";

const MODE_LABELS: Record<ScalingMode, string> = {
  fixed: "Fixed (100% always)",
  tiered: "Tiered (25/50/75/100%)",
  linear: "Linear (proportional)",
};

const MODE_DESC: Record<ScalingMode, string> = {
  fixed:  "Trade full size regardless of signal strength.",
  tiered: "Weak signal → 25%, medium → 50%, strong → 75%, very strong → 100%.",
  linear: "Size scales linearly with signal confidence from 10% to 100%.",
};

export function ScalingPanel() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: cfg, isLoading } = useGetScalingConfig({
    query: { queryKey: getGetScalingConfigQueryKey(), refetchInterval: 10000 },
  });

  const { mutateAsync: saveConfig } = useSetScalingConfig();
  const { mutateAsync: resetConfig } = useResetScalingConfig();

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetScalingConfigQueryKey() });

  async function patch(updates: Partial<typeof cfg>) {
    if (!cfg) return;
    setSaving(true);
    try {
      await saveConfig({ data: { ...cfg, ...updates } as typeof cfg });
      await invalidate();
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      await resetConfig();
      await invalidate();
    } finally {
      setSaving(false);
    }
  }

  const isActive = cfg?.enabled ?? false;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-mono tracking-widest flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-primary" />
            SCALING ENGINE
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              className={cn(
                "text-[10px] font-mono tracking-wider",
                isActive ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-muted text-muted-foreground border-border",
              )}
            >
              {isActive ? "ACTIVE" : "OFF"}
            </Badge>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading || !cfg ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            {/* ── Enable / Disable ── */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-mono">POSITION SCALING</span>
              <Button
                size="sm"
                variant={cfg.enabled ? "destructive" : "outline"}
                className="h-6 text-[10px] font-mono tracking-widest px-3"
                disabled={saving}
                onClick={() => patch({ enabled: !cfg.enabled })}
              >
                {cfg.enabled ? "DISABLE" : "ENABLE"}
              </Button>
            </div>

            {/* ── Summary pills ── */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/40 rounded p-2 space-y-0.5">
                <p className="text-[9px] text-muted-foreground font-mono">STOP LOSS</p>
                <p className={cn("text-sm font-mono font-bold", cfg.stopLossPct > 0 ? "text-red-400" : "text-muted-foreground")}>
                  {cfg.stopLossPct > 0 ? `-${cfg.stopLossPct}%` : "OFF"}
                </p>
              </div>
              <div className="bg-muted/40 rounded p-2 space-y-0.5">
                <p className="text-[9px] text-muted-foreground font-mono">TAKE PROFIT</p>
                <p className={cn("text-sm font-mono font-bold", cfg.takeProfitPct > 0 ? "text-emerald-400" : "text-muted-foreground")}>
                  {cfg.takeProfitPct > 0 ? `+${cfg.takeProfitPct}%` : "OFF"}
                </p>
              </div>
              <div className="bg-muted/40 rounded p-2 space-y-0.5">
                <p className="text-[9px] text-muted-foreground font-mono">SIZE MODE</p>
                <p className="text-[11px] font-mono font-bold text-foreground capitalize">{cfg.mode}</p>
              </div>
              <div className="bg-muted/40 rounded p-2 space-y-0.5">
                <p className="text-[9px] text-muted-foreground font-mono">SCALE-IN</p>
                <p className={cn("text-sm font-mono font-bold", cfg.scaleInEnabled ? "text-amber-400" : "text-muted-foreground")}>
                  {cfg.scaleInEnabled ? `×${cfg.maxScaleIns + 1}` : "OFF"}
                </p>
              </div>
            </div>

            {/* ── Expanded controls ── */}
            {expanded && (
              <div className="space-y-4 pt-2 border-t border-border">
                {/* Sizing mode */}
                <div>
                  <p className="text-[10px] text-muted-foreground font-mono mb-1.5">SIZING MODE</p>
                  <div className="space-y-1">
                    {(["fixed", "tiered", "linear"] as ScalingMode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => patch({ mode: m })}
                        className={cn(
                          "w-full text-left px-2 py-1.5 rounded text-[11px] font-mono border transition-all",
                          cfg.mode === m
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-border bg-muted/20 text-muted-foreground hover:text-foreground hover:border-border/80",
                        )}
                      >
                        <div className="font-semibold">{m.toUpperCase()}</div>
                        <div className="text-[10px] opacity-70 mt-0.5">{MODE_DESC[m]}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stop Loss */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                      <Shield className="w-3 h-3 text-red-400" /> STOP LOSS
                    </p>
                    <span className="text-[10px] font-mono text-red-400 font-bold">
                      {cfg.stopLossPct > 0 ? `-${cfg.stopLossPct}%` : "OFF"}
                    </span>
                  </div>
                  <input
                    type="range" min={0} max={10} step={0.5}
                    value={cfg.stopLossPct}
                    onChange={(e) => patch({ stopLossPct: parseFloat(e.target.value) })}
                    className="w-full accent-red-400 h-1.5"
                  />
                  <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5 font-mono">
                    <span>OFF</span><span>2%</span><span>5%</span><span>10%</span>
                  </div>
                </div>

                {/* Take Profit */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-emerald-400" /> TAKE PROFIT
                    </p>
                    <span className="text-[10px] font-mono text-emerald-400 font-bold">
                      {cfg.takeProfitPct > 0 ? `+${cfg.takeProfitPct}%` : "OFF"}
                    </span>
                  </div>
                  <input
                    type="range" min={0} max={20} step={0.5}
                    value={cfg.takeProfitPct}
                    onChange={(e) => patch({ takeProfitPct: parseFloat(e.target.value) })}
                    className="w-full accent-emerald-400 h-1.5"
                  />
                  <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5 font-mono">
                    <span>OFF</span><span>5%</span><span>10%</span><span>20%</span>
                  </div>
                </div>

                {/* Scale-in */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-mono">SCALE-IN (ADD TO WINNERS)</p>
                    <p className="text-[9px] text-muted-foreground opacity-60 mt-0.5">
                      Add to position on stronger repeat signal
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={cfg.scaleInEnabled ? "default" : "outline"}
                    className="h-6 text-[10px] font-mono tracking-widest px-2"
                    disabled={saving}
                    onClick={() => patch({ scaleInEnabled: !cfg.scaleInEnabled })}
                  >
                    {cfg.scaleInEnabled ? "ON" : "OFF"}
                  </Button>
                </div>

                {cfg.scaleInEnabled && (
                  <div>
                    <p className="text-[10px] text-muted-foreground font-mono mb-1.5">
                      MAX SCALE-INS: {cfg.maxScaleIns}
                    </p>
                    <input
                      type="range" min={1} max={3} step={1}
                      value={cfg.maxScaleIns}
                      onChange={(e) => patch({ maxScaleIns: parseInt(e.target.value) })}
                      className="w-full accent-amber-400 h-1.5"
                    />
                    <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5 font-mono">
                      <span>1×</span><span>2×</span><span>3×</span>
                    </div>
                  </div>
                )}

                {/* Reset */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-6 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                  disabled={saving}
                  onClick={handleReset}
                >
                  <RotateCcw className="w-3 h-3 mr-1" /> RESET DEFAULTS
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
