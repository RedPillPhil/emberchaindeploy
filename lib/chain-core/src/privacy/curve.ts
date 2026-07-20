import { secp256k1 } from "ethereum-cryptography/secp256k1.js";
import { keccak256 } from "ethereum-cryptography/keccak.js";
import { bytesToHex, hexToBytes } from "@ethereumjs/util";
import type { PrefixedHexString } from "@ethereumjs/util";

/**
 * Low-level elliptic-curve helpers shared by the privacy/shielded-pool
 * primitives (stealth addresses, Pedersen commitments, ring signatures).
 *
 * Everything here operates on the same secp256k1 curve as Emberchain's
 * regular account keys, using `ProjectivePoint` for raw point arithmetic
 * (addition/subtraction/scalar multiplication) that the high-level
 * sign/getPublicKey/getSharedSecret API doesn't expose.
 */

export type Point = InstanceType<typeof secp256k1.ProjectivePoint>;

const { ProjectivePoint, CURVE } = secp256k1;

/** The order of the secp256k1 group — all scalars are reduced mod this. */
export const CURVE_ORDER = CURVE.n;

export function mod(a: bigint, m: bigint = CURVE_ORDER): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

export function bytesToScalar(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return mod(value);
}

/** Deterministic pseudo-random scalar derived from arbitrary domain-separated inputs. */
export function hashToScalar(...parts: (Uint8Array | string)[]): bigint {
  const encoder = new TextEncoder();
  const chunks = parts.map((p) => (typeof p === "string" ? encoder.encode(p) : p));
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return bytesToScalar(keccak256(combined));
}

/** Cryptographically random nonzero scalar mod the curve order. */
export function randomScalar(): bigint {
  const bytes = secp256k1.utils.randomPrivateKey();
  const scalar = bytesToScalar(bytes);
  return scalar === 0n ? 1n : scalar;
}

/** Scalar multiplication of the base point G. Tolerates a zero scalar (returns the identity). */
export function mulG(scalar: bigint): Point {
  const s = mod(scalar);
  if (s === 0n) return ProjectivePoint.ZERO;
  return ProjectivePoint.BASE.multiply(s);
}

/** Scalar multiplication of an arbitrary point. Tolerates a zero scalar (returns the identity). */
export function mulPoint(point: Point, scalar: bigint): Point {
  const s = mod(scalar);
  if (s === 0n) return ProjectivePoint.ZERO;
  return point.multiplyUnsafe(s);
}

export function addPoints(a: Point, b: Point): Point {
  return a.add(b);
}

export function subPoints(a: Point, b: Point): Point {
  return a.subtract(b);
}

export function pointsEqual(a: Point, b: Point): boolean {
  return a.equals(b);
}

/** Serializes a point to 33-byte compressed hex. The identity point cannot be serialized. */
export function pointToHex(point: Point): PrefixedHexString {
  return bytesToHex(point.toRawBytes(true));
}

export function hexToPoint(hex: string): Point {
  return ProjectivePoint.fromHex(hexToBytes(hex as PrefixedHexString));
}

export function privateKeyToPoint(privateKeyHex: string): Point {
  const bytes = hexToBytes(privateKeyHex as PrefixedHexString);
  return mulG(bytesToScalar(bytes));
}

/**
 * Hashes arbitrary domain-separated input to a point on secp256k1 via
 * try-and-increment: hash to a candidate x-coordinate, ask the curve
 * library whether `02 || x` is a valid compressed point, and retry with an
 * incremented counter if not (~50% success rate per try).
 *
 * This produces a generator with no known discrete-log relationship to G —
 * used for the Pedersen commitment's second generator `H`, and per-key
 * generators in the ring-signature scheme (a real "hash-to-point").
 */
export function hashToCurvePoint(...parts: (Uint8Array | string)[]): Point {
  const encoder = new TextEncoder();
  const chunks = parts.map((p) => (typeof p === "string" ? encoder.encode(p) : p));
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const seed = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    seed.set(chunk, offset);
    offset += chunk.length;
  }

  for (let counter = 0; counter < 1000; counter++) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter);
    const combined = new Uint8Array(seed.length + counterBytes.length);
    combined.set(seed, 0);
    combined.set(counterBytes, seed.length);
    const xBytes = keccak256(combined);
    const compressedHex = `02${bytesToHex(xBytes).slice(2)}`;
    try {
      const point = ProjectivePoint.fromHex(compressedHex);
      point.assertValidity();
      return point;
    } catch {
      // Not a valid x-coordinate on the curve — try the next counter.
    }
  }
  throw new Error("hashToCurvePoint: failed to find a valid curve point after 1000 tries");
}

/** Nothing-up-my-sleeve second generator for Pedersen commitments, independent of G. */
export const PEDERSEN_H: Point = hashToCurvePoint("EMBERCHAIN_PEDERSEN_H_GENERATOR_V1");

/** Per-one-time-key generator used for ring-signature key images: Hp(P). */
export function hashToPointForKey(publicKeyHex: string): Point {
  return hashToCurvePoint("EMBERCHAIN_RING_KEY_IMAGE_GENERATOR_V1", publicKeyHex);
}
