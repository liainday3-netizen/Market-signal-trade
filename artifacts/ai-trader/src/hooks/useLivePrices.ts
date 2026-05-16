import { useEffect, useRef, useState } from "react";

export interface LiveTicker {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number;
}

export type LivePrices = Record<string, LiveTicker>;

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useLivePrices(): { prices: LivePrices; connected: boolean } {
  const [prices, setPrices] = useState<LivePrices>({});
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let es: EventSource;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es = new EventSource(`${BASE}/api/trader/live`);
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (event) => {
        try {
          const ticker = JSON.parse(event.data) as LiveTicker;
          setPrices((prev) => ({ ...prev, [ticker.symbol]: ticker }));
        } catch (_) {}
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        retryTimer = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      esRef.current?.close();
      setConnected(false);
    };
  }, []);

  return { prices, connected };
}
