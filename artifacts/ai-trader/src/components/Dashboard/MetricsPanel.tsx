import { Features } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricsPanelProps {
  features?: Features;
  isLoading: boolean;
}

interface Metric {
  label: string;
  value: string;
  color: string;
  sub?: string;
}

export function MetricsPanel({ features, isLoading }: MetricsPanelProps) {
  if (isLoading || !features) {
    return (
      <Card className="h-full">
        <CardHeader><CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground">Quantitative Indicators</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 animate-pulse">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="h-14 bg-muted rounded-md"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const rsiColor = features.rsi > 70 ? "text-sell" : features.rsi < 30 ? "text-buy" : "text-foreground";
  const stochColor = features.stochK > 80 ? "text-sell" : features.stochK < 20 ? "text-buy" : "text-foreground";
  const bbColor = features.bbPct > 0.9 ? "text-sell" : features.bbPct < 0.1 ? "text-buy" : "text-muted-foreground";

  const sections: { title: string; metrics: Metric[] }[] = [
    {
      title: "TREND",
      metrics: [
        {
          label: "EMA 12",
          value: features.emaFast.toFixed(0),
          color: features.emaFast > features.emaSlow ? "text-buy" : "text-sell",
          sub: features.emaFast > features.emaSlow ? "↑ above EMA26" : "↓ below EMA26",
        },
        {
          label: "EMA 26",
          value: features.emaSlow.toFixed(0),
          color: "text-foreground",
        },
        {
          label: "MA20",
          value: features.ma20.toFixed(0),
          color: "text-muted-foreground",
        },
      ],
    },
    {
      title: "MOMENTUM",
      metrics: [
        {
          label: "MACD",
          value: features.macd.toFixed(1),
          color: features.macd >= 0 ? "text-buy" : "text-sell",
        },
        {
          label: "Hist",
          value: features.macdHist.toFixed(1),
          color: features.macdHist >= 0 ? "text-buy" : "text-sell",
          sub: features.macdHist >= 0 ? "Expanding" : "Contracting",
        },
        {
          label: "MOM(10)",
          value: (features.momentum * 100).toFixed(2) + "%",
          color: features.momentum >= 0 ? "text-buy" : "text-sell",
        },
      ],
    },
    {
      title: "OSCILLATORS",
      metrics: [
        {
          label: "RSI(14)",
          value: features.rsi.toFixed(1),
          color: rsiColor,
          sub: features.rsi > 70 ? "Overbought" : features.rsi < 30 ? "Oversold" : "Neutral",
        },
        {
          label: "%K(14)",
          value: features.stochK.toFixed(1),
          color: stochColor,
        },
        {
          label: "%D(3)",
          value: features.stochD.toFixed(1),
          color: features.stochK > features.stochD ? "text-buy" : "text-sell",
          sub: features.stochK > features.stochD ? "Bullish X" : "Bearish X",
        },
      ],
    },
    {
      title: "VOLATILITY",
      metrics: [
        {
          label: "BB %B",
          value: (features.bbPct * 100).toFixed(1) + "%",
          color: bbColor,
          sub: features.bbPct > 0.9 ? "Upper Band" : features.bbPct < 0.1 ? "Lower Band" : "Mid Band",
        },
        {
          label: "ATR(14)",
          value: features.atr.toFixed(0),
          color: "text-muted-foreground",
        },
        {
          label: "Z-Score",
          value: features.zScore.toFixed(2),
          color: Math.abs(features.zScore) > 2 ? "text-sell" : Math.abs(features.zScore) > 1 ? "text-hold" : "text-foreground",
          sub: features.zScore > 1 ? "Stretched ↑" : features.zScore < -1 ? "Stretched ↓" : "Mean",
        },
      ],
    },
  ];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground">Quantitative Indicators</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest mb-1.5 px-0.5">{section.title}</p>
            <div className="grid grid-cols-3 gap-2">
              {section.metrics.map((m, i) => (
                <div key={i} className="flex flex-col bg-background/60 px-2.5 py-2 rounded-md border border-border/40">
                  <span className="text-[10px] text-muted-foreground font-mono mb-0.5">{m.label}</span>
                  <span className={cn("text-sm font-mono font-bold leading-tight", m.color)}>
                    {m.value}
                  </span>
                  {m.sub && (
                    <span className="text-[9px] text-muted-foreground/60 mt-0.5 truncate">{m.sub}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
