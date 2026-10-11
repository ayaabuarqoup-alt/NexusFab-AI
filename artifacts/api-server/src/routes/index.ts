import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import accountsRouter from "./accounts";
import operationsRouter from "./operations";
import factoryWorkRouter from "./factory-work";
import notificationsRouter from "./notifications";
import planningRouter from "./planning";
import { readSession, sameOrigin } from "../middlewares/factory-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sameOrigin, readSession);
router.use(authRouter);
router.use(accountsRouter);
router.use(planningRouter);
router.use(factoryWorkRouter);
router.use(notificationsRouter);
router.use(operationsRouter);

export default router;
