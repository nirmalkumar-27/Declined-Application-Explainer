import { Router, type IRouter } from "express";
import healthRouter from "./health";
import declinedExplainerRouter from "./declined-explainer";

const router: IRouter = Router();

router.use(healthRouter);
router.use(declinedExplainerRouter);

export default router;
