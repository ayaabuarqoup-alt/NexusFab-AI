import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import operationsRouter from "./operations";
import { readSession, sameOrigin } from "../middlewares/factory-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sameOrigin, readSession);
router.use(authRouter);
router.use(operationsRouter);

export default router;
