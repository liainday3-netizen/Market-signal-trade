import { Router, type IRouter } from "express";
import healthRouter from "./health";
import traderRouter from "./trader";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/trader", traderRouter);

export default router;
