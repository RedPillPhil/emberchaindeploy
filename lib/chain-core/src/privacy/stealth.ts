import { keccak256 } from "ethereum-cryptography/keccak.js";
import { bytesToHex, hexToBytes } from "@ethereumjs/util";
import type { PrefixedHexString } from "@ethereumjs/util";
import { addressFromPublicKey } from "../crypto";
import {
  mod,
  mulG,
  mulPoint,
  addPoints,
  pointToHex,
  hexToPoint,
  hashToScalar,
  randomScalar,
  bytesToScalar,
  CURVE_ORDER,
} from "./curve";

/**
 * Stealth (one-time) address scheme, conceptually the same construction
 * Monero and ERC-5564 use: every wallet has a public "meta-address" made of
 * a spend key and a view key. Senders derive a brand-new, unlinkable
 * one-time destination address per payment via ECDH with the recipient's
 * view key; only the recipient (who holds both private keys) can recognize
 * and later spend funds sent to it.
 */

export interface StealthMeta {
  spendPublicKey: PrefixedHexString;
  viewPublicKey: PrefixedHexString;
}

export interface StealthDestination {
  /** Ephemeral public key R, published alongside the note so recipients can scan for it. */
  ephemeralPublicKey: PrefixedHexString;
  /** One-time destination public key P = spendPub + hash(sharedSecret)*G. */
  stealthPublicKey: PrefixedHexString;
  /** Emberchain address derived from the one-time public key. */
  stealthAddress: PrefixedHexString;
}

function normalizeHex(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

/** Derives a domain-separated child scalar from a wallet's main private key. Deterministic and one-way. */
function deriveChildScalar(mainPrivateKeyHex: string, domain: string): bigint {
  const bytes = hexToBytes(`0x${normalizeHex(mainPrivateKeyHex)}` as PrefixedHexString);
  const scalar = hashToScalar(domain, bytes);
  return scalar === 0n ? 1n : scalar;
}

export function deriveSpendPrivateKey(mainPrivateKeyHex: string): bigint {
  return deriveChildScalar(mainPrivateKeyHex, "EMBERCHAIN_STEALTH_SPEND_KEY_V1");
}

export function deriveViewPrivateKey(mainPrivateKeyHex: string): bigint {
  return deriveChildScalar(mainPrivateKeyHex, "EMBERCHAIN_STEALTH_VIEW_KEY_V1");
}

/** Derives a wallet's public stealth meta-address (safe to publish) from its main private key. */
export function getStealthMetaAddress(mainPrivateKeyHex: string): StealthMeta {
  const spendPub = mulG(deriveSpendPrivateKey(mainPrivateKeyHex));
  const viewPub = mulG(deriveViewPrivateKey(mainPrivateKeyHex));
  return {
    spendPublicKey: pointToHex(spendPub),
    viewPublicKey: pointToHex(viewPub),
  };
}

/**
 * Sender side: given a recipient's public stealth meta-address, derives a
 * brand-new one-time destination address plus the shared secret scalar
 * used to encrypt the note payload to the recipient.
 */
export function deriveStealthDestination(meta: StealthMeta): StealthDestination & { sharedSecretScalar: bigint } {
  const r = randomScalar();
  const ephemeralPoint = mulG(r);
  const viewPub = hexToPoint(meta.viewPublicKey);
  const sharedPoint = mulPoint(viewPub, r); // r * viewPub == viewPriv * R (ECDH)
  const sharedSecretScalar = hashToScalar("EMBERCHAIN_STEALTH_SHARED_SECRET_V1", pointToHex(sharedPoint));

  const spendPub = hexToPoint(meta.spendPublicKey);
  const stealthPoint = addPoints(spendPub, mulG(sharedSecretScalar));
  const stealthPublicKeyHex = pointToHex(stealthPoint);
  const stealthAddress = addressFromPublicKey(hexToBytes(stealthPublicKeyHex));

  return {
    ephemeralPublicKey: pointToHex(ephemeralPoint),
    stealthPublicKey: stealthPublicKeyHex,
    stealthAddress,
    sharedSecretScalar,
  };
}

export interface RecoveredStealthNote {
  /** True if this wallet owns the note (the recomputed one-time key matches). */
  owned: boolean;
  /** The one-time private key needed to spend the note. Only meaningful when `owned` is true. */
  oneTimePrivateKey: bigint;
  sharedSecretScalar: bigint;
}

/**
 * Recipient side: given the wallet's main private key and a note's
 * published ephemeral public key, recomputes the shared secret and checks
 * whether the note's one-time public key belongs to this wallet. If it
 * does, also recovers the one-time private key needed to spend it.
 */
export function recoverStealthOwnership(
  mainPrivateKeyHex: string,
  ephemeralPublicKeyHex: string,
  expectedStealthPublicKeyHex: string,
): RecoveredStealthNote {
  const viewPriv = deriveViewPrivateKey(mainPrivateKeyHex);
  const ephemeralPoint = hexToPoint(ephemeralPublicKeyHex);
  const sharedPoint = mulPoint(ephemeralPoint, viewPriv); // viewPriv * R == r * viewPub
  const sharedSecretScalar = hashToScalar("EMBERCHAIN_STEALTH_SHARED_SECRET_V1", pointToHex(sharedPoint));

  const spendPriv = deriveSpendPrivateKey(mainPrivateKeyHex);
  const spendPub = mulG(spendPriv);
  const candidatePoint = addPoints(spendPub, mulG(sharedSecretScalar));
  const candidateHex = pointToHex(candidatePoint);

  const owned = candidateHex.toLowerCase() === expectedStealthPublicKeyHex.toLowerCase();
  const oneTimePrivateKey = mod(spendPriv + sharedSecretScalar, CURVE_ORDER);

  return { owned, oneTimePrivateKey, sharedSecretScalar };
}

export function scalarToHex(scalar: bigint): PrefixedHexString {
  return `0x${scalar.toString(16).padStart(64, "0")}` as PrefixedHexString;
}

export function hexToScalarValue(hex: string): bigint {
  return bytesToScalar(hexToBytes(hex as PrefixedHexString));
}

export { keccak256 };
