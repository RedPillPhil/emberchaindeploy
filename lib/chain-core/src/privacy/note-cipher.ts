import { keccak256 } from "ethereum-cryptography/keccak.js";
import { bytesToHex, hexToBytes } from "@ethereumjs/util";
import type { PrefixedHexString } from "@ethereumjs/util";

/**
 * Symmetric encryption of a note's plaintext payload (amount + blinding
 * factor) to the shared secret derived during stealth-address ECDH. Uses a
 * keccak-based keystream (CTR-style) plus a keccak MAC — self-contained
 * (no extra dependency) and adequate for this documented, non-audited demo
 * privacy layer; a production system would use an audited AEAD cipher.
 */

function keystream(key: Uint8Array, lengthBytes: number): Uint8Array {
  const out = new Uint8Array(lengthBytes);
  let offset = 0;
  let counter = 0;
  while (offset < lengthBytes) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter);
    const block = keccak256(new Uint8Array([...key, ...counterBytes]));
    const take = Math.min(block.length, lengthBytes - offset);
    out.set(block.slice(0, take), offset);
    offset += take;
    counter += 1;
  }
  return out;
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

function deriveKeyAndMacKey(sharedSecretScalarHex: string): { encKey: Uint8Array; macKey: Uint8Array } {
  const seed = hexToBytes(sharedSecretScalarHex as PrefixedHexString);
  const encKey = keccak256(new Uint8Array([...seed, ...new TextEncoder().encode("note-encrypt")]));
  const macKey = keccak256(new Uint8Array([...seed, ...new TextEncoder().encode("note-mac")]));
  return { encKey, macKey };
}

export interface NotePlaintext {
  amount: string; // decimal string, wei-like smallest unit
  blinding: string; // hex scalar
}

/** Encrypts a note's amount+blinding to the recipient's shared secret. Output: `0x` + 16-byte tag + ciphertext. */
export function encryptNotePayload(sharedSecretScalarHex: string, plaintext: NotePlaintext): PrefixedHexString {
  const { encKey, macKey } = deriveKeyAndMacKey(sharedSecretScalarHex);
  const plainBytes = new TextEncoder().encode(JSON.stringify(plaintext));
  const ks = keystream(encKey, plainBytes.length);
  const cipherBytes = xor(plainBytes, ks);
  const tag = keccak256(new Uint8Array([...macKey, ...plainBytes])).slice(0, 16);
  return bytesToHex(new Uint8Array([...tag, ...cipherBytes]));
}

/** Decrypts and authenticates a note payload. Returns null if the shared secret doesn't match (wrong owner or corrupted data). */
export function decryptNotePayload(sharedSecretScalarHex: string, encryptedHex: string): NotePlaintext | null {
  const { encKey, macKey } = deriveKeyAndMacKey(sharedSecretScalarHex);
  const raw = hexToBytes(encryptedHex as PrefixedHexString);
  if (raw.length < 16) return null;
  const tag = raw.slice(0, 16);
  const cipherBytes = raw.slice(16);
  const ks = keystream(encKey, cipherBytes.length);
  const plainBytes = xor(cipherBytes, ks);
  const expectedTag = keccak256(new Uint8Array([...macKey, ...plainBytes])).slice(0, 16);
  for (let i = 0; i < 16; i++) {
    if (tag[i] !== expectedTag[i]) return null;
  }
  try {
    return JSON.parse(new TextDecoder().decode(plainBytes)) as NotePlaintext;
  } catch {
    return null;
  }
}
