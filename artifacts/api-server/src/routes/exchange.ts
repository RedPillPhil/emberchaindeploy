import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateListingBody,
  CancelListingBody,
  BuyListingBody,
  ReserveListingBody,
  ListExchangeListingsParams,
} from "@workspace/api-zod";
import { chain } from "../lib/chain";
import { verifyPayment } from "../lib/payment-verifier";
import { getProofByTxHash } from "../lib/db";

const router: IRouter = Router();

type IdParams = { id: string };

// GET /exchange/listings
router.get("/exchange/listings", async (req: Request, res: Response): Promise<void> => {
  const query = ListExchangeListingsParams.parse(req.query);
  const listings = await chain.listExchangeListings(query.status);
  const filtered = query.seller
    ? listings.filter((l) => l.sellerAddress.toLowerCase() === query.seller!.toLowerCase())
    : listings;
  res.status(200).json(filtered);
});

// GET /exchange/listings/:id
router.get("/exchange/listings/:id", async (req: Request<IdParams>, res: Response): Promise<void> => {
  const listing = await chain.getExchangeListing(req.params.id);
  if (!listing) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }
  res.status(200).json(listing);
});

// POST /exchange/listings — create a listing (locks EMBR immediately, auth via private key)
router.post("/exchange/listings", async (req: Request, res: Response): Promise<void> => {
  const body = CreateListingBody.parse(req.body ?? {});
  try {
    const listing = await chain.createListing(body);
    res.status(201).json(listing);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to create listing" });
  }
});

// POST /exchange/listings/:id/cancel — seller cancels, EMBR unlocked
router.post("/exchange/listings/:id/cancel", async (req: Request<IdParams>, res: Response): Promise<void> => {
  const body = CancelListingBody.parse(req.body ?? {});
  try {
    const listing = await chain.cancelListing(req.params.id, body.sellerPrivateKey);
    res.status(200).json(listing);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to cancel listing" });
  }
});

// POST /exchange/listings/:id/reserve — buyer reserves the listing for 15 minutes
router.post("/exchange/listings/:id/reserve", async (req: Request<IdParams>, res: Response): Promise<void> => {
  let body: { buyerAddress: string };
  try {
    body = ReserveListingBody.parse(req.body ?? {});
  } catch {
    res.status(400).json({ error: "buyerAddress is required" });
    return;
  }
  try {
    const listing = chain.reserveListing(req.params.id, body.buyerAddress);
    res.status(200).json(listing);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not reserve listing";
    // 409 = already reserved by someone else
    const status = msg.includes("reserved by another buyer") ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

// POST /exchange/listings/:id/buy — submit payment proof; verifies then releases EMBR
router.post("/exchange/listings/:id/buy", async (req: Request<IdParams>, res: Response): Promise<void> => {
  const body = BuyListingBody.parse(req.body ?? {});
  const id = req.params.id;

  // Synchronously lock the listing AND reserve the payment proof before any async work.
  // Everything in one event-loop tick — atomicity via Node.js's single-threaded model.
  let listing;
  try {
    listing = chain.lockListingForFulfillment(id, body.paymentTxHash, body.buyerAddress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Listing not available";
    if (msg.includes("already used")) {
      const existing = await getProofByTxHash(body.paymentTxHash);
      res.status(409).json({
        error: existing
          ? `This ${existing.currency} transaction has already been used to fulfill listing ${existing.listingId}. Each payment transaction can only be used once.`
          : "This transaction has already been used to fulfill a previous listing. Each payment transaction can only be used once.",
        code: "DUPLICATE_PROOF",
        originalListingId: existing?.listingId ?? null,
        currency: existing?.currency ?? null,
      });
    } else if (msg.includes("reserved by another buyer") || msg.includes("reserve this listing first")) {
      res.status(409).json({ error: msg, code: "LISTING_RESERVED" });
    } else {
      res.status(409).json({ error: msg });
    }
    return;
  }

  // Determine which receive address to verify against
  const selectedNetwork = body.selectedNetwork;
  let receiveAddress = listing.receiveAddress;
  if (listing.currency === "USDT" && selectedNetwork && listing.networkAddresses) {
    const networkAddr = listing.networkAddresses[selectedNetwork];
    if (networkAddr) receiveAddress = networkAddr;
  }

  try {
    const result = await verifyPayment(
      listing.currency,
      body.paymentTxHash,
      receiveAddress,
      listing.priceAmount,
      selectedNetwork,
    );

    if (!result.valid) {
      chain.unlockListing(id);
      res.status(400).json({
        error: result.reason ?? "Payment verification failed",
        code: "PAYMENT_VERIFICATION_FAILED",
        confirmations: result.confirmations,
      });
      return;
    }

    const fulfilled = await chain.commitFulfillment(id, body.buyerAddress, body.paymentTxHash, selectedNetwork);
    res.status(200).json(fulfilled);
  } catch (err) {
    chain.unlockListing(id);
    const msg = err instanceof Error ? err.message : "Fulfillment failed";
    const status = msg.startsWith("Payment proof already used") ? 409 : 500;
    res.status(status).json({ error: msg });
  }
});

export default router;
