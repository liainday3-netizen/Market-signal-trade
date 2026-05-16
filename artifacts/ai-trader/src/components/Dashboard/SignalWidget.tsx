import { SignalResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface SignalWidgetProps {
  data?: SignalResponse;
  isLoading: boolean;
  livePrice?: number;
  livePriceConnected?: boolean;
}

export function SignalWidget({ data, isLoading, livePrice, livePriceConnected }: SignalWidgetProps) {
  if (isLoading || !data) {
    return (
      <Card className="h-full flex flex-col justify-center">
        <CardContent className="pt-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/3"></div>
            <div className="h-12 bg-muted rounded w-1/2"></div>
            <div className="h-4 bg-muted rounded w-1/4"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { signal, confidence, price, symbol, timeframe } = data;

  const getSignalConfig = (s: string) => {
    switch (s) {
      case "BUY": return { color: "text-buy", bg: "bg-buy/10", border: "border-buy/20", icon: TrendingUp, label: "Long" };
      case "SELL": return { color: "text-sell", bg: "bg-sell/10", border: "border-sell/20", icon: TrendingDown, label: "Short" };
      default: return { color: "text-hold", bg: "bg-hold/10", border: "border-hold/20", icon: Minus, label: "Neutral" };
    }
  };

  const config = getSignalConfig(signal);
  const Icon = config.icon;
  const confidencePct = Math.round(confidence * 100);
  const composite = data.factorScores?.composite ?? 0;
  const compositeBar = ((composite + 1) / 2) * 100;

  return (
    <Card className={cn("relative overflow-hidden h-full flex flex-col border", config.border)}>
      <div className={cn("absolute inset-0 opacity-10 pointer-events-none", config.bg)} />

      <CardHeader className="pb-2 relative z-10">
        <div className="flex justify-between items-start">
          <CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground">AI Signal · {symbol}</CardTitle>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary px-2 py-1 rounded border border-border">
            <Activity className="w-3 h-3 text-primary animate-pulse" />
            {timeframe}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col relative z-10 gap-4">
        {/* Main signal */}
        <div className="flex items-center gap-3">
          <div className={cn("p-3 rounded-xl bg-background/50 border border-border/50 shadow-inner", config.color)}>
            <Icon className="w-7 h-7" />
          </div>
          <div>
            <h2 className={cn("text-4xl font-bold tracking-tight font-mono uppercase", config.color)}>
              {signal}
            </h2>
            <p className="text-muted-foreground text-xs font-mono mt-0.5">
              {config.label} · <span className="text-foreground">{confidencePct}% conf.</span>
            </p>
          </div>
        </div>

        {/* Composite score bar */}
        <div>
          <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60 mb-1">
            <span>BEARISH</span>
            <span>SCORE: {composite > 0 ? "+" : ""}{composite.toFixed(3)}</span>
            <span>BULLISH</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden relative">
            <div className="absolute inset-y-0 left-1/2 w-px bg-border z-10" />
            <div
              className={cn("absolute inset-y-0 transition-all duration-700", config.bg === "bg-buy/10" ? "bg-buy" : config.bg === "bg-sell/10" ? "bg-sell" : "bg-hold")}
              style={{
                left: composite >= 0 ? "50%" : `${compositeBar}%`,
                width: `${Math.abs(composite) / 2 * 100}%`,
                opacity: 0.8,
              }}
            />
          </div>
        </div>

        {/* Price */}
        <div className="mt-auto pt-3 border-t border-border/40">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Live Price</p>
            <span className={cn("w-1.5 h-1.5 rounded-full", livePriceConnected ? "bg-buy animate-pulse" : "bg-muted-foreground/30")} />
          </div>
          <p className="text-2xl font-mono text-foreground font-bold tracking-tight tabular-nums transition-all duration-200">
            {formatCurrency(livePrice ?? price)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
