import { keccak256 } from "ethereum-cryptography/keccak.js";
import { secp256k1 } from "ethereum-cryptography/secp256k1.js";
import { bytesToHex, hexToBytes } from "@ethereumjs/util";
import type { PrefixedHexString } from "@ethereumjs/util";

export interface WalletKeys {
  privateKey: PrefixedHexString;
  publicKey: PrefixedHexString;
  address: PrefixedHexString;
}

function normalizeHex(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

export function addressFromPublicKey(uncompressedPubKey: Uint8Array): PrefixedHexString {
  // Drop the 0x04 uncompressed-point prefix, then take the last 20 bytes of keccak256.
  const raw = uncompressedPubKey.length === 65 ? uncompressedPubKey.slice(1) : uncompressedPubKey;
  const hash = keccak256(raw);
  return bytesToHex(hash.slice(-20));
}

export function walletFromPrivateKey(privateKeyHex: string): WalletKeys {
  const privateKeyBytes = hexToBytes(`0x${normalizeHex(privateKeyHex)}`);
  if (!secp256k1.utils.isValidPrivateKey(privateKeyBytes)) {
    throw new Error("Invalid private key");
  }
  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, false);
  return {
    privateKey: bytesToHex(privateKeyBytes),
    publicKey: bytesToHex(publicKeyBytes),
    address: addressFromPublicKey(publicKeyBytes),
  };
}

export function generateWallet(): WalletKeys {
  const privateKeyBytes = secp256k1.utils.randomPrivateKey();
  return walletFromPrivateKey(bytesToHex(privateKeyBytes));
}

export interface TxSignature {
  r: PrefixedHexString;
  s: PrefixedHexString;
  v: number;
}

/** Deterministic byte encoding of the fields that make up a transaction's signing payload. */
export function encodeTxPayload(fields: {
  nonce: number;
  to: string | null;
  value: string;
  data: PrefixedHexString;
  gasLimit: string;
  chainId: number;
}): Uint8Array {
  const json = JSON.stringify({
    nonce: fields.nonce,
    to: fields.to ?? "",
    value: fields.value,
    data: fields.data,
    gasLimit: fields.gasLimit,
    chainId: fields.chainId,
  });
  return new TextEncoder().encode(json);
}

export function signPayload(
  privateKeyHex: string,
  payload: Uint8Array,
): { signature: TxSignature; hash: PrefixedHexString } {
  const privateKeyBytes = hexToBytes(`0x${normalizeHex(privateKeyHex)}`);
  const digest = keccak256(payload);
  const sig = secp256k1.sign(digest, privateKeyBytes, { prehash: false });
  const compact = sig.toCompactRawBytes();
  return {
    signature: {
      r: bytesToHex(compact.slice(0, 32)),
      s: bytesToHex(compact.slice(32, 64)),
      v: sig.recovery,
    },
    hash: bytesToHex(digest),
  };
}

export function hashTransaction(payload: Uint8Array, signature: TxSignature): PrefixedHexString {
  const sigBytes = new TextEncoder().encode(`${signature.r}${signature.s}${signature.v}`);
  const combined = new Uint8Array(payload.length + sigBytes.length);
  combined.set(payload, 0);
  combined.set(sigBytes, payload.length);
  return bytesToHex(keccak256(combined));
}
