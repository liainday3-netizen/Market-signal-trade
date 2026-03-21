import { FactorScores } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface FactorScoresPanelProps {
  factorScores?: FactorScores;
  isLoading: boolean;
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = ((score + 1) / 2) * 100;
  const barColor = score > 0.15 ? "bg-buy" : score < -0.15 ? "bg-sell" : "bg-hold";
  const textColor = score > 0.15 ? "text-buy" : score < -0.15 ? "text-sell" : "text-hold";

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono text-muted-foreground w-24 shrink-0 uppercase tracking-wide">{label}</span>
      <div className="flex-1 relative h-4 bg-secondary rounded-full overflow-hidden">
        {/* Center line */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-border z-10" />
        {/* Bar from center */}
        <div
          className={cn("absolute inset-y-0 transition-all duration-500", barColor, "opacity-80")}
          style={{
            left: score >= 0 ? "50%" : `${pct}%`,
            width: `${Math.abs(score) / 2 * 100}%`,
          }}
        />
      </div>
      <span className={cn("text-xs font-mono font-bold w-10 text-right", textColor)}>
        {score > 0 ? "+" : ""}{score.toFixed(2)}
      </span>
    </div>
  );
}

export function FactorScoresPanel({ factorScores, isLoading }: FactorScoresPanelProps) {
  if (isLoading || !factorScores) {
    return (
      <Card className="h-full">
        <CardHeader><CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground">Factor Analysis</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-6 bg-muted rounded w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const factors = [
    { label: "Trend", score: factorScores.trend },
    { label: "Momentum", score: factorScores.momentum },
    { label: "Mean Rev.", score: factorScores.meanReversion },
    { label: "Volatility", score: factorScores.volatility },
    { label: "Volume", score: factorScores.volume },
  ];

  const compositeColor = factorScores.composite > 0.15
    ? "text-buy border-buy/30 bg-buy/5"
    : factorScores.composite < -0.15
    ? "text-sell border-sell/30 bg-sell/5"
    : "text-hold border-hold/30 bg-hold/5";

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground">Factor Analysis</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        <div className={cn("flex items-center justify-between p-3 rounded-lg border", compositeColor)}>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">Composite Score</p>
            <p className="text-2xl font-mono font-bold">
              {factorScores.composite > 0 ? "+" : ""}{factorScores.composite.toFixed(3)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">Range</p>
            <p className="text-xs font-mono opacity-80">−1.0 → +1.0</p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 flex-1">
          {factors.map((f) => (
            <ScoreBar key={f.label} label={f.label} score={f.score} />
          ))}
        </div>

        <div className="flex gap-3 text-[10px] font-mono text-muted-foreground/50 justify-center mt-1">
          <span className="text-sell">◀ BEARISH</span>
          <span>·</span>
          <span className="text-muted-foreground/40">NEUTRAL</span>
          <span>·</span>
          <span className="text-buy">BULLISH ▶</span>
        </div>
      </CardContent>
    </Card>
  );
}
