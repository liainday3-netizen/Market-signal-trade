import { useState } from "react";
import { useGetSignal, useGetHistory, useGetMarketData } from "@workspace/api-client-react";
import { SignalWidget } from "@/components/Dashboard/SignalWidget";
import { MetricsPanel } from "@/components/Dashboard/MetricsPanel";
import { FactorScoresPanel } from "@/components/Dashboard/FactorScoresPanel";
import { BacktestPanel } from "@/components/Dashboard/BacktestPanel";
import { AutoTraderPanel } from "@/components/Dashboard/AutoTraderPanel";
import { PriceChart } from "@/components/Dashboard/PriceChart";
import { SignalHistory } from "@/components/Dashboard/SignalHistory";
import { Button } from "@/components/ui/button";
import { RefreshCw, SquareTerminal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
const TIMEFRAMES = ["1m", "5m", "15m", "1h"];

export default function Dashboard() {
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState("1m");
  const { toast } = useToast();

  const {
    data: signalData,
    isLoading: isLoadingSignal,
    refetch: refetchSignal,
    isRefetching: isRefetchingSignal,
  } = useGetSignal({ symbol, timeframe }, { query: { refetchInterval: false } });

  const {
    data: historyData,
    isLoading: isLoadingHistory,
    refetch: refetchHistory,
  } = useGetHistory({ limit: 50 }, { query: { refetchInterval: 5000 } });

  const {
    data: marketData,
    isLoading: isLoadingMarket,
    refetch: refetchMarket,
  } = useGetMarketData({ symbol, timeframe, limit: 100 }, { query: { refetchInterval: 30000 } });

  const handleManualRefresh = () => {
    refetchSignal();
    refetchHistory();
    refetchMarket();
    toast({ title: "Refreshed", description: "Fetching latest signal on demand.", duration: 2000 });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Top Navigation */}
      <header className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 h-13 flex items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded-md bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
              <SquareTerminal size={14} />
            </div>
            <h1 className="text-base font-bold tracking-tight font-mono">
              AI_TRADER<span className="text-primary animate-pulse">_</span>
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="flex bg-secondary p-0.5 rounded-md border border-border">
              {SYMBOLS.map((sym) => (
                <button
                  key={sym}
                  onClick={() => setSymbol(sym)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded transition-all ${
                    symbol === sym ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>

            <div className="flex bg-secondary p-0.5 rounded-md border border-border">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded transition-all ${
                    timeframe === tf ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isRefetchingSignal}
              className="h-7 px-2.5 text-[11px] font-mono gap-1.5"
            >
              <RefreshCw className={`w-3 h-3 ${isRefetchingSignal ? "animate-spin text-primary" : ""}`} />
              Refresh Signal
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 py-4 flex flex-col gap-4">

        {/* Row 1: Signal + Auto-Loop + Factor Scores + Backtest */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 min-h-[260px]">
          <SignalWidget data={signalData} isLoading={isLoadingSignal} />
          <AutoTraderPanel />
          <FactorScoresPanel factorScores={signalData?.factorScores} isLoading={isLoadingSignal} />
          <BacktestPanel backtest={signalData?.backtest} isLoading={isLoadingSignal} />
        </div>

        {/* Row 2: Price Chart + Quant Indicators */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <PriceChart data={marketData} isLoading={isLoadingMarket} />
          </div>
          <div className="lg:col-span-1">
            <MetricsPanel features={signalData?.features} isLoading={isLoadingSignal} />
          </div>
        </div>

        {/* Row 3: All-symbol signal history */}
        <SignalHistory data={historyData} isLoading={isLoadingHistory} />

      </main>

      {/* Footer */}
      <footer className="border-t border-border py-3">
        <div className="max-w-[1400px] mx-auto px-4 flex items-center justify-between text-[10px] font-mono text-muted-foreground/40">
          <span>SRC: BINANCE US · EMA/RSI/BB/ATR/STOCH · MULTI-FACTOR MODEL</span>
          <span className="uppercase tracking-widest">Educational purposes only · Not financial advice</span>
        </div>
      </footer>
    </div>
  );
}
