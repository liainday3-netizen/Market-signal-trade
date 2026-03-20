import { Features } from "@workspace/api-client-react/src/generated/api.schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercentage } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface MetricsPanelProps {
  features?: Features;
  isLoading: boolean;
}

export function MetricsPanel({ features, isLoading }: MetricsPanelProps) {
  if (isLoading || !features) {
    return (
      <Card className="h-full">
        <CardHeader><CardTitle>Feature Engineering</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-pulse">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded-lg"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const getRsiColor = (rsi: number) => {
    if (rsi > 70) return "text-sell drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]";
    if (rsi < 30) return "text-buy drop-shadow-[0_0_8px_rgba(34,197,94,0.4)]";
    return "text-foreground";
  };

  const metrics = [
    { 
      label: "Returns", 
      value: formatPercentage(features.returns),
      color: features.returns >= 0 ? "text-buy" : "text-sell"
    },
    { 
      label: "MA (Close)", 
      value: features.ma.toFixed(2),
      color: "text-foreground"
    },
    { 
      label: "Volatility", 
      value: features.volatility.toFixed(4),
      color: features.volatility > 0.05 ? "text-hold" : "text-foreground"
    },
    { 
      label: "RSI (14)", 
      value: features.rsi.toFixed(2),
      color: getRsiColor(features.rsi)
    },
    { 
      label: "MACD", 
      value: features.macd.toFixed(2),
      color: features.macd >= 0 ? "text-buy" : "text-sell"
    },
  ];

  return (
    <Card className="h-full flex flex-col justify-center">
      <CardHeader className="pb-2">
        <CardTitle>Model Features (Live)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {metrics.map((m, i) => (
            <div key={i} className="flex flex-col bg-background/50 p-3 rounded-lg border border-border/50">
              <span className="text-xs text-muted-foreground font-medium mb-1 truncate">{m.label}</span>
              <span className={cn("text-lg font-mono font-semibold", m.color)}>
                {m.value}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
