import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, ShieldCheck, Power } from "lucide-react";
import { setAdminToken, getAdminToken } from "@/lib/adminAuth";

interface RiskStatus {
  liveArmed: boolean;
  killSwitch: { engaged: boolean; reason: string | null; since: string | null; forcedByEnv: boolean };
  limits: {
    maxPerTradeUsd: number; maxOpenPositions: number; maxTotalExposureUsd: number;
    maxDailyLossUsd: number; maxConsecutiveFailures: number; flattenOnBreach: boolean;
  };
  consecutiveFailures: number;
  snapshot: { exposureUsd: number; realizedTodayUsd: number; unrealizedUsd: number; dayPnlUsd: number; openPositions: unknown[] };
}

const KEY = ["risk-status"];

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api/trader/risk${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

const usd = (n: number) => `${n >= 0 ? "" : "-"}$${Math.abs(n).toFixed(2)}`;

export function RiskPanel() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data, error } = useQuery({ queryKey: KEY, queryFn: () => api<RiskStatus>(""), refetchInterval: 8000, retry: false });

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); await qc.invalidateQueries({ queryKey: KEY }); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const engaged = data?.killSwitch.engaged ?? false;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          {engaged ? <ShieldAlert className="h-4 w-4 text-red-500" /> : <ShieldCheck className="h-4 w-4 text-emerald-500" />}
          Risk Controls
        </CardTitle>
        {data && (
          <Badge variant={data.liveArmed ? "destructive" : "secondary"}>
            {data.liveArmed ? "LIVE ARMED" : "PAPER ONLY"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {error && (
          <div className="space-y-2">
            <p className="text-muted-foreground">{(error as Error).message}</p>
            <Button size="sm" variant="outline" onClick={() => {
              const t = window.prompt("Enter ADMIN_TOKEN", getAdminToken() ?? "");
              if (t !== null) { setAdminToken(t || null); qc.invalidateQueries({ queryKey: KEY }); }
            }}>Set admin token</Button>
          </div>
        )}
        {data && (
          <>
            <div className={`rounded p-2 ${engaged ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
              {engaged ? `Kill switch ON — ${data.killSwitch.reason ?? ""}${data.killSwitch.forcedByEnv ? " (forced by env)" : ""}` : "Kill switch off — entries allowed within limits"}
            </div>
            <div className="grid grid-cols-2 gap-1">
              <span className="text-muted-foreground">Day PnL</span><span className="text-right font-mono">{usd(data.snapshot.dayPnlUsd)} / -{usd(data.limits.maxDailyLossUsd)}</span>
              <span className="text-muted-foreground">Exposure</span><span className="text-right font-mono">{usd(data.snapshot.exposureUsd)} / {usd(data.limits.maxTotalExposureUsd)}</span>
              <span className="text-muted-foreground">Open positions</span><span className="text-right font-mono">{data.snapshot.openPositions.length} / {data.limits.maxOpenPositions}</span>
              <span className="text-muted-foreground">Max per trade</span><span className="text-right font-mono">{usd(data.limits.maxPerTradeUsd)}</span>
              <span className="text-muted-foreground">Order failures</span><span className="text-right font-mono">{data.consecutiveFailures} / {data.limits.maxConsecutiveFailures}</span>
            </div>
            <div className="flex gap-2">
              {engaged ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api("/release", "POST", {}))}>Release kill switch</Button>
              ) : (
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => act(() => api("/kill", "POST", { reason: "Manual (dashboard)" }))}>
                  <Power className="h-3 w-3 mr-1" />Kill switch
                </Button>
              )}
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => {
                if (window.confirm("Engage kill switch AND market-sell all real positions?")) act(() => api("/kill", "POST", { reason: "Manual flatten (dashboard)", flatten: true }));
              }}>Kill + flatten</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
