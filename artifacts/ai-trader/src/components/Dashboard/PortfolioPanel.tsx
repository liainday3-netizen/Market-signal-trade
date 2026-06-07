import { useGetPortfolio, useResetPortfolio, getGetPortfolioQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet, RotateCcw, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

function PnLValue({ value, percent, size = "sm" }: { value: number; percent?: number; size?: "sm" | "lg" }) {
  const isUp = value >= 0;
  const sizing = size === "lg" ? "text-2xl" : "text-sm";
  return (
    <span className={cn(sizing, "font-mono font-bold tabular-nums", isUp ? "text-buy" : "text-sell")}>
      {isUp ? "+" : ""}${value.toFixed(2)}
      {percent !== undefined && (
        <span className={cn("ml-1.5 text-xs opacity-80")}>
          ({isUp ? "+" : ""}{percent.toFixed(2)}%)
        </span>
      )}
    </span>
  );
}

interface PositionData {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  highWaterPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  openedAt: string;
}

function SlTpBar({ pos }: { pos: PositionData }) {
  const sl = pos.stopLossPrice;
  const tp = pos.takeProfitPrice;
  const curr = pos.currentPrice;
  if (!sl || !tp) return null;

  const distToSl = ((curr - sl) / curr) * 100;
  const distToTp = ((tp - curr) / curr) * 100;
  const range = tp - sl;
  const fillPct = range > 0 ? Math.max(0, Math.min(100, ((curr - sl) / range) * 100)) : 50;

  return (
    <div className="mt-1.5 space-y-0.5">
      <div className="relative h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-sell/60 via-hold/40 to-buy/60"
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] font-mono">
        <span className="text-sell/70">SL ${sl.toFixed(sl > 100 ? 0 : 2)} <span className="text-muted-foreground/40">({distToSl.toFixed(1)}%)</span></span>
        <span className="text-buy/70">TP ${tp.toFixed(tp > 100 ? 0 : 2)} <span className="text-muted-foreground/40">({distToTp.toFixed(1)}%)</span></span>
      </div>
    </div>
  );
}

export function PortfolioPanel() {
  const qc = useQueryClient();
  const { data: portfolio, isLoading } = useGetPortfolio({
    query: { queryKey: getGetPortfolioQueryKey(), refetchInterval: 3000 },
  });

  const { mutate: reset, isPending: isResetting } = useResetPortfolio({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetPortfolioQueryKey() }),
    },
  });

  if (isLoading || !portfolio) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground">Paper Portfolio</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse h-32 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  const positions = portfolio.positions as PositionData[];

  return (
    <Card className={cn("border", portfolio.pnl >= 0 ? "border-buy/20" : "border-sell/20")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground flex items-center gap-2">
            <Wallet className="w-3.5 h-3.5" />
            Paper Portfolio
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reset()}
            disabled={isResetting}
            className="h-6 px-2.5 text-[11px] font-mono"
            title="Reset portfolio to starting capital"
          >
            <RotateCcw className={cn("w-2.5 h-2.5 mr-1", isResetting && "animate-spin")} />
            RESET
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Equity headline */}
        <div className="flex items-end justify-between p-3 rounded-md bg-background/50 border border-border/40">
          <div>
            <p className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-widest mb-1">Total Equity</p>
            <p className="text-3xl font-mono font-bold text-foreground tabular-nums">
              ${portfolio.equity.toFixed(2)}
            </p>
            <div className="mt-1">
              <PnLValue value={portfolio.pnl} percent={portfolio.pnlPercent} />
            </div>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-widest">Start</p>
            <p className="text-sm font-mono text-muted-foreground tabular-nums">${portfolio.startingCapital.toFixed(2)}</p>
            <p className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-widest mt-2">Cash</p>
            <p className="text-sm font-mono text-foreground tabular-nums">${portfolio.cash.toFixed(2)}</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Trades", value: portfolio.totalTrades.toString() },
            { label: "Closed", value: portfolio.closedTrades.toString() },
            { label: "Win Rate", value: `${portfolio.winRate.toFixed(0)}%`, color: portfolio.winRate >= 50 ? "text-buy" : portfolio.winRate > 0 ? "text-hold" : "text-muted-foreground" },
            { label: "Realized", value: `${portfolio.totalRealizedPnl >= 0 ? "+" : ""}$${portfolio.totalRealizedPnl.toFixed(2)}`, color: portfolio.totalRealizedPnl >= 0 ? "text-buy" : "text-sell" },
          ].map((s) => (
            <div key={s.label} className="flex flex-col bg-background/60 px-2 py-1.5 rounded border border-border/30">
              <span className="text-[9px] font-mono text-muted-foreground/60 uppercase">{s.label}</span>
              <span className={cn("text-sm font-mono font-bold tabular-nums", s.color ?? "text-foreground")}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Open positions */}
        <div>
          <p className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-1.5">
            Open Positions ({positions.length})
          </p>
          {positions.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/40 font-mono text-center py-3 border border-dashed border-border/40 rounded">
              No open positions
            </p>
          ) : (
            <div className="space-y-2">
              {positions.map((pos) => {
                const isUp = pos.unrealizedPnl >= 0;
                return (
                  <div key={pos.symbol} className="p-2 rounded bg-background/40 border border-border/30">
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold", isUp ? "text-buy bg-buy/10" : "text-sell bg-sell/10")}>
                        {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                        {pos.symbol.replace("/USDT", "")}
                      </span>
                      <div className="flex-1 grid grid-cols-3 gap-2 text-[10px] font-mono">
                        <div>
                          <span className="text-muted-foreground/50">Qty </span>
                          <span className="text-foreground tabular-nums">{pos.quantity.toFixed(6)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/50">Entry </span>
                          <span className="text-foreground tabular-nums">${pos.avgEntryPrice.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/50">Now </span>
                          <span className="text-foreground tabular-nums">${pos.currentPrice.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <PnLValue value={pos.unrealizedPnl} percent={pos.unrealizedPnlPercent} />
                      </div>
                    </div>
                    <SlTpBar pos={pos} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent trades */}
        <div>
          <p className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-1.5">Recent Trades</p>
          {portfolio.trades.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/40 font-mono text-center py-3 border border-dashed border-border/40 rounded">
              No trades yet — waiting for BUY/SELL signals
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {portfolio.trades.slice(0, 12).map((t) => (
                <div key={t.id} className="flex items-center gap-2 py-1 border-b border-border/20 text-[10px] font-mono">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[9px] font-bold w-14 text-center",
                    t.side === "BUY" ? "text-buy bg-buy/10" :
                    t.side === "SELL" ? "text-sell bg-sell/10" :
                    "text-hold bg-hold/10"
                  )}>
                    {t.side}
                  </span>
                  <span className="text-foreground w-12">{t.symbol.replace("/USDT", "")}</span>
                  <span className="text-muted-foreground tabular-nums w-20">${t.value.toFixed(2)}</span>
                  <span className="text-muted-foreground/60 tabular-nums">@${t.price.toFixed(2)}</span>
                  {t.realizedPnl !== null && t.realizedPnl !== undefined && (
                    <span className={cn("ml-auto tabular-nums font-bold", t.realizedPnl >= 0 ? "text-buy" : "text-sell")}>
                      {t.realizedPnl >= 0 ? "+" : ""}${t.realizedPnl.toFixed(2)}
                    </span>
                  )}
                  <span className="ml-auto text-muted-foreground/40 text-[9px]">
                    {format(new Date(t.timestamp), "HH:mm:ss")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
