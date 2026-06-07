import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { AlertTriangle, Cpu, TrendingUp, TrendingDown, ShieldOff, Shield, Wallet } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function DexTradingPanel() {
  const [confirming, setConfirming] = useState(false);

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

  const { mutate: setMode, isPending } = useSetDexMode({
    mutation: {
      onSuccess: () => {
        refetchMode();
        refetchPortfolio();
        setConfirming(false);
      },
    },
  });

  const isEnabled    = modeData?.enabled    ?? false;
  const isConfigured = modeData?.configured ?? false;
  const wallet       = modeData?.walletAddress ?? null;
  const budget       = modeData?.budgetUsdc  ?? 15;
  const balances     = portfolioData?.balances ?? null;

  const handleToggle = () => {
    if (!isEnabled) setConfirming(true);
    else setMode({ data: { enabled: false } });
  };

  return (
    <Card className={cn(
      "h-full flex flex-col border",
      isEnabled ? "border-blue-500/40" : "border-border",
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

        {/* Wallet not set */}
        {!isConfigured && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-yellow-500/10 border border-yellow-500/20">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
            <p className="text-[10px] font-mono text-yellow-300 leading-relaxed">
              Add <span className="text-yellow-200">DEX_WALLET_PRIVATE_KEY</span> in Secrets to enable on-chain trading.
            </p>
          </div>
        )}

        {/* Wallet address */}
        {isConfigured && wallet && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-background/50 border border-border/40">
            <Wallet className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-[10px] font-mono text-muted-foreground">{shortAddr(wallet)}</span>
            {balances && (
              <span className="ml-auto text-[10px] font-mono text-blue-400">
                {balances.usdc.toFixed(2)} USDC
              </span>
            )}
          </div>
        )}

        {/* On-chain balances */}
        {balances && (
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: "WETH",  value: balances.weth.toFixed(5) },
              { label: "cbBTC", value: balances.cbbtc.toFixed(6) },
              { label: "ETH gas", value: balances.ethGas.toFixed(4) },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-2 py-1 rounded border border-border/40 bg-background/50">
                <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
                <span className="text-[10px] font-mono text-foreground">{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Enable / disable */}
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
              onClick={handleToggle}
              disabled={isPending}
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

        {/* Confirmation gate */}
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
                disabled={isPending}
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

        {/* Open positions */}
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

        {/* Recent DEX trades */}
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
