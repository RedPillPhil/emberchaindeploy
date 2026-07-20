import type { PrefixedHexString } from "@ethereumjs/util";
import {
  mod,
  mulG,
  mulPoint,
  addPoints,
  pointToHex,
  hexToPoint,
  hashToScalar,
  randomScalar,
  hashToPointForKey,
  CURVE_ORDER,
} from "./curve";

/**
 * Linkable Spontaneous Anonymous Group (LSAG) ring signature — the same
 * construction Monero's original ring signatures were built on. Given a
 * ring of one-time public keys (the real spender's key plus decoys drawn
 * from other unspent notes), a signer proves "I know the private key for
 * one of these keys" without revealing which one, while producing a `key
 * image` that is unique to whichever key was actually used. The node
 * rejects any signature whose key image has been seen before, which is
 * what actually prevents double-spending a note.
 */

export interface RingSignature {
  c0: PrefixedHexString;
  s: PrefixedHexString[];
  keyImage: PrefixedHexString;
}

function scalarToHex(scalar: bigint): PrefixedHexString {
  return `0x${mod(scalar).toString(16).padStart(64, "0")}` as PrefixedHexString;
}

function hexToScalarValue(hex: string): bigint {
  return mod(BigInt(hex));
}

export function computeKeyImage(oneTimePrivateKey: bigint, oneTimePublicKeyHex: string): PrefixedHexString {
  const hp = hashToPointForKey(oneTimePublicKeyHex);
  const image = mulPoint(hp, oneTimePrivateKey);
  return pointToHex(image);
}

/**
 * Signs `message` proving knowledge of the private key behind
 * `ring[secretIndex]`, without revealing which index. `ring` must contain
 * at least one public key (the real one); additional entries act as
 * decoys and grow the transaction's anonymity set.
 */
export function signRing(
  message: Uint8Array,
  ring: PrefixedHexString[],
  secretIndex: number,
  oneTimePrivateKey: bigint,
): RingSignature {
  const n = ring.length;
  if (n === 0) throw new Error("Ring must contain at least one public key");
  if (secretIndex < 0 || secretIndex >= n) throw new Error("secretIndex out of range");

  const realPublicKey = ring[secretIndex];
  const keyImagePoint = mulPoint(hashToPointForKey(realPublicKey), oneTimePrivateKey);
  const keyImageHex = pointToHex(keyImagePoint);

  const s: bigint[] = new Array(n).fill(0n);
  const c: bigint[] = new Array(n).fill(0n);

  const alpha = randomScalar();
  const startIndex = (secretIndex + 1) % n;
  c[startIndex] = hashToScalar(
    "EMBERCHAIN_LSAG_V1",
    message,
    pointToHex(mulG(alpha)),
    pointToHex(mulPoint(hashToPointForKey(realPublicKey), alpha)),
  );

  let i = startIndex;
  while (i !== secretIndex) {
    s[i] = randomScalar();
    const pubPoint = hexToPoint(ring[i]);
    const L = addPoints(mulG(s[i]), mulPoint(pubPoint, c[i]));
    const R = addPoints(mulPoint(hashToPointForKey(ring[i]), s[i]), mulPoint(keyImagePoint, c[i]));
    const next = (i + 1) % n;
    c[next] = hashToScalar("EMBERCHAIN_LSAG_V1", message, pointToHex(L), pointToHex(R));
    i = next;
  }

  s[secretIndex] = mod(alpha - c[secretIndex] * oneTimePrivateKey, CURVE_ORDER);

  return {
    c0: scalarToHex(c[0]),
    s: s.map(scalarToHex),
    keyImage: keyImageHex,
  };
}

export function verifyRing(message: Uint8Array, ring: PrefixedHexString[], signature: RingSignature): boolean {
  const n = ring.length;
  if (n === 0 || signature.s.length !== n) return false;

  const keyImagePoint = hexToPoint(signature.keyImage);
  let c = hexToScalarValue(signature.c0);
  const c0 = c;

  for (let i = 0; i < n; i++) {
    const s = hexToScalarValue(signature.s[i]);
    const pubPoint = hexToPoint(ring[i]);
    const L = addPoints(mulG(s), mulPoint(pubPoint, c));
    const R = addPoints(mulPoint(hashToPointForKey(ring[i]), s), mulPoint(keyImagePoint, c));
    c = hashToScalar("EMBERCHAIN_LSAG_V1", message, pointToHex(L), pointToHex(R));
  }

  return c === c0;
}
