import type { PrefixedHexString } from "@ethereumjs/util";
import { mulG, mulPoint, addPoints, subPoints, pointToHex, hexToPoint, PEDERSEN_H, randomScalar, type Point } from "./curve";

/**
 * Pedersen commitments hide a transaction's amount while still letting the
 * node check that value is conserved: C(amount, blinding) = amount*G + blinding*H,
 * where H is a generator with no known discrete-log relationship to G.
 *
 * Known limitation (documented, not silently glossed over): this scheme
 * proves *conservation* of value across a shielded transaction (inputs -
 * outputs - fee == 0) but not that any individual amount is non-negative.
 * A real deployment would pair this with zero-knowledge range proofs
 * (e.g. Bulletproofs) to rule out wraparound/negative-amount cheating.
 * Emberchain does not implement those — instead the node performs a
 * plaintext bounds check (amount > 0, amount < a sane max) at submission
 * time, which is only as trustworthy as the already-documented
 * server-side-signing trust model used for the rest of the chain.
 */

export function pedersenCommit(amount: bigint, blinding: bigint): PrefixedHexString {
  const point = addPoints(mulG(amount), mulPoint(PEDERSEN_H, blinding));
  return pointToHex(point);
}

export function randomBlindingFactor(): bigint {
  return randomScalar();
}

export function commitmentsSum(commitments: (PrefixedHexString | string)[]): Point {
  return commitments.reduce<Point>((acc, hex, index) => {
    const point = hexToPoint(hex);
    return index === 0 ? point : addPoints(acc, point);
  }, hexToPoint(commitments[0]));
}

/**
 * Verifies that a shielded transaction conserves value without learning any
 * individual amount: sum(inputCommitments) - sum(outputCommitments) - fee*G
 * must be the identity point.
 */
export function verifyCommitmentBalance(
  inputCommitments: PrefixedHexString[],
  outputCommitments: PrefixedHexString[],
  fee: bigint,
): boolean {
  if (inputCommitments.length === 0) return false;
  const inputSum = commitmentsSum(inputCommitments);
  const outputSum = outputCommitments.length > 0 ? commitmentsSum(outputCommitments) : mulG(0n);
  const feePoint = mulG(fee);
  const remainder = subPoints(subPoints(inputSum, outputSum), feePoint);
  return remainder.equals(mulG(0n));
}
