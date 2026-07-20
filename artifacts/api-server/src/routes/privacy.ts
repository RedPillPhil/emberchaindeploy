import { Router, type IRouter, type Request, type Response } from "express";
import { chain } from "../lib/chain";

const router: IRouter = Router();

function parseBody(req: Request) {
  return req.body ?? {};
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  if (typeof val !== "string" || val.trim() === "") throw new Error(`Missing required field: ${key}`);
  return val;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}

// ---------- Privacy pool routes ----------

router.get("/privacy/status", async (_req: Request, res: Response): Promise<void> => {
  const status = await chain.getPrivacyStatus();
  res.status(200).json(status);
});

router.get("/privacy/meta/:address", async (req: Request, res: Response): Promise<void> => {
  const meta = await chain.getStealthMeta(req.params["address"] as string);
  if (!meta) {
    res.status(404).json({ error: "No stealth meta-address registered for this wallet on this node" });
    return;
  }
  res.status(200).json(meta);
});

router.post("/privacy/balance", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = parseBody(req);
    const privateKey = requireString(body, "privateKey");
    const result = await chain.getPrivateBalance(privateKey);
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to scan private balance" });
  }
});

router.post("/privacy/shield", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = parseBody(req);
    const fromPrivateKey = requireString(body, "fromPrivateKey");
    const amount = requireString(body, "amount");
    const toAddress = optionalString(body, "toAddress");
    const record = await chain.shield({ fromPrivateKey, amount, toAddress });
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Shield failed" });
  }
});

router.post("/privacy/send", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = parseBody(req);
    const fromPrivateKey = requireString(body, "fromPrivateKey");
    const toAddress = requireString(body, "toAddress");
    const amount = requireString(body, "amount");
    const fee = optionalString(body, "fee");
    const record = await chain.privateSend({ fromPrivateKey, toAddress, amount, fee });
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Private send failed" });
  }
});

router.post("/privacy/unshield", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = parseBody(req);
    const fromPrivateKey = requireString(body, "fromPrivateKey");
    const toAddress = requireString(body, "toAddress");
    const amount = requireString(body, "amount");
    const record = await chain.unshield({ fromPrivateKey, toAddress, amount });
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unshield failed" });
  }
});

router.get("/privacy/transactions", async (req: Request, res: Response): Promise<void> => {
  const limit = req.query.limit ? parseInt(String(req.query.limit)) : 20;
  const records = await chain.listPrivacyLedger(limit);
  res.status(200).json(records);
});

export default router;
