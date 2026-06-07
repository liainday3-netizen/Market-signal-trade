import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import {
  useGetLiveMode,
  useSetLiveMode,
  useGetLivePortfolio,
  getGetLiveModeQueryKey,
  getGetLivePortfolioQueryKey,
} from "@workspace/api-client-react";
import { AlertTriangle, Zap, DollarSign, TrendingUp, TrendingDown, ShieldOff, Shield } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

export function LiveTradingPanel() {
  const [confirming, setConfirming] = useState(false);

  const { data: modeData, refetch: refetchMode } = useGetLiveMode({
    query: { queryKey: getGetLiveModeQueryKey(), refetchInterval: 5000 },
  });

  const { data: portfolioData, refetch: refetchPortfolio } = useGetLivePortfolio({
    query: {
      queryKey: getGetLivePortfolioQueryKey(),
      enabled: modeData?.configured ?? false,
      refetchInterval: 10000,
    },
  });

  const { mutate: setMode, isPending } = useSetLiveMode({
    mutation: {
      onSuccess: () => {
        refetchMode();
        refetchPortfolio();
        setConfirming(false);
      },
    },
  });

  const isEnabled = modeData?.enabled ?? false;
  const isConfigured = modeData?.configured ?? false;
  const budget = modeData?.budgetUsdc ?? 15;

  const handleToggle = () => {
    if (!isEnabled) {
      setConfirming(true);
    } else {
      setMode({ data: { enabled: false } });
    }
  };

  const handleConfirmEnable = () => {
    setMode({ data: { enabled: true, budgetUsdc: budget } });
  };

  return (
    <Card className={cn(
      "h-full flex flex-col border",
      isEnabled ? "border-orange-500/40" : "border-border",
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-widest font-mono text-muted-foreground flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-orange-400" />
            Live Trading
          </CardTitle>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-mono px-1.5",
              isEnabled
                ? "border-orange-500/50 text-orange-400 bg-orange-500/10"
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
        {/* API key warning */}
        {!isConfigured && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-yellow-500/10 border border-yellow-500/20">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
            <p className="text-[10px] font-mono text-yellow-300 leading-relaxed">
              Coinbase API keys not set.<br />
              Add <span className="text-yellow-200">COINBASE_API_KEY</span> &amp; <span className="text-yellow-200">COINBASE_API_SECRET</span> in Secrets.
            </p>
          </div>
        )}

        {/* Live mode toggle */}
        {isConfigured && !confirming && (
          <div className="flex items-center justify-between p-2.5 rounded-md bg-background/50 border border-border/40">
            <div>
              <p className={cn("text-xs font-mono font-bold", isEnabled ? "text-orange-400" : "text-muted-foreground")}>
                {isEnabled ? "● EXECUTING REAL TRADES" : "● STANDBY"}
              </p>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                Budget: {formatCurrency(budget)} USDC
              </p>
            </div>
            <Button
              size="sm"
              variant={isEnabled ? "destructive" : "outline"}
              onClick={handleToggle}
              disabled={isPending}
              className={cn(
                "h-6 px-2.5 text-[11px] font-mono",
                !isEnabled && "border-orange-500/50 text-orange-400 hover:bg-orange-500/10",
              )}
            >
              {isEnabled
                ? <><ShieldOff className="w-2.5 h-2.5 mr-1" />DISABLE</>
                : <><Shield className="w-2.5 h-2.5 mr-1" />ENABLE</>
              }
            </Button>
          </div>
        )}

        {/* Confirmation gate */}
        {confirming && (
          <div className="flex flex-col gap-2 p-2.5 rounded-md bg-orange-500/10 border border-orange-500/30">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
              <p className="text-[10px] font-mono text-orange-300 leading-relaxed">
                This will place <strong>real orders</strong> on Coinbase using up to{" "}
                <strong>{formatCurrency(budget)}</strong> of your funds.<br />
                The bot acts on every BUY/SELL signal automatically.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleConfirmEnable}
                disabled={isPending}
                className="h-6 px-2 text-[11px] font-mono bg-orange-500 hover:bg-orange-600 text-white flex-1"
              >
                Confirm — Go Live
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

        {/* Exchange balances */}
        {portfolioData && portfolioData.exchangeBalances.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">Exchange Balances</p>
            <div className="flex flex-wrap gap-1.5">
              {portfolioData.exchangeBalances.map((b) => (
                <div
                  key={b.currency}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-border/40 bg-background/50"
                >
                  <DollarSign className="w-2.5 h-2.5 text-muted-foreground" />
                  <span className="text-[10px] font-mono text-foreground">{b.currency}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{b.free.toFixed(4)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Open live positions */}
        {portfolioData && portfolioData.openPositions.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">Open Positions</p>
            {portfolioData.openPositions.map((pos) => (
              <div
                key={pos.symbol}
                className="flex items-center justify-between p-2 rounded border border-orange-500/20 bg-orange-500/5"
              >
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

        {/* Recent live trades */}
        {portfolioData && portfolioData.trades.length > 0 && (
          <div className="flex-1 overflow-hidden space-y-1 min-h-0">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">Recent Live Trades</p>
              <div className="flex gap-2 text-[10px] font-mono">
                <span className="text-buy">+{portfolioData.wins}W</span>
                <span className="text-sell">{portfolioData.losses}L</span>
                <span className={cn(portfolioData.totalRealizedPnl >= 0 ? "text-buy" : "text-sell")}>
                  {portfolioData.totalRealizedPnl >= 0 ? "+" : ""}{formatCurrency(portfolioData.totalRealizedPnl)}
                </span>
              </div>
            </div>
            <div className="overflow-y-auto max-h-32 space-y-1 pr-0.5">
              {portfolioData.trades.slice(0, 10).map((trade) => (
                <div
                  key={trade.id}
                  className="flex items-center gap-2 text-[10px] font-mono py-0.5 border-b border-border/20"
                >
                  {trade.side === "LIVE_BUY" ? (
                    <TrendingUp className="w-2.5 h-2.5 text-buy shrink-0" />
                  ) : (
                    <TrendingDown className="w-2.5 h-2.5 text-sell shrink-0" />
                  )}
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

        {/* Empty state */}
        {isEnabled && portfolioData && portfolioData.trades.length === 0 && (
          <p className="text-[10px] font-mono text-muted-foreground text-center py-2">
            Waiting for first BUY signal...
          </p>
        )}
      </CardContent>
    </Card>
  );
}
