import { Router, type IRouter } from "express";
import healthRouter from "./health";
import traderRouter from "./trader";
import riskRouter from "./risk";
import { guardTraderRoutes } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/trader", guardTraderRoutes);
router.use("/trader/risk", riskRouter);
router.use("/trader", traderRouter);

export default router;
