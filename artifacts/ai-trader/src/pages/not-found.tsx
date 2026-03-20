import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { SquareTerminal } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex justify-center mb-8">
           <div className="w-16 h-16 rounded-xl bg-destructive/20 border border-destructive/50 flex items-center justify-center text-destructive shadow-[0_0_30px_rgba(220,38,38,0.3)]">
              <SquareTerminal size={32} />
            </div>
        </div>
        <h1 className="text-6xl font-bold font-mono text-foreground tracking-tighter">404</h1>
        <p className="text-xl text-muted-foreground font-medium">Terminal route not found.</p>
        <p className="text-sm text-muted-foreground/70">
          The endpoint or page you are trying to access does not exist in this system.
        </p>
        <div className="pt-4">
          <Link href="/">
            <Button size="lg" className="font-mono">
              Return to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
