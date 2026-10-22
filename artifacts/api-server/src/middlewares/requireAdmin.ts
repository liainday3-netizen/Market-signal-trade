// Protects every state-changing or sensitive endpoint with a bearer token.
//
// Before this, anyone who found the public URL could enable live trading,
// change budgets, reset the portfolio or POST a wallet private key.
//
//   ADMIN_TOKEN=<long random string>   (required in production)
//
// In production with no ADMIN_TOKEN set, protected routes return 503 (fail
// closed). In development they are open so local work isn't blocked.
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function extractToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  const x = req.headers["x-admin-token"];
  return typeof x === "string" ? x.trim() : null;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "ADMIN_TOKEN is not configured on the server — control endpoints are locked." });
      return;
    }
    next();
    return;
  }
  const got = extractToken(req);
  if (!got || !safeEqual(got, expected)) {
    res.status(401).json({ error: "Unauthorized — admin token required" });
    return;
  }
  next();
}

/** Paths (under /api/trader) that are read-only but still sensitive. */
const SENSITIVE_GET = [/^\/exchange\//, /^\/dex\/balances/, /^\/risk/];

/** Guard all non-GET requests plus sensitive GETs. */
export function guardTraderRoutes(req: Request, res: Response, next: NextFunction): void {
  const isRead = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
  // PROTECT_READS=true locks the whole dashboard API (balances, trades, PnL).
  const protectReads = (process.env.PROTECT_READS ?? "").toLowerCase() === "true" && req.method !== "OPTIONS";
  if (!isRead || protectReads || SENSITIVE_GET.some((re) => re.test(req.path))) {
    requireAdmin(req, res, next);
    return;
  }
  next();
}
