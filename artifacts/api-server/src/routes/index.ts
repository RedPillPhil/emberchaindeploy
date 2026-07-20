import { Router, type IRouter } from "express";
import healthRouter from "./health";
import walletsRouter from "./wallets";
import chainRouter from "./chain";
import transactionsRouter from "./transactions";
import contractsRouter from "./contracts";
import miningRouter from "./mining";
import privacyRouter from "./privacy";
import exchangeRouter from "./exchange";
import rpcRouter from "./rpc";
import onrampRouter from "./onramp";
import communityRouter from "./community";
import bridgeRouter from "./bridge";
const router: IRouter = Router();

router.use(healthRouter);
router.use(walletsRouter);
router.use(chainRouter);
router.use(transactionsRouter);
router.use(contractsRouter);
router.use(miningRouter);
router.use(privacyRouter);
router.use(exchangeRouter);
router.use(rpcRouter);
router.use(onrampRouter);
router.use(communityRouter);
router.use(bridgeRouter);

export default router;
