import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetMiningStatusResponse,
  StartMiningBody,
  StartMiningResponse,
  StopMiningResponse,
  SubmitBlockBody,
  SubmitShareBody,
  SubmitShareResponse,
} from "@workspace/api-zod";
import { chain } from "../lib/chain";

const router: IRouter = Router();

router.get("/mining/status", async (_req: Request, res: Response): Promise<void> => {
  const status = chain.getMiningStatus();
  res.status(200).json(GetMiningStatusResponse.parse(status));
});

router.post("/mining/start", async (req: Request, res: Response): Promise<void> => {
  const body = StartMiningBody.parse(req.body ?? {});
  try {
    const status = await chain.startMining(body.minerAddress, body.intensity ?? 2);
    res.status(200).json(StartMiningResponse.parse(status));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to start mining" });
  }
});

router.post("/mining/stop", async (_req: Request, res: Response): Promise<void> => {
  const status = await chain.stopMining();
  res.status(200).json(StopMiningResponse.parse(status));
});

// ── Browser mining ────────────────────────────────────────────────────────────

/** GET /mining/template?minerAddress=0x...
 *  Returns a block template for the browser WebWorker to mine.
 *  The response includes both `target` (full block difficulty) and
 *  `shareTarget` (64× easier) for proportional share-based payouts. */
router.get("/mining/template", async (req: Request, res: Response): Promise<void> => {
  const minerAddress = String(req.query.minerAddress ?? "");
  try {
    const template = await chain.getMiningTemplate(minerAddress);
    res.status(200).json(template);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to get template" });
  }
});

/** POST /mining/submit
 *  Validates and finalises a block mined in the browser. */
router.post("/mining/submit", async (req: Request, res: Response): Promise<void> => {
  const body = SubmitBlockBody.parse(req.body ?? {});
  try {
    const block = await chain.submitMinedBlock(body);
    res.status(200).json(block);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Block submission failed";
    const status = msg.startsWith("Stale template") ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

/** POST /mining/share
 *  Validates a partial proof-of-work (share) and credits the miner
 *  in the current round.  If the nonce also meets full block difficulty
 *  it is automatically promoted to a block submission. */
router.post("/mining/share", async (req: Request, res: Response): Promise<void> => {
  const body = SubmitShareBody.parse(req.body ?? {});
  try {
    const result = await chain.submitShare({
      minerAddress: body.minerAddress,
      header: {
        number: body.header.number,
        parentHash: body.header.parentHash,
        timestamp: body.header.timestamp,
        miner: body.header.miner,
        difficulty: body.header.difficulty,
        transactionsRoot: body.header.transactionsRoot,
      },
      nonce: body.nonce,
    });
    res.status(200).json(SubmitShareResponse.parse(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Share submission failed";
    const isStale = msg.startsWith("Stale share");
    const isDuplicate = msg.startsWith("Duplicate share");
    res.status(isStale || isDuplicate ? 409 : 400).json({ error: msg });
  }
});

export default router;
