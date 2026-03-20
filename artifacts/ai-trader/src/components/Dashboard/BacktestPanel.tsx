import { BacktestStats } from "@workspace/api-client-react/src/generated/api.schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface BacktestPanelProps {
  backtest?: BacktestStats;
  isLoading: boolean;
}

interface StatItem {
  label: string;
  value: string;
  color: string;
  sub: string;
}

export function BacktestPanel({ backtest, isLoading }: BacktestPanelProps) {
  if (isLoading || !backtest) {
    return (
      <Card className="h-full">
        <CardHeader><CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground">Backtest (Walk-Forward)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 animate-pulse">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded-md" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const stats: StatItem[] = [
    {
      label: "Win Rate",
      value: (backtest.winRate * 100).toFixed(1) + "%",
      color: backtest.winRate >= 0.55 ? "text-buy" : backtest.winRate >= 0.45 ? "text-hold" : "text-sell",
      sub: backtest.winRate >= 0.55 ? "Above avg" : backtest.winRate < 0.45 ? "Below avg" : "Breakeven",
    },
    {
      label: "Sharpe Ratio",
      value: backtest.sharpeRatio.toFixed(2),
      color: backtest.sharpeRatio >= 1.5 ? "text-buy" : backtest.sharpeRatio >= 0.5 ? "text-hold" : "text-sell",
      sub: backtest.sharpeRatio >= 1.5 ? "Excellent" : backtest.sharpeRatio >= 0.5 ? "Acceptable" : "Poor",
    },
    {
      label: "Avg Return",
      value: (backtest.avgReturn * 100).toFixed(3) + "%",
      color: backtest.avgReturn >= 0 ? "text-buy" : "text-sell",
      sub: "per trade",
    },
    {
      label: "Max Drawdown",
      value: (backtest.maxDrawdown * 100).toFixed(2) + "%",
      color: backtest.maxDrawdown <= 0.05 ? "text-buy" : backtest.maxDrawdown <= 0.15 ? "text-hold" : "text-sell",
      sub: backtest.maxDrawdown <= 0.05 ? "Low risk" : backtest.maxDrawdown <= 0.15 ? "Moderate" : "High risk",
    },
    {
      label: "Profit Factor",
      value: backtest.profitFactor.toFixed(2),
      color: backtest.profitFactor >= 1.5 ? "text-buy" : backtest.profitFactor >= 1.0 ? "text-hold" : "text-sell",
      sub: backtest.profitFactor >= 1.5 ? "Strong" : backtest.profitFactor >= 1.0 ? "Marginal" : "Losing",
    },
    {
      label: "Total Trades",
      value: backtest.totalTrades.toString(),
      color: "text-foreground",
      sub: "on 100 candles",
    },
  ];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground">Backtest (Walk-Forward)</CardTitle>
          <span className="text-[10px] font-mono text-muted-foreground/50 bg-secondary px-2 py-0.5 rounded border border-border">
            100 candles
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 grid grid-cols-3 gap-2 content-start">
        {stats.map((s, i) => (
          <div key={i} className="flex flex-col bg-background/60 px-2.5 py-2.5 rounded-md border border-border/40">
            <span className="text-[10px] text-muted-foreground font-mono mb-0.5 uppercase tracking-wide">{s.label}</span>
            <span className={cn("text-base font-mono font-bold leading-tight", s.color)}>
              {s.value}
            </span>
            <span className="text-[9px] text-muted-foreground/50 mt-0.5">{s.sub}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
