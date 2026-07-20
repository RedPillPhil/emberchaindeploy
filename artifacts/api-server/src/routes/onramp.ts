/**
 * On-ramp configuration endpoint.
 * Returns public Transak widget configuration — the API key is a public
 * partner identifier (embedded in the widget URL, visible to anyone), so
 * it is safe to return from this endpoint without authentication.
 *
 * Set TRANSAK_API_KEY in environment secrets to enable production mode.
 * Without it the widget runs in Transak's free staging/demo environment.
 */
import { Router } from "express";

const router = Router();

router.get("/onramp/config", (_req, res) => {
  const apiKey = process.env.TRANSAK_API_KEY ?? "";
  const staging = !apiKey;

  res.json({
    provider: "transak",
    apiKey,
    staging,
    widgetUrl: staging
      ? "https://global-stg.transak.com"
      : "https://global.transak.com",
    // Ramp Network fallback (no key required at all)
    rampUrl: "https://app.ramp.network",
  });
});

export default router;
