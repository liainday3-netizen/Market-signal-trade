import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getHeartbeat } from "../lib/autoTrader";
import { isKillSwitchEngaged, isLiveArmed } from "../lib/riskManager";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Deep health for uptime monitors (UptimeRobot, Better Stack, etc.).
// Returns 503 when the trading loop has stopped processing market data, so the
// monitor pages you even if the HTTP server itself is still up.
router.get("/healthz/deep", (_req, res) => {
  const hb = getHeartbeat();
  const ok = hb.running && !hb.stale;
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    loop: hb,
    killSwitch: isKillSwitchEngaged(),
    liveArmed: isLiveArmed(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

export default router;
