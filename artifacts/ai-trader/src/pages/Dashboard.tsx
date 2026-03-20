import { useState, useEffect } from "react";
import { useGetSignal, useGetHistory, useGetMarketData } from "@workspace/api-client-react";
import { SignalWidget } from "@/components/Dashboard/SignalWidget";
import { MetricsPanel } from "@/components/Dashboard/MetricsPanel";
import { PriceChart } from "@/components/Dashboard/PriceChart";
import { SignalHistory } from "@/components/Dashboard/SignalHistory";
import { Button } from "@/components/ui/button";
import { RefreshCw, Play, SquareTerminal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState("1m");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { toast } = useToast();

  const refetchInterval = autoRefresh ? 30000 : false;

  const { 
    data: signalData, 
    isLoading: isLoadingSignal,
    refetch: refetchSignal,
    isRefetching: isRefetchingSignal,
    error: signalError
  } = useGetSignal({ symbol, timeframe }, { query: { refetchInterval } });

  const { 
    data: historyData, 
    isLoading: isLoadingHistory,
    refetch: refetchHistory
  } = useGetHistory({ symbol, limit: 10 }, { query: { refetchInterval } });

  const { 
    data: marketData, 
    isLoading: isLoadingMarket,
    refetch: refetchMarket
  } = useGetMarketData({ symbol, timeframe, limit: 100 }, { query: { refetchInterval } });

  const handleManualRefresh = () => {
    refetchSignal();
    refetchHistory();
    refetchMarket();
    toast({
      title: "Data Refreshed",
      description: "Fetched latest market data and signals.",
      duration: 2000,
    });
  };

  useEffect(() => {
    if (signalError) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Failed to fetch live data. Retrying...",
      });
    }
  }, [signalError, toast]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-primary/30">
      {/* Top Navigation Bar */}
      <header className="border-b border-border bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/50 flex items-center justify-center text-primary shadow-[0_0_15px_rgba(59,130,246,0.3)]">
              <SquareTerminal size={18} />
            </div>
            <h1 className="text-xl font-bold tracking-tight font-mono text-foreground">AI_TRADER<span className="text-primary animate-pulse">_</span></h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex bg-secondary p-1 rounded-lg border border-border">
              {['BTC/USDT', 'ETH/USDT'].map((sym) => (
                <button
                  key={sym}
                  onClick={() => setSymbol(sym)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                    symbol === sym 
                      ? 'bg-background shadow-sm text-foreground' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>

            <div className="hidden md:flex bg-secondary p-1 rounded-lg border border-border mr-4">
              {['1m', '5m', '15m'].map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                    timeframe === tf 
                      ? 'bg-background shadow-sm text-foreground' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            <Button 
              variant={autoRefresh ? "outline" : "default"} 
              size="sm" 
              onClick={() => setAutoRefresh(!autoRefresh)}
              className="font-mono text-xs w-[120px]"
            >
              {autoRefresh ? (
                <><span className="w-2 h-2 rounded-full bg-buy mr-2 animate-pulse" /> Auto ON</>
              ) : (
                <><Play className="w-3 h-3 mr-2" /> Auto OFF</>
              )}
            </Button>
            
            <Button 
              variant="outline" 
              size="icon" 
              onClick={handleManualRefresh}
              disabled={isRefetchingSignal}
            >
              <RefreshCw className={`w-4 h-4 ${isRefetchingSignal ? 'animate-spin text-primary' : ''}`} />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Dashboard */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 flex flex-col gap-6">
        
        {/* Top Widgets Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-auto lg:h-[220px]">
          <div className="lg:col-span-1 h-full">
            <SignalWidget data={signalData} isLoading={isLoadingSignal} />
          </div>
          <div className="lg:col-span-2 h-full">
            <MetricsPanel features={signalData?.features} isLoading={isLoadingSignal} />
          </div>
        </div>

        {/* Chart Row */}
        <div className="grid grid-cols-1 gap-6">
          <PriceChart data={marketData} isLoading={isLoadingMarket} />
        </div>

        {/* History Row */}
        <div className="grid grid-cols-1 gap-6">
          <SignalHistory data={historyData} isLoading={isLoadingHistory} />
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-muted-foreground">
          <p className="font-mono">SYS_STATUS: <span className="text-buy">ONLINE</span> | SOURCE: PUBLIC API</p>
          <p className="mt-2 text-xs opacity-50 uppercase tracking-widest">For educational purposes only. Not financial advice.</p>
        </div>
      </footer>
    </div>
  );
}
