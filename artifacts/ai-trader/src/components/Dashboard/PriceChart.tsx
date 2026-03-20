import { Candle } from "@workspace/api-client-react/src/generated/api.schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { format } from "date-fns";

interface PriceChartProps {
  data?: Candle[];
  isLoading: boolean;
}

export function PriceChart({ data, isLoading }: PriceChartProps) {
  if (isLoading || !data) {
    return (
      <Card className="col-span-full h-[400px] flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-muted-foreground text-sm">Loading market data...</p>
        </div>
      </Card>
    );
  }

  // Format data for Recharts, ensure time is in milliseconds if it's seconds
  const chartData = data.map(d => ({
    ...d,
    timeMs: d.time > 9999999999 ? d.time : d.time * 1000,
  }));

  // Calculate domain min/max with some padding
  const min = Math.min(...chartData.map(d => d.close));
  const max = Math.max(...chartData.map(d => d.close));
  const padding = (max - min) * 0.1;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background/95 backdrop-blur border border-border p-3 rounded-lg shadow-xl">
          <p className="text-muted-foreground text-xs mb-1">
            {format(new Date(label), "MMM dd, HH:mm")}
          </p>
          <p className="text-foreground font-mono font-bold text-lg">
            ${payload[0].value.toFixed(2)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="col-span-full h-[400px] flex flex-col">
      <CardHeader className="pb-0">
        <CardTitle>Price Action</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} className="chart-grid-line" strokeOpacity={0.5} />
            <XAxis 
              dataKey="timeMs" 
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(unixTime) => format(new Date(unixTime), "HH:mm")}
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickMargin={10}
              axisLine={false}
              tickLine={false}
              minTickGap={50}
            />
            <YAxis 
              domain={[min - padding, max + padding]} 
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickFormatter={(val) => `$${val.toLocaleString()}`}
              axisLine={false}
              tickLine={false}
              width={80}
              orientation="right"
            />
            <Tooltip content={<CustomTooltip />} />
            <Area 
              type="monotone" 
              dataKey="close" 
              stroke="hsl(var(--primary))" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorClose)" 
              isAnimationActive={false} // Disable animation for live data feel
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
