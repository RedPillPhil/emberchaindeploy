import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetChainStatusResponse,
  ListBlocksQueryParams,
  ListBlocksResponse,
  GetBlockParams,
  GetBlockResponse,
} from "@workspace/api-zod";
import { chain } from "../lib/chain";

const router: IRouter = Router();

router.get("/chain/status", async (_req: Request, res: Response): Promise<void> => {
  const status = await chain.getStatus();
  res.status(200).json(GetChainStatusResponse.parse(status));
});

router.get("/chain/blocks", async (req: Request, res: Response): Promise<void> => {
  const query = ListBlocksQueryParams.parse(req.query);
  const blocks = await chain.listBlocks(query.limit);
  const summaries = blocks.map((block) => ({
    number: block.number,
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: block.timestamp,
    miner: block.miner,
    difficulty: block.difficulty,
    transactionCount: block.transactionHashes.length,
    nonce: block.nonce,
    payouts: block.payouts,
  }));
  res.status(200).json(ListBlocksResponse.parse(summaries));
});

router.get("/chain/blocks/:number", async (req: Request, res: Response): Promise<void> => {
  const params = GetBlockParams.parse(req.params);
  const block = await chain.getBlock(params.number);
  if (!block) {
    res.status(404).json({ error: `Block ${params.number} not found` });
    return;
  }
  res.status(200).json(
    GetBlockResponse.parse({
      number: block.number,
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: block.timestamp,
      miner: block.miner,
      difficulty: block.difficulty,
      transactionCount: block.transactionHashes.length,
      nonce: block.nonce,
      stateRoot: block.stateRoot,
      reward: block.reward,
      transactions: block.transactions,
      payouts: block.payouts,
    }),
  );
});

export default router;
