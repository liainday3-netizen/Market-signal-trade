import { Router, type IRouter } from "express";
import * as risk from "../lib/riskManager";

// Mounted at /api/trader/risk — every route here is admin-only (see guardTraderRoutes).
const router: IRouter = Router();

router.get("/", async (_req, res) => {
  res.json(await risk.getStatus());
});

router.post("/limits", async (req, res) => {
  const limits = await risk.setLimits((req.body ?? {}) as Partial<risk.RiskLimits>);
  res.json(limits);
});

/** Engage the kill switch. Body: { reason?: string, flatten?: boolean } */
router.post("/kill", async (req, res) => {
  const { reason, flatten } = (req.body ?? {}) as { reason?: string; flatten?: boolean };
  await risk.engageKillSwitch(reason?.slice(0, 200) || "Manual kill switch");
  if (flatten === true) await risk.flattenAll("manual flatten");
  res.json(await risk.getStatus());
});

router.post("/release", async (_req, res) => {
  await risk.releaseKillSwitch();
  res.json(await risk.getStatus());
});

export default router;
