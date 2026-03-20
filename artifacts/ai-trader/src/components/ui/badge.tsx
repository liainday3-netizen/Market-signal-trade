import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "buy" | "sell" | "hold"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
    secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
    destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
    outline: "text-foreground",
    buy: "border-transparent bg-buy/20 text-buy border border-buy/50 shadow-[0_0_10px_rgba(34,197,94,0.2)]",
    sell: "border-transparent bg-sell/20 text-sell border border-sell/50 shadow-[0_0_10px_rgba(244,63,94,0.2)]",
    hold: "border-transparent bg-hold/20 text-hold border border-hold/50 shadow-[0_0_10px_rgba(234,179,8,0.2)]",
  }

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        variants[variant],
        className
      )}
      {...props}
    />
  )
}

export { Badge }
