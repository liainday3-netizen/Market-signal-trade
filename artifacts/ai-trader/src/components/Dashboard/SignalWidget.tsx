import { SignalResponse } from "@workspace/api-client-react/src/generated/api.schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface SignalWidgetProps {
  data?: SignalResponse;
  isLoading: boolean;
}

export function SignalWidget({ data, isLoading }: SignalWidgetProps) {
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
    switch(s) {
      case 'BUY': return { color: 'text-buy', bg: 'bg-buy/10', glow: 'text-glow-buy', icon: TrendingUp };
      case 'SELL': return { color: 'text-sell', bg: 'bg-sell/10', glow: 'text-glow-sell', icon: TrendingDown };
      default: return { color: 'text-hold', bg: 'bg-hold/10', glow: 'text-glow-hold', icon: Minus };
    }
  }

  const config = getSignalConfig(signal);
  const Icon = config.icon;

  return (
    <Card className="relative overflow-hidden h-full flex flex-col">
      <div className={cn("absolute inset-0 opacity-20 pointer-events-none transition-colors duration-1000", config.bg)} />
      
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <CardTitle>AI Prediction • {symbol}</CardTitle>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-md border border-border">
            <Activity className="w-3 h-3 text-primary animate-pulse" />
            Live • {timeframe}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col justify-center relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn("p-3 rounded-xl bg-background border border-border shadow-inner", config.color)}>
              <Icon className="w-8 h-8" />
            </div>
            <div>
              <h2 className={cn("text-5xl font-bold tracking-tight font-mono uppercase transition-all", config.color, config.glow)}>
                {signal}
              </h2>
              <p className="text-muted-foreground text-sm font-medium mt-1">
                Confidence: <span className="text-foreground">{Math.round(confidence * 100)}%</span>
              </p>
            </div>
          </div>
        </div>
        
        <div className="mt-auto pt-4 border-t border-border/50">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Current Price</p>
          <p className="text-3xl font-mono text-foreground font-semibold tracking-tight">
            {formatCurrency(price)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
