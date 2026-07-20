import { SimpleStateManager } from "@ethereumjs/statemanager";
import { Account, Address, bytesToHex, hexToBytes } from "@ethereumjs/util";
import type { Common } from "@ethereumjs/common";
import type { PrefixedHexString } from "@ethereumjs/util";

export interface SerializedAccount {
  nonce: string;
  balance: string;
  storageRoot: PrefixedHexString;
  codeHash: PrefixedHexString;
}

export interface SerializedState {
  accounts: [PrefixedHexString, SerializedAccount][];
  code: [PrefixedHexString, PrefixedHexString][];
  storage: [string, PrefixedHexString][];
}

export function createStateManager(common: Common): SimpleStateManager {
  return new SimpleStateManager({ common });
}

/** Dumps the canonical (checkpoint-depth-0) state layer to a JSON-friendly object. */
export function dumpState(stateManager: SimpleStateManager): SerializedState {
  const accounts: [PrefixedHexString, SerializedAccount][] = [];
  for (const [address, account] of stateManager.accountStack[0]) {
    if (!account) continue;
    accounts.push([
      address,
      {
        nonce: account.nonce.toString(),
        balance: account.balance.toString(),
        storageRoot: bytesToHex(account.storageRoot),
        codeHash: bytesToHex(account.codeHash),
      },
    ]);
  }
  const code: [PrefixedHexString, PrefixedHexString][] = [];
  for (const [address, bytes] of stateManager.codeStack[0]) {
    code.push([address, bytesToHex(bytes)]);
  }
  const storage: [string, PrefixedHexString][] = [];
  for (const [key, bytes] of stateManager.storageStack[0]) {
    storage.push([key, bytesToHex(bytes)]);
  }
  return { accounts, code, storage };
}

/** Rehydrates a fresh state manager from a previously dumped snapshot. */
export function loadState(common: Common, snapshot: SerializedState): SimpleStateManager {
  const stateManager = createStateManager(common);
  for (const [address, account] of snapshot.accounts) {
    stateManager.accountStack[0].set(
      address,
      new Account(
        BigInt(account.nonce),
        BigInt(account.balance),
        hexToBytes(account.storageRoot),
        hexToBytes(account.codeHash),
      ),
    );
  }
  for (const [address, hex] of snapshot.code) {
    stateManager.codeStack[0].set(address, hexToBytes(hex));
  }
  for (const [key, hex] of snapshot.storage) {
    stateManager.storageStack[0].set(key, hexToBytes(hex));
  }
  return stateManager;
}

export async function getBalance(stateManager: SimpleStateManager, address: PrefixedHexString): Promise<bigint> {
  const account = await stateManager.getAccount(new Address(hexToBytes(address)));
  return account?.balance ?? 0n;
}

export async function getNonce(stateManager: SimpleStateManager, address: PrefixedHexString): Promise<number> {
  const account = await stateManager.getAccount(new Address(hexToBytes(address)));
  return account ? Number(account.nonce) : 0;
}

export async function credit(stateManager: SimpleStateManager, address: PrefixedHexString, amount: bigint): Promise<void> {
  const addr = new Address(hexToBytes(address));
  const existing = await stateManager.getAccount(addr);
  if (existing) {
    existing.balance += amount;
    await stateManager.putAccount(addr, existing);
  } else {
    await stateManager.putAccount(addr, new Account(0n, amount));
  }
}

export async function debit(stateManager: SimpleStateManager, address: PrefixedHexString, amount: bigint): Promise<void> {
  const addr = new Address(hexToBytes(address));
  const existing = await stateManager.getAccount(addr);
  const balance = existing?.balance ?? 0n;
  if (balance < amount) {
    throw new Error("Insufficient balance");
  }
  if (existing) {
    existing.balance -= amount;
    await stateManager.putAccount(addr, existing);
  } else {
    throw new Error("Insufficient balance");
  }
}

export async function ensureAccount(stateManager: SimpleStateManager, address: PrefixedHexString): Promise<void> {
  const addr = new Address(hexToBytes(address));
  const existing = await stateManager.getAccount(addr);
  if (!existing) {
    await stateManager.putAccount(addr, new Account());
  }
}
