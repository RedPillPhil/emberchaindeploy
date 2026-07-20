/**
 * Lightweight ABI calldata decoder — no external dependencies.
 *
 * Decodes static ABI-encoded function calls for known contract functions
 * (bridge contracts + standard ERC-20).  Only handles static types
 * (address, uint256, bool, bytes32); dynamic types (string, bytes, arrays)
 * are flagged as "complex" and left as hex.
 */

export interface DecodedParam {
  name: string;
  type: string;
  value: string;
}

export interface DecodedCall {
  selector: string;
  functionName: string;
  params: DecodedParam[];
}

// ── Known function signatures ───────────────────────────────────────────────
// selector: keccak256(signature).slice(0, 4)

type ParamDef = { name: string; type: "address" | "uint256" | "bool" | "bytes32" };

interface FunctionDef {
  name: string;
  params: ParamDef[];
}

const KNOWN_FUNCTIONS: Record<string, FunctionDef> = {
  // Bridge — EMBR chain
  "0x7ea803f0": {
    name: "lockEMBR",
    params: [
      { name: "baseRecipient", type: "address" },
      { name: "nonce",         type: "uint256" },
    ],
  },
  "0x4b86ca03": {
    name: "releaseEMBR",
    params: [
      { name: "recipient", type: "address" },
      { name: "amount",    type: "uint256" },
      { name: "nonce",     type: "uint256" },
    ],
  },
  // Bridge — Base chain
  "0x80e125a6": {
    name: "bridgeIn",
    params: [
      { name: "recipient", type: "address" },
      { name: "amount",    type: "uint256" },
      { name: "nonce",     type: "uint256" },
    ],
  },
  // ERC-20
  "0xa9059cbb": {
    name: "transfer",
    params: [
      { name: "to",    type: "address" },
      { name: "value", type: "uint256" },
    ],
  },
  "0x23b872dd": {
    name: "transferFrom",
    params: [
      { name: "from",  type: "address" },
      { name: "to",    type: "address" },
      { name: "value", type: "uint256" },
    ],
  },
  "0x095ea7b3": {
    name: "approve",
    params: [
      { name: "spender", type: "address" },
      { name: "value",   type: "uint256" },
    ],
  },
};

// ── ABI decoding helpers ────────────────────────────────────────────────────

/** Decode a 32-byte word at `offset` (byte index into the data after selector) */
function word(hex: string, offset: number): string {
  // hex is the calldata without "0x", starting after the 4-byte selector
  return hex.slice(offset * 2, offset * 2 + 64).padStart(64, "0");
}

function decodeAddress(w: string): string {
  return "0x" + w.slice(24); // last 20 bytes
}

function decodeUint256(w: string): string {
  const n = BigInt("0x" + w);
  return n.toString();
}

function decodeBool(w: string): string {
  return BigInt("0x" + w) !== 0n ? "true" : "false";
}

function decodeBytes32(w: string): string {
  return "0x" + w;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function decodeCalldata(data: string): DecodedCall | null {
  if (!data || data === "0x" || data.length < 10) return null;

  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (hex.length < 8) return null;

  const selector = "0x" + hex.slice(0, 8).toLowerCase();
  const def = KNOWN_FUNCTIONS[selector];
  if (!def) return null;

  const body = hex.slice(8); // everything after the selector
  const expectedWords = def.params.length;

  // Sanity check: body must be at least expectedWords × 32 bytes
  if (body.length < expectedWords * 64) return null;

  const params: DecodedParam[] = def.params.map((p, i) => {
    const w = word(body, i * 32);
    let value: string;
    switch (p.type) {
      case "address": value = decodeAddress(w); break;
      case "uint256": value = decodeUint256(w); break;
      case "bool":    value = decodeBool(w);    break;
      case "bytes32": value = decodeBytes32(w); break;
      default:        value = "0x" + w;
    }
    return { name: p.name, type: p.type, value };
  });

  return { selector, functionName: def.name, params };
}

/** Format a uint256 value for display (if it looks like a wei amount, convert to EMBR) */
export function formatUint256Display(
  value: string,
  paramName: string,
): { display: string; hint?: string } {
  const n = BigInt(value);

  // Nonce-like values (16+ digit, named "nonce") — just show raw
  if (paramName === "nonce") return { display: value };

  // Amount-like values (named amount/value/tokens) — convert from 18-decimal
  if (["amount", "value", "tokens"].includes(paramName)) {
    const whole = n / 10n ** 18n;
    const frac  = n % 10n ** 18n;
    const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
    const display = fracStr
      ? `${whole.toLocaleString()}.${fracStr}`
      : whole.toLocaleString();
    return { display: `${display} EMBR`, hint: value + " wei" };
  }

  return { display: n.toLocaleString() };
}
