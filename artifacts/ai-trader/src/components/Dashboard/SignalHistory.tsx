import { SignalRecord } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";

interface SignalHistoryProps {
  data?: SignalRecord[];
  isLoading: boolean;
}

export function SignalHistory({ data, isLoading }: SignalHistoryProps) {
  if (isLoading) {
    return (
      <Card className="col-span-full">
        <CardHeader><CardTitle>Signal History</CardTitle></CardHeader>
        <CardContent>
           <div className="space-y-4 animate-pulse">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-muted rounded-md w-full"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card className="col-span-full">
        <CardHeader><CardTitle>Signal History</CardTitle></CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            No history available yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle>Signal History Log</CardTitle>
      </CardHeader>
      <CardContent className="overflow-auto max-h-[400px] pr-2">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-secondary/50 sticky top-0 backdrop-blur-sm z-10">
            <tr>
              <th className="px-4 py-3 font-medium rounded-l-md">Time</th>
              <th className="px-4 py-3 font-medium">Signal</th>
              <th className="px-4 py-3 font-medium">Confidence</th>
              <th className="px-4 py-3 font-medium">Price</th>
              <th className="px-4 py-3 font-medium">RSI</th>
              <th className="px-4 py-3 font-medium rounded-r-md">MACD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {data.map((row) => (
              <tr key={row.id} className="hover:bg-muted/50 transition-colors group">
                <td className="px-4 py-3 font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                  {format(new Date(row.createdAt), "MMM dd, HH:mm:ss")}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={row.signal.toLowerCase() as any}>
                    {row.signal}
                  </Badge>
                </td>
                <td className="px-4 py-3 font-mono">
                  {Math.round(row.confidence * 100)}%
                </td>
                <td className="px-4 py-3 font-mono font-medium">
                  {formatCurrency(row.price)}
                </td>
                <td className="px-4 py-3 font-mono text-muted-foreground">
                  {row.rsi.toFixed(2)}
                </td>
                <td className="px-4 py-3 font-mono text-muted-foreground">
                  {row.macd.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
