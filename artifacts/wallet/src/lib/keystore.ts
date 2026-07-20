/**
 * Client-side keystore encryption/decryption using only Web Crypto API.
 *
 * Format:
 *   version: 1
 *   kdf:     PBKDF2-SHA256, 600 000 iterations
 *   cipher:  AES-256-GCM  (auth tag appended by the browser)
 *
 * No third-party crypto libraries required.
 */

export interface KeystoreFile {
  version: 1;
  id: string;
  address: string;
  crypto: {
    cipher: "aes-256-gcm";
    ciphertext: string; // base64 — GCM auth tag included
    iv: string;         // base64
    kdf: "pbkdf2";
    kdfparams: {
      salt: string;     // base64
      iterations: number;
      hash: string;     // "SHA-256"
      keylen: number;   // 32
    };
  };
}

// ── encoding helpers ──────────────────────────────────────────────────────────

function bufToBase64(buf: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Decode a base64 string to a Uint8Array backed by a plain ArrayBuffer.
 * Explicitly allocating via `new Uint8Array(n)` avoids the SharedArrayBuffer
 * generic mismatch that TypeScript 5.x enforces against Web Crypto's
 * BufferSource / ArrayBufferView<ArrayBuffer> parameter types.
 */
function base64ToBuf(s: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(s);
  const out = new Uint8Array(decoded.length); // backed by ArrayBuffer
  for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
  return out;
}

/**
 * Decode a 0x-prefixed hex private key to Uint8Array<ArrayBuffer>.
 */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2); // backed by ArrayBuffer
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── key derivation ────────────────────────────────────────────────────────────

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── random buffers ────────────────────────────────────────────────────────────

/**
 * crypto.getRandomValues returns Uint8Array<ArrayBufferLike> in TypeScript 5.x
 * lib types. Wrapping in `new Uint8Array(n)` + copy gives us the
 * Uint8Array<ArrayBuffer> the Web Crypto params require.
 */
function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Encrypt a private key (0x-prefixed hex) with a password.
 */
export async function encryptKeystore(
  privateKey: string,
  password: string,
  address: string,
): Promise<KeystoreFile> {
  const salt = randomBytes(32);
  const iv   = randomBytes(12);
  const key  = await deriveKey(password, salt, 600_000);

  const plainBytes = hexToBytes(privateKey);
  const cipherBuf  = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plainBytes,
  );

  return {
    version: 1,
    id: crypto.randomUUID(),
    address: address.toLowerCase(),
    crypto: {
      cipher: "aes-256-gcm",
      ciphertext: bufToBase64(cipherBuf),
      iv: bufToBase64(iv),
      kdf: "pbkdf2",
      kdfparams: {
        salt: bufToBase64(salt),
        iterations: 600_000,
        hash: "SHA-256",
        keylen: 32,
      },
    },
  };
}

/**
 * Decrypt a KeystoreFile with a password.
 * Returns the private key as a 0x-prefixed hex string.
 * Throws a user-friendly Error on wrong password or corrupt file.
 */
export async function decryptKeystore(
  keystore: KeystoreFile,
  password: string,
): Promise<string> {
  const { kdfparams, iv: ivB64, ciphertext } = keystore.crypto;

  const salt       = base64ToBuf(kdfparams.salt);
  const iv         = base64ToBuf(ivB64);
  const cipherData = base64ToBuf(ciphertext);
  const key        = await deriveKey(password, salt, kdfparams.iterations);

  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipherData,
    );
  } catch {
    throw new Error("Wrong password or corrupted keystore file.");
  }

  return bytesToHex(new Uint8Array(plain));
}

/**
 * Trigger a browser download of a keystore JSON file.
 */
export function downloadKeystore(keystore: KeystoreFile): void {
  const json  = JSON.stringify(keystore, null, 2);
  const blob  = new Blob([json], { type: "application/json" });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  const tag   = keystore.address.slice(0, 10);
  a.href     = url;
  a.download = `emberchain-keystore-${tag}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── backup-confirmed flag (per-address) ──────────────────────────────────────

const BACKUP_KEY = "emberchain_backup_confirmed";

function confirmedSet(): Set<string> {
  try {
    return new Set(
      JSON.parse(localStorage.getItem(BACKUP_KEY) ?? "[]") as string[],
    );
  } catch {
    return new Set();
  }
}

export function isBackupConfirmed(address: string): boolean {
  return confirmedSet().has(address.toLowerCase());
}

export function markBackupConfirmed(address: string): void {
  const s = confirmedSet();
  s.add(address.toLowerCase());
  localStorage.setItem(BACKUP_KEY, JSON.stringify([...s]));
}

/**
 * Parse raw text or a File as a KeystoreFile.
 * Throws with a human-readable message on invalid input.
 */
export async function parseKeystoreFile(input: File | string): Promise<KeystoreFile> {
  const text = typeof input === "string" ? input : await input.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  const ks = parsed as Partial<KeystoreFile>;
  if (ks.version !== 1 || !ks.address || !ks.crypto?.ciphertext) {
    throw new Error("Not a valid Emberchain keystore file (version 1).");
  }
  return ks as KeystoreFile;
}
