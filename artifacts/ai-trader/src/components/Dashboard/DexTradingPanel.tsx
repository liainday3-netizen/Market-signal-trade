import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import {
  useGetDexMode,
  useSetDexMode,
  useGetDexPortfolio,
  getGetDexModeQueryKey,
  getGetDexPortfolioQueryKey,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Cpu,
  TrendingUp,
  TrendingDown,
  ShieldOff,
  Shield,
  Wallet,
  Key,
  Eye,
  EyeOff,
  Unplug,
  CheckCircle2,
  Copy,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function postDexWallet(privateKey: string): Promise<{ address: string; configured: boolean }> {
  const res = await fetch("/api/trader/dex-wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ privateKey }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to connect wallet");
  return data;
}

async function deleteDexWallet(): Promise<void> {
  await fetch("/api/trader/dex-wallet", { method: "DELETE" });
}

export function DexTradingPanel() {
  const qc = useQueryClient();
  const [confirming, setConfirming]       = useState(false);
  const [showConnectForm, setShowConnect] = useState(false);
  const [pkInput, setPkInput]             = useState("");
  const [showPk, setShowPk]               = useState(false);
  const [copied, setCopied]               = useState(false);

  const { data: modeData, refetch: refetchMode } = useGetDexMode({
    query: { queryKey: getGetDexModeQueryKey(), refetchInterval: 5000 },
  });

  const { data: portfolioData, refetch: refetchPortfolio } = useGetDexPortfolio({
    query: {
      queryKey: getGetDexPortfolioQueryKey(),
      enabled: modeData?.configured ?? false,
      refetchInterval: 15000,
    },
  });

  const { mutate: setMode, isPending: isModeChanging } = useSetDexMode({
    mutation: {
      onSuccess: () => {
        refetchMode();
        refetchPortfolio();
        setConfirming(false);
      },
    },
  });

  const { mutate: connectWallet, isPending: isConnecting, error: connectError, reset: resetConnect } = useMutation({
    mutationFn: () => postDexWallet(pkInput),
    onSuccess: () => {
      setPkInput("");
      setShowConnect(false);
      setShowPk(false);
      qc.invalidateQueries({ queryKey: getGetDexModeQueryKey() });
      refetchMode();
    },
  });

  const { mutate: disconnectWallet, isPending: isDisconnecting } = useMutation({
    mutationFn: deleteDexWallet,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetDexModeQueryKey() });
      refetchMode();
      setConfirming(false);
    },
  });

  const isEnabled    = modeData?.enabled    ?? false;
  const isConfigured = modeData?.configured ?? false;
  const wallet       = modeData?.walletAddress ?? null;
  const budget       = modeData?.budgetUsdc  ?? 15;
  const balances     = portfolioData?.balances ?? null;

  const handleCopyAddr = () => {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Card className={cn(
      "h-full flex flex-col border",
      isEnabled ? "border-blue-500/40" : isConfigured ? "border-border/60" : "border-border",
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-blue-400" />
            DEX · Base Chain
          </CardTitle>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-mono px-1.5",
              isEnabled
                ? "border-blue-500/50 text-blue-400 bg-blue-500/10"
                : isConfigured
                ? "border-border text-muted-foreground"
                : "border-yellow-500/50 text-yellow-400 bg-yellow-500/10",
            )}
          >
            {isEnabled ? "LIVE" : isConfigured ? "STANDBY" : "UNCONFIGURED"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">

        {/* ── Wallet not connected ─────────────────────────────────────────── */}
        {!isConfigured && !showConnectForm && (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-background/60 border border-border/50">
              <Wallet className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                  No wallet connected. Connect a Base chain wallet to enable on-chain trading via Uniswap v3.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => { setShowConnect(true); resetConnect(); }}
              className="h-7 text-[11px] font-mono bg-blue-600 hover:bg-blue-700 text-white w-full"
            >
              <Key className="w-3 h-3 mr-1.5" />
              Connect Wallet
            </Button>
          </div>
        )}

        {/* ── Connect form ─────────────────────────────────────────────────── */}
        {!isConfigured && showConnectForm && (
          <div className="flex flex-col gap-2 p-2.5 rounded-md bg-background/60 border border-blue-500/20">
            <div className="flex items-center justify-between mb-0.5">
              <p className="text-[10px] font-mono text-blue-300 font-bold uppercase tracking-wider flex items-center gap-1">
                <Key className="w-3 h-3" /> Enter Private Key
              </p>
              <button
                onClick={() => { setShowConnect(false); setPkInput(""); resetConnect(); }}
                className="text-[9px] font-mono text-muted-foreground/60 hover:text-muted-foreground"
              >
                cancel
              </button>
            </div>

            <div className="relative">
              <Input
                type={showPk ? "text" : "password"}
                placeholder="0x... or raw 64-char hex"
                value={pkInput}
                onChange={(e) => { setPkInput(e.target.value); resetConnect(); }}
                onKeyDown={(e) => { if (e.key === "Enter" && pkInput.trim()) connectWallet(); }}
                className="h-8 text-[11px] font-mono pr-8 bg-background/80 border-border/60"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowPk((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground"
              >
                {showPk ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            {connectError && (
              <p className="text-[10px] font-mono text-sell leading-snug">
                {(connectError as Error).message}
              </p>
            )}

            <Button
              size="sm"
              onClick={() => connectWallet()}
              disabled={!pkInput.trim() || isConnecting}
              className="h-7 text-[11px] font-mono bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isConnecting ? "Connecting…" : "Connect"}
            </Button>

            <p className="text-[9px] font-mono text-muted-foreground/50 leading-relaxed border-t border-border/30 pt-2">
              Key is stored <strong>in memory only</strong> for this session. To persist across restarts,
              save it in Replit Secrets as <span className="text-muted-foreground">DEX_WALLET_PRIVATE_KEY</span>.
            </p>
          </div>
        )}

        {/* ── Connected wallet row ─────────────────────────────────────────── */}
        {isConfigured && wallet && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-background/50 border border-border/40">
            <CheckCircle2 className="w-3 h-3 text-buy shrink-0" />
            <button
              onClick={handleCopyAddr}
              className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
              title={wallet}
            >
              {shortAddr(wallet)}
              {copied
                ? <CheckCircle2 className="w-2.5 h-2.5 text-buy" />
                : <Copy className="w-2.5 h-2.5 opacity-40" />}
            </button>
            {balances && (
              <span className="ml-auto text-[10px] font-mono text-blue-400 shrink-0">
                {balances.usdc.toFixed(2)} USDC
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => disconnectWallet()}
              disabled={isDisconnecting}
              className="h-5 px-1.5 text-[9px] font-mono text-muted-foreground/60 hover:text-sell hover:bg-sell/10 shrink-0"
              title="Disconnect wallet"
            >
              <Unplug className="w-2.5 h-2.5" />
            </Button>
          </div>
        )}

        {/* ── On-chain balances ────────────────────────────────────────────── */}
        {balances && (
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: "WETH",    value: balances.weth.toFixed(5)  },
              { label: "cbBTC",   value: balances.cbbtc.toFixed(6) },
              { label: "ETH gas", value: balances.ethGas.toFixed(4) },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-2 py-1 rounded border border-border/40 bg-background/50">
                <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
                <span className="text-[10px] font-mono text-foreground">{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Enable / disable ─────────────────────────────────────────────── */}
        {isConfigured && !confirming && (
          <div className="flex items-center justify-between p-2.5 rounded-md bg-background/50 border border-border/40">
            <div>
              <p className={cn("text-xs font-mono font-bold", isEnabled ? "text-blue-400" : "text-muted-foreground")}>
                {isEnabled ? "● EXECUTING ON-CHAIN" : "● STANDBY"}
              </p>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                Budget: {formatCurrency(budget)} USDC · Uniswap v3
              </p>
            </div>
            <Button
              size="sm"
              variant={isEnabled ? "destructive" : "outline"}
              onClick={() => { if (!isEnabled) setConfirming(true); else setMode({ data: { enabled: false } }); }}
              disabled={isModeChanging}
              className={cn(
                "h-6 px-2.5 text-[11px] font-mono",
                !isEnabled && "border-blue-500/50 text-blue-400 hover:bg-blue-500/10",
              )}
            >
              {isEnabled
                ? <><ShieldOff className="w-2.5 h-2.5 mr-1" />DISABLE</>
                : <><Shield   className="w-2.5 h-2.5 mr-1" />ENABLE</>}
            </Button>
          </div>
        )}

        {/* ── Confirmation gate ─────────────────────────────────────────────── */}
        {confirming && (
          <div className="flex flex-col gap-2 p-2.5 rounded-md bg-blue-500/10 border border-blue-500/30">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
              <p className="text-[10px] font-mono text-blue-300 leading-relaxed">
                This will send <strong>real on-chain swaps</strong> via Uniswap v3 on Base using up to{" "}
                <strong>{formatCurrency(budget)}</strong> USDC from your wallet.<br />
                Gas fees apply (~$0.001/tx). Trades are irreversible.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => setMode({ data: { enabled: true, budgetUsdc: budget } })}
                disabled={isModeChanging}
                className="h-6 px-2 text-[11px] font-mono bg-blue-600 hover:bg-blue-700 text-white flex-1"
              >
                Confirm — Go On-Chain
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirming(false)}
                className="h-6 px-2 text-[11px] font-mono flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* ── Open DEX positions ────────────────────────────────────────────── */}
        {portfolioData && portfolioData.openPositions.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">Open Positions</p>
            {portfolioData.openPositions.map((pos) => (
              <div key={pos.symbol} className="flex items-center justify-between p-2 rounded border border-blue-500/20 bg-blue-500/5">
                <div>
                  <p className="text-xs font-mono text-foreground font-bold">{pos.symbol}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {pos.quantity.toFixed(6)} @ {formatCurrency(pos.avgEntryPrice)}
                  </p>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">
                  {formatDistanceToNowStrict(new Date(pos.openedAt))} ago
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ── Recent DEX trades ─────────────────────────────────────────────── */}
        {portfolioData && portfolioData.trades.length > 0 && (
          <div className="flex-1 overflow-hidden space-y-1 min-h-0">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">DEX Trades</p>
              <div className="flex gap-2 text-[10px] font-mono">
                <span className="text-buy">+{portfolioData.wins}W</span>
                <span className="text-sell">{portfolioData.losses}L</span>
                <span className={cn(portfolioData.totalPnl >= 0 ? "text-buy" : "text-sell")}>
                  {portfolioData.totalPnl >= 0 ? "+" : ""}{formatCurrency(portfolioData.totalPnl)}
                </span>
              </div>
            </div>
            <div className="overflow-y-auto max-h-32 space-y-1 pr-0.5">
              {portfolioData.trades.slice(0, 10).map((trade) => (
                <div key={trade.id} className="flex items-center gap-2 text-[10px] font-mono py-0.5 border-b border-border/20">
                  {trade.side === "DEX_BUY"
                    ? <TrendingUp   className="w-2.5 h-2.5 text-buy  shrink-0" />
                    : <TrendingDown className="w-2.5 h-2.5 text-sell shrink-0" />}
                  <span className="text-muted-foreground w-14 shrink-0">{trade.symbol.replace("/USDT", "")}</span>
                  <span className="text-foreground">{formatCurrency(trade.price)}</span>
                  {trade.realizedPnl != null && (
                    <span className={cn("ml-auto shrink-0", trade.realizedPnl >= 0 ? "text-buy" : "text-sell")}>
                      {trade.realizedPnl >= 0 ? "+" : ""}{formatCurrency(trade.realizedPnl)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {isEnabled && portfolioData && portfolioData.trades.length === 0 && (
          <p className="text-[10px] font-mono text-muted-foreground text-center py-2">
            Waiting for first BUY signal…
          </p>
        )}
      </CardContent>
    </Card>
  );
}
