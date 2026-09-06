import { useState, useEffect } from "react";
import {
  useGetAutoTraderStatus,
  useControlAutoTrader,
  getGetAutoTraderStatusQueryKey,
} from "@workspace/api-client-react";
import type { RecentSignal } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Zap, TrendingUp, TrendingDown, Minus, Wifi, WifiOff, Loader } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict, format } from "date-fns";

function Countdown({ nextRun }: { nextRun: string | null | undefined }) {
  const [secs, setSecs] = useState<number | null>(null);

  useEffect(() => {
    if (!nextRun) { setSecs(null); return; }
    const update = () => {
      const diff = Math.max(0, Math.round((new Date(nextRun).getTime() - Date.now()) / 1000));
      setSecs(diff);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [nextRun]);

  if (secs === null) return <span className="text-muted-foreground font-mono text-xs">—</span>;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return (
    <span className={cn("font-mono text-sm font-bold tabular-nums", secs < 10 ? "text-hold" : "text-buy")}>
      {m > 0 ? `${m}m ` : ""}{String(s).padStart(2, "0")}s
    </span>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  const cfg = {
    BUY: { color: "text-buy bg-buy/10 border-buy/30", Icon: TrendingUp },
    SELL: { color: "text-sell bg-sell/10 border-sell/30", Icon: TrendingDown },
    HOLD: { color: "text-hold bg-hold/10 border-hold/30", Icon: Minus },
  }[signal] ?? { color: "text-muted-foreground bg-secondary border-border", Icon: Minus };

  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold uppercase", cfg.color)}>
      <cfg.Icon className="w-2.5 h-2.5" />
      {signal}
    </span>
  );
}

function SignalFeedRow({ sig }: { sig: RecentSignal }) {
  const coherencePct = Math.round(sig.coherence.score * 100);
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/30 last:border-0">
      <SignalBadge signal={sig.signal} />
      <span className="text-xs font-mono text-foreground font-medium w-16 shrink-0">{sig.symbol.replace("/USDT", "")}</span>
      <span className={cn("text-xs font-mono font-bold w-10", sig.composite >= 0 ? "text-buy" : "text-sell")}>
        {sig.composite > 0 ? "+" : ""}{sig.composite.toFixed(2)}
      </span>
      <span
        className={cn(
          "text-[10px] font-mono font-bold w-9",
          sig.coherence.isCoherent ? "text-buy" : "text-hold",
        )}
        title={sig.coherence.reason}
      >
        C{coherencePct}%
      </span>
      <span className="text-xs font-mono text-muted-foreground">${sig.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
      <span className="ml-auto text-[10px] font-mono text-muted-foreground/50 shrink-0">
        {format(new Date(sig.timestamp), "HH:mm:ss")}
      </span>
    </div>
  );
}

export function AutoTraderPanel() {
  const { data: status, isLoading } = useGetAutoTraderStatus({
    query: { queryKey: getGetAutoTraderStatusQueryKey(), refetchInterval: 2000 },
  });

  const { mutate: control, isPending } = useControlAutoTrader();

  const handleToggle = () => {
    if (!status) return;
    control({ data: { action: status.isRunning ? "stop" : "start" } });
  };

  if (isLoading || !status) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground">Auto-Loop</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-8 bg-muted rounded w-full" />
            <div className="h-20 bg-muted rounded w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("h-full flex flex-col border", status.isRunning ? "border-buy/30" : "border-border")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" />
            Auto-Loop
          </CardTitle>
          <Button
            size="sm"
            variant={status.isRunning ? "destructive" : "default"}
            onClick={handleToggle}
            disabled={isPending}
            className="h-6 px-2.5 text-[11px] font-mono"
          >
            {status.isRunning
              ? <><Square className="w-2.5 h-2.5 mr-1" />STOP</>
              : <><Play className="w-2.5 h-2.5 mr-1" />START</>
            }
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-3">
        {/* Status row */}
        <div className="flex flex-col gap-1.5 p-2.5 rounded-md bg-background/50 border border-border/40">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", status.isRunning ? "bg-buy animate-pulse" : "bg-muted-foreground/40")} />
              <span className={cn("text-xs font-mono font-bold", status.isRunning ? "text-buy" : "text-muted-foreground")}>
                {status.isRunning ? "RUNNING" : "STOPPED"}
              </span>
            </div>
            {status.isRunning && status.nextRun && (
              <>
                <span className="text-muted-foreground/30">|</span>
                <span className="text-[10px] font-mono text-muted-foreground">Next in</span>
                <Countdown nextRun={status.nextRun} />
              </>
            )}
          </div>
          {/* WebSocket status */}
          <div className="flex items-center gap-1.5">
            {status.wsStatus === "CONNECTED" ? (
              <Wifi className="w-3 h-3 text-buy" />
            ) : status.wsStatus === "CONNECTING" || status.wsStatus === "RECONNECTING" ? (
              <Loader className="w-3 h-3 text-hold animate-spin" />
            ) : (
              <WifiOff className="w-3 h-3 text-muted-foreground/40" />
            )}
            <span className={cn("text-[10px] font-mono", {
              "text-buy": status.wsStatus === "CONNECTED",
              "text-hold": status.wsStatus === "CONNECTING" || status.wsStatus === "RECONNECTING",
              "text-muted-foreground/40": status.wsStatus === "DISCONNECTED",
            })}>
              WS {status.wsStatus}
            </span>
            <span className="text-muted-foreground/30 text-[10px] font-mono ml-auto">{status.dataSource?.toUpperCase()}</span>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Runs", value: status.totalRuns },
            { label: "Signals", value: status.signalsGenerated },
            { label: "Interval", value: `${status.intervalSeconds}s` },
          ].map((s) => (
            <div key={s.label} className="flex flex-col bg-background/60 px-2 py-1.5 rounded border border-border/30">
              <span className="text-[9px] font-mono text-muted-foreground/60 uppercase">{s.label}</span>
              <span className="text-sm font-mono font-bold text-foreground">{s.value}</span>
            </div>
          ))}
        </div>

        {/* Symbol pills */}
        <div className="flex gap-1 flex-wrap">
          {status.activeSymbols.map((sym) => (
            <span key={sym} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
              {sym}
            </span>
          ))}
        </div>

        {/* Live signal feed */}
        <div className="flex-1 flex flex-col min-h-0">
          <p className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-1.5">Signal Feed</p>
          <div className="flex-1 overflow-y-auto">
            {status.lastSignals.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/40 font-mono text-center py-4">
                {status.isRunning ? "Waiting for first cycle..." : "Start the loop to generate signals"}
              </p>
            ) : (
              <div>
                {status.lastSignals.slice(0, 15).map((sig, i) => (
                  <SignalFeedRow key={`${sig.symbol}-${sig.timestamp}-${i}`} sig={sig} />
                ))}
              </div>
            )}
          </div>
        </div>

        {status.lastRun && (
          <p className="text-[9px] font-mono text-muted-foreground/30 text-right">
            Last: {formatDistanceToNowStrict(new Date(status.lastRun), { addSuffix: true })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
