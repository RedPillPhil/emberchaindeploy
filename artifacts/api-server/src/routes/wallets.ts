import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateWalletBody,
  CreateWalletResponse,
  ListWalletsResponse,
  GetWalletParams,
  GetWalletResponse,
} from "@workspace/api-zod";
import { chain } from "../lib/chain";

const router: IRouter = Router();

router.post("/wallets", async (req: Request, res: Response): Promise<void> => {
  const body = CreateWalletBody.parse(req.body ?? {});
  try {
    const wallet = await chain.createWallet(body.privateKey ?? null);
    res.status(201).json(CreateWalletResponse.parse(wallet));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to create wallet" });
  }
});

router.get("/wallets", async (_req: Request, res: Response): Promise<void> => {
  const wallets = await chain.listWallets();
  res.status(200).json(ListWalletsResponse.parse(wallets));
});

router.get("/wallets/:address", async (req: Request, res: Response): Promise<void> => {
  const params = GetWalletParams.parse(req.params);
  const wallet = await chain.getWallet(params.address as `0x${string}`);
  res.status(200).json(GetWalletResponse.parse(wallet));
});

export default router;
