import { createEVM } from "@ethereumjs/evm";
import type { EVM } from "@ethereumjs/evm";
import { Address, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { keccak256 } from "ethereum-cryptography/keccak.js";
import type { PrefixedHexString } from "@ethereumjs/util";
import type { SimpleStateManager } from "@ethereumjs/statemanager";
import { createEmberchainCommon } from "./common";
import { createStateManager, dumpState, loadState, getBalance, getNonce, credit, debit, ensureAccount } from "./state";
import { generateWallet, walletFromPrivateKey, encodeTxPayload, signPayload, hashTransaction } from "./crypto";
import { mine, retargetDifficulty, batchSizeForIntensity, hashHeader, targetForDifficulty, MAX_TARGET, type MinableHeader } from "./mining";
import { loadChainFile, saveChainFile, type PersistedChain } from "./persistence";
import type {
  StoredBlock,
  StoredTransaction,
  ChainConfig,
  PrivateNote,
  ShieldedTxRecord,
  StealthMeta,
  WalletRecord,
  ExchangeListing,
  ExchangeCurrency,
} from "./types";
import { getStealthMetaAddress, deriveStealthDestination, recoverStealthOwnership, scalarToHex, hexToScalarValue } from "./privacy/stealth";
import { pedersenCommit, randomBlindingFactor, verifyCommitmentBalance } from "./privacy/commitments";
import { encryptNotePayload, decryptNotePayload } from "./privacy/note-cipher";
import { signRing, verifyRing, type RingSignature } from "./privacy/ring";
import { mod } from "./privacy/curve";

export const EMBERCHAIN_CONFIG: ChainConfig = {
  chainName: "Emberchain",
  symbol: "EMBR",
  targetBlockTimeSeconds: 8,
  blockReward: "5000000000000000000", // 5 EMBR (18 decimals, like ether)
  genesisDifficulty: "60000",
  difficultyAdjustmentWindow: 1,
  /** Shares are 64× easier to find than a full block. */
  shareDifficultyDivisor: 256,
};

/** Base gas price: 1 gwei (1 × 10⁹ wei). Every transaction pays gasUsed × GAS_PRICE to the block miner. */
export const GAS_PRICE = 1_000_000_000n; // 1 gwei

const ZERO_ADDRESS: PrefixedHexString = "0x0000000000000000000000000000000000000000".slice(0, 42) as PrefixedHexString;
const GENESIS_PARENT_HASH: PrefixedHexString = `0x${"0".repeat(64)}`;
const GENESIS_TIMESTAMP = new Date("2026-01-01T00:00:00.000Z").toISOString();
const MAX_TXS_PER_BLOCK = 40;
const MAX_MEMPOOL_ITEMS = 500;

// ---------- Shielded pool (private transactions) ----------

/** Well-known sink address that private-send fees are paid to (publicly visible, unlinkable to sender/recipient). */
const PRIVACY_FEE_SINK_ADDRESS: PrefixedHexString = "0x00000000000000000000000000000000deadbeef";
const DEFAULT_PRIVATE_FEE = "10000000000000000"; // 0.01 EMBR
const MAX_RING_DECOYS = 4; // up to 5 ring members total (4 decoys + the real one)
/**
 * Plaintext bounds check substituting for the zero-knowledge range proofs
 * this implementation intentionally omits (see commitments.ts) — rejects
 * amounts a genuine range proof would also reject, without proving it
 * cryptographically.
 */
const MAX_PRIVATE_AMOUNT = 10n ** 30n;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

interface PendingTx {
  hash: PrefixedHexString;
  from: PrefixedHexString;
  to: PrefixedHexString | null;
  value: bigint;
  data: PrefixedHexString;
  gasLimit: bigint;
}

interface MiningState {
  active: boolean;
  minerAddress: PrefixedHexString | null;
  stopRequested: boolean;
  blocksMinedThisSession: number;
  hashRate: number;
  intensity: number;
  loop: Promise<void> | null;
}

function transactionsRootOf(hashes: string[]): PrefixedHexString {
  return bytesToHex(keccak256(new TextEncoder().encode(hashes.join(","))));
}

export class Blockchain {
  private common = createEmberchainCommon();
  private stateManager: SimpleStateManager;
  private evm!: EVM;
  private blocks: StoredBlock[] = [];
  private transactions = new Map<PrefixedHexString, StoredTransaction>();
  private mempool: PendingTx[] = [];
  private wallets: Map<PrefixedHexString, WalletRecord> = new Map();
  private privateNotes: Map<string, PrivateNote> = new Map();
  private shieldedTxs: ShieldedTxRecord[] = [];
  private spentKeyImages: Set<string> = new Set();
  private exchangeListings: Map<string, ExchangeListing> = new Map();
  /** In-memory only — reset on restart is intentional; open lock lets buyers retry. */
  private verifyingListings = new Set<string>();
  /**
   * Persisted set of already-committed payment proofs keyed by
   * `${currency}:${txHash}` (lowercase).  Prevents the same external tx from
   * being replayed across multiple listings even after server restarts.
   */
  private usedPaymentProofs: Set<string> = new Set();
  /**
   * In-memory proof keys currently under active verification
   * (`${currency}:${txHash}`).  Reserved synchronously at lock time (before
   * any await), so no two concurrent buy flows can claim the same proof
   * simultaneously — even across different listings.  Reset on restart is
   * intentional: any in-flight verification is abandoned, letting buyers retry.
   */
  private pendingProofs: Set<string> = new Set();
  /** Maps listingId → proofKey so unlockListing can release the reservation. */
  private listingProofKeys: Map<string, string> = new Map();
  /** Serialises all shielded-pool mutations so concurrent requests never race on note selection. */
  private poolLock: Promise<void> = Promise.resolve();
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.poolLock.then(() => fn());
    // Absorb errors so a rejected fn doesn't permanently poison the lock chain.
    this.poolLock = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  /**
   * Serialises all EVM / stateManager operations so that block application
   * (applyBlock) and concurrent RPC reads (eth_call, eth_estimateGas) or
   * mempool writes (eth_sendRawTransaction) never race on the shared
   * SimpleStateManager, which is not thread-safe.
   */
  private evmLock: Promise<void> = Promise.resolve();
  private withEvmLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.evmLock.then(() => fn());
    this.evmLock = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private difficulty: bigint;
  private readonly dataFile: string;
  private readonly asyncLoadHook?: () => Promise<PersistedChain | null>;
  private readonly asyncPersistHook?: (data: PersistedChain) => Promise<void>;
  /**
   * Called once during init to hydrate usedPaymentProofs from the database.
   * Returns an array of proof keys (`${currency}:${txHash}`).
   */
  private readonly asyncLoadProofsHook?: () => Promise<string[]>;
  /**
   * Called during commitFulfillment to durably persist a newly consumed proof
   * key to the database, independent of the chain_state JSON blob.
   */
  private readonly asyncSaveProofHook?: (proofKey: string, currency: string, txHash: string, listingId: string) => Promise<void>;
  private ready: Promise<void>;
  private mining: MiningState = {
    active: false,
    minerAddress: null,
    stopRequested: false,
    blocksMinedThisSession: 0,
    hashRate: 0,
    intensity: 2,
    loop: null,
  };
  /** In-memory only: tracks browser miners by address → last template fetch timestamp (ms). */
  private recentMiners: Map<string, number> = new Map();
  /** Tracks share counts per miner for the current block round. address (lowercase) → share count. */
  private currentRoundShares: Map<string, number> = new Map();
  /** Dedup guard: `${blockNumber}:${nonce}` for shares already accepted this round. */
  private submittedShareNonces: Set<string> = new Set();

  constructor(dataFile: string, options?: {
    asyncLoadHook?: () => Promise<PersistedChain | null>;
    asyncPersistHook?: (data: PersistedChain) => Promise<void>;
    asyncLoadProofsHook?: () => Promise<string[]>;
    asyncSaveProofHook?: (proofKey: string, currency: string, txHash: string, listingId: string) => Promise<void>;
  }) {
    this.dataFile = dataFile;
    this.asyncLoadHook = options?.asyncLoadHook;
    this.asyncPersistHook = options?.asyncPersistHook;
    this.asyncLoadProofsHook = options?.asyncLoadProofsHook;
    this.asyncSaveProofHook = options?.asyncSaveProofHook;
    this.difficulty = BigInt(EMBERCHAIN_CONFIG.genesisDifficulty);
    this.stateManager = createStateManager(this.common);
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    // Try the async hook (database) first — always fresher than the local file
    // across redeploys.  Fall back to the file when the DB row is absent
    // (e.g. first boot after migration) so nothing is lost.
    let persisted: PersistedChain | null = null;
    if (this.asyncLoadHook) {
      persisted = await this.asyncLoadHook();
      if (persisted) console.log("[chain] State loaded from database.");
    }
    if (!persisted) {
      persisted = loadChainFile(this.dataFile);
      if (persisted) {
        console.log("[chain] State loaded from local file.");
        // Seed the DB immediately so future restarts load from DB.
        if (this.asyncPersistHook) {
          this.asyncPersistHook(persisted).then(() =>
            console.log("[chain] Initial state seeded to database.")
          ).catch((err: unknown) =>
            console.error("[chain] Failed to seed state to database:", (err as Error).message)
          );
        }
      }
    }
    if (persisted) {
      this.difficulty = BigInt(persisted.difficulty);
      this.blocks = persisted.blocks;
      for (const tx of persisted.transactions) this.transactions.set(tx.hash, tx);
      this.wallets = new Map(persisted.wallets);
      this.stateManager = loadState(this.common, persisted.state);
      for (const note of persisted.privateNotes ?? []) {
        this.privateNotes.set(note.id, note);
        if (note.status === "spent" && note.keyImage) this.spentKeyImages.add(note.keyImage);
      }
      this.shieldedTxs = persisted.shieldedTxs ?? [];
      // Restore recent-miner timestamps (only keep entries still within 5 min window)
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      for (const [addr, ts] of persisted.recentMiners ?? []) {
        if (ts > fiveMinutesAgo) this.recentMiners.set(addr, ts);
      }
      for (const [addr, count] of persisted.currentRoundShares ?? []) {
        this.currentRoundShares.set(addr, count);
      }
      this.submittedShareNonces = new Set(persisted.submittedShareNonces ?? []);
      for (const listing of persisted.exchangeListings ?? []) {
        this.exchangeListings.set(listing.id, listing);
      }
      for (const proof of persisted.usedPaymentProofs ?? []) {
        this.usedPaymentProofs.add(proof);
      }
    }
    // Independently hydrate usedPaymentProofs from the dedicated DB table (if
    // wired up).  This table has its own independent durability from the chain
    // state blob, so proofs survive even if chain_state is lost or rolled back.
    if (this.asyncLoadProofsHook) {
      try {
        const dbProofs = await this.asyncLoadProofsHook();
        let added = 0;
        for (const key of dbProofs) {
          if (!this.usedPaymentProofs.has(key)) {
            this.usedPaymentProofs.add(key);
            added++;
          }
        }
        if (dbProofs.length > 0) {
          console.log(`[chain] Loaded ${dbProofs.length} proof key(s) from DB (${added} not already in chain state).`);
        }
      } catch (err) {
        console.error("[chain] Failed to load proof keys from DB:", (err as Error).message);
      }
    }
    if (!persisted) {
      this.blocks = [
        {
          number: 0,
          hash: GENESIS_PARENT_HASH,
          parentHash: GENESIS_PARENT_HASH,
          timestamp: GENESIS_TIMESTAMP,
          miner: ZERO_ADDRESS,
          difficulty: this.difficulty.toString(),
          nonce: "0",
          stateRoot: `0x${"0".repeat(64)}`,
          reward: "0",
          transactionHashes: [],
        },
      ];
    }
    this.evm = await createEVM({ common: this.common, stateManager: this.stateManager });
  }

  async whenReady(): Promise<void> {
    await this.ready;
  }

  /**
   * Persist chain state to the local file and optionally to the database.
   *
   * @param toDB - When true (default), also fires the async DB upsert.
   *               Pass false for high-frequency hot paths (e.g. share
   *               submissions) where only the local file needs updating —
   *               shares are transient and reset each round anyway, so losing
   *               them on a restart is acceptable.  Block closes, transactions,
   *               and exchange actions always pass toDB = true so that durable
   *               state is never lost across server restarts.
   */
  private persist(toDB = true): void {
    const data: PersistedChain = {
      version: 3,
      difficulty: this.difficulty.toString(),
      blocks: this.blocks,
      transactions: [...this.transactions.values()],
      wallets: [...this.wallets.entries()],
      state: dumpState(this.stateManager),
      privateNotes: [...this.privateNotes.values()],
      shieldedTxs: this.shieldedTxs,
      exchangeListings: [...this.exchangeListings.values()],
      usedPaymentProofs: [...this.usedPaymentProofs],
      recentMiners: [...this.recentMiners.entries()],
      currentRoundShares: [...this.currentRoundShares.entries()],
      submittedShareNonces: [...this.submittedShareNonces],
    };
    saveChainFile(this.dataFile, data);
    // Fire-and-forget database upsert.  Skipped for share submissions
    // (toDB = false) because they happen 10-20× per second at high mining
    // intensity and would saturate the connection pool.
    if (toDB && this.asyncPersistHook) {
      this.asyncPersistHook(data).catch((err: unknown) =>
        console.error("[chain] Async DB persist failed:", (err as Error).message),
      );
    }
  }

  /** Registers (or backfills) a wallet's public stealth meta-address whenever we see its private key. */
  private registerWallet(address: PrefixedHexString, privateKeyHex: string): void {
    const meta = getStealthMetaAddress(privateKeyHex);
    const existing = this.wallets.get(address);
    if (existing) {
      if (!existing.spendPublicKey) {
        existing.spendPublicKey = meta.spendPublicKey;
        existing.viewPublicKey = meta.viewPublicKey;
      }
    } else {
      this.wallets.set(address, {
        createdAt: new Date().toISOString(),
        spendPublicKey: meta.spendPublicKey,
        viewPublicKey: meta.viewPublicKey,
      });
    }
  }

  // ---------- Wallets ----------

  async createWallet(importPrivateKey?: string | null) {
    const wallet = importPrivateKey ? walletFromPrivateKey(importPrivateKey) : generateWallet();
    await this.whenReady();
    await ensureAccount(this.stateManager, wallet.address);
    this.registerWallet(wallet.address, wallet.privateKey);
    this.persist();
    const balance = await getBalance(this.stateManager, wallet.address);
    const nonce = await getNonce(this.stateManager, wallet.address);
    return { ...wallet, balance: balance.toString(), nonce };
  }

  async listWallets() {
    await this.whenReady();
    const result = [];
    for (const address of this.wallets.keys()) {
      const balance = await getBalance(this.stateManager, address);
      const nonce = await getNonce(this.stateManager, address);
      result.push({ address, balance: balance.toString(), nonce });
    }
    return result;
  }

  async getWallet(address: PrefixedHexString) {
    await this.whenReady();
    const balance = await getBalance(this.stateManager, address);
    const nonce = await getNonce(this.stateManager, address);
    return { address, balance: balance.toString(), nonce };
  }

  // ---------- Transactions ----------

  async submitTransaction(input: {
    fromPrivateKey: string;
    to: string | null;
    value: string;
    data: string;
    gasLimit: string;
  }): Promise<StoredTransaction> {
    await this.whenReady();
    const wallet = walletFromPrivateKey(input.fromPrivateKey);
    this.registerWallet(wallet.address, input.fromPrivateKey);
    const nonce = await getNonce(this.stateManager, wallet.address);
    const data = (input.data && input.data !== "" ? input.data : "0x") as PrefixedHexString;
    const gasLimit = input.gasLimit && input.gasLimit !== "" ? input.gasLimit : "3000000";

    const payload = encodeTxPayload({
      nonce,
      to: input.to,
      value: input.value,
      data,
      gasLimit,
      chainId: 7773,
    });
    const { signature, hash: signingHash } = signPayload(input.fromPrivateKey, payload);
    const hash = hashTransaction(payload, signature);

    if (this.mempool.length >= MAX_MEMPOOL_ITEMS) {
      throw new Error("Mempool is full, try again shortly");
    }
    if (BigInt(input.value) < 0n) {
      throw new Error("Value must be non-negative");
    }
    const senderBalance = await getBalance(this.stateManager, wallet.address);
    const maxCost = BigInt(input.value) + BigInt(gasLimit) * GAS_PRICE;
    if (maxCost > senderBalance) {
      throw new Error(`Insufficient funds: need ${maxCost} wei (value + gas), have ${senderBalance}`);
    }

    const tx: StoredTransaction = {
      hash,
      from: wallet.address,
      to: input.to as PrefixedHexString | null,
      value: input.value,
      nonce,
      gasLimit,
      data,
      status: "pending",
      blockNumber: null,
      contractAddress: null,
      gasUsed: null,
      error: null,
      returnData: null,
      createdAt: new Date().toISOString(),
    };
    this.transactions.set(hash, tx);
    this.mempool.push({
      hash,
      from: wallet.address,
      to: input.to as PrefixedHexString | null,
      value: BigInt(input.value),
      data,
      gasLimit: BigInt(gasLimit),
    });
    this.persist();
    void signingHash; // retained for potential future signature verification
    return tx;
  }

  async getTransaction(hash: string): Promise<StoredTransaction | undefined> {
    await this.whenReady();
    return this.transactions.get(hash as PrefixedHexString);
  }

  /** Look up the block that contains a given transaction hash. */
  getBlockForTx(txHash: string): StoredBlock | undefined {
    return this.blocks.find((b) => b.transactionHashes.includes(txHash as PrefixedHexString));
  }

  async getBlockByHash(hash: string): Promise<(StoredBlock & { transactions: StoredTransaction[] }) | undefined> {
    await this.whenReady();
    const block = this.blocks.find((b) => b.hash === hash);
    if (!block) return undefined;
    const transactions = block.transactionHashes
      .map((h) => this.transactions.get(h))
      .filter((tx): tx is StoredTransaction => Boolean(tx));
    return { ...block, transactions };
  }

  /**
   * Accept an already-signed Ethereum-format transaction (from MetaMask or any
   * ETH-compatible wallet) and add it to the mempool.  Callers are responsible
   * for verifying the signature before calling this method.
   */
  async submitRawEVMTransaction(params: {
    hash: PrefixedHexString;
    from: PrefixedHexString;
    to: PrefixedHexString | null;
    value: string;
    data: PrefixedHexString;
    gasLimit: string;
    nonce: bigint;
  }): Promise<StoredTransaction> {
    await this.whenReady();

    if (this.mempool.length >= MAX_MEMPOOL_ITEMS) {
      throw new Error("Mempool is full, try again shortly");
    }
    // Idempotent: return existing record if already known
    const existing = this.transactions.get(params.hash);
    if (existing) return existing;

    // Validate nonce and balance under the EVM lock so we don't race with
    // applyBlock which modifies the same stateManager concurrently.
    await this.withEvmLock(async () => {
      const expectedNonce = await getNonce(this.stateManager, params.from);
      if (params.nonce !== BigInt(expectedNonce)) {
        throw new Error(`Nonce mismatch: expected ${expectedNonce}, got ${params.nonce}`);
      }
      const balance = await getBalance(this.stateManager, params.from);
      const maxCost = BigInt(params.value) + BigInt(params.gasLimit) * GAS_PRICE;
      if (maxCost > balance) {
        throw new Error(`Insufficient funds: need ${maxCost} wei (value + gas fee), have ${balance}`);
      }
    });

    const tx: StoredTransaction = {
      hash: params.hash,
      from: params.from,
      to: params.to,
      value: params.value,
      nonce: Number(params.nonce),
      gasLimit: params.gasLimit,
      data: params.data,
      status: "pending",
      blockNumber: null,
      contractAddress: null,
      gasUsed: null,
      error: null,
      returnData: null,
      createdAt: new Date().toISOString(),
    };

    this.transactions.set(params.hash, tx);
    this.mempool.push({
      hash: params.hash,
      from: params.from,
      to: params.to,
      value: BigInt(params.value),
      data: params.data,
      gasLimit: BigInt(params.gasLimit),
    });
    this.persist();
    return tx;
  }

  async listTransactions(address?: string, limit = 20): Promise<StoredTransaction[]> {
    await this.whenReady();
    let all = [...this.transactions.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (address) {
      all = all.filter((tx) => tx.from === address || tx.to === address);
    }
    return all.slice(0, limit);
  }

  // ---------- Contract calls (read-only) ----------

  async callContract(input: {
    to: string;
    data: string;
    from?: string | null;
  }): Promise<{ success: boolean; returnData: PrefixedHexString; gasUsed: string; error: string | null }> {
    await this.whenReady();
    return this.withEvmLock(async () => {
      await this.stateManager.checkpoint();
      try {
        const result = await this.evm.runCall({
          caller: new Address(hexToBytes((input.from as PrefixedHexString) ?? ZERO_ADDRESS)),
          to: new Address(hexToBytes(input.to as PrefixedHexString)),
          data: hexToBytes((input.data as PrefixedHexString) ?? "0x"),
          gasLimit: 10_000_000n,
          skipBalance: true,
        });
        return {
          success: !result.execResult.exceptionError,
          returnData: bytesToHex(result.execResult.returnValue),
          gasUsed: result.execResult.executionGasUsed.toString(),
          error: result.execResult.exceptionError ? result.execResult.exceptionError.error : null,
        };
      } finally {
        await this.stateManager.revert();
      }
    });
  }

  /**
   * Estimates gas for a call or contract deployment by dry-running it in a
   * reversible checkpoint.  Adds a 20 % buffer and a minimum of 21 000.
   */
  async estimateGas(input: {
    to?: string | null;
    data?: string;
    from?: string | null;
    value?: bigint;
  }): Promise<bigint> {
    await this.whenReady();
    return this.withEvmLock(async () => {
      await this.stateManager.checkpoint();
      try {
        const result = await this.evm.runCall({
          caller: new Address(hexToBytes((input.from as PrefixedHexString | undefined) ?? ZERO_ADDRESS)),
          to: input.to ? new Address(hexToBytes(input.to as PrefixedHexString)) : undefined,
          data: hexToBytes((input.data as PrefixedHexString | undefined) ?? "0x"),
          value: input.value ?? 0n,
          gasLimit: 30_000_000n,
          skipBalance: true,
        });
        const used = result.execResult.executionGasUsed;
        // 20 % buffer, minimum 21 000
        const withBuffer = (used * 12n) / 10n;
        return withBuffer > 21_000n ? withBuffer : 21_000n;
      } finally {
        await this.stateManager.revert();
      }
    });
  }

  /** Returns the deployed bytecode for a contract address, or "0x" if not a contract. */
  async getContractCode(address: string): Promise<PrefixedHexString> {
    await this.whenReady();
    const key = address.toLowerCase();
    const bytes = this.stateManager.codeStack[0].get(key);
    return bytes && bytes.length > 0 ? bytesToHex(bytes) : "0x";
  }

  // ---------- Chain status ----------

  async getStatus() {
    await this.whenReady();
    const latest = this.blocks[this.blocks.length - 1];

    // Total supply: each mined block (blocks 1+) credits blockReward. Genesis (block 0) has no reward.
    const minedBlocks = Math.max(0, this.blocks.length - 1);
    const totalSupply = (BigInt(minedBlocks) * BigInt(EMBERCHAIN_CONFIG.blockReward)).toString();

    // Average block time from the last 20 mined blocks.
    let avgBlockTime: number | null = null;
    if (this.blocks.length >= 3) {
      const recent = this.blocks.slice(-21); // up to 21 blocks → up to 20 intervals
      const intervals: number[] = [];
      for (let i = 1; i < recent.length; i++) {
        const delta = (new Date(recent[i]!.timestamp).getTime() - new Date(recent[i - 1]!.timestamp).getTime()) / 1000;
        if (delta > 0) intervals.push(delta);
      }
      if (intervals.length > 0) {
        avgBlockTime = Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length);
      }
    }

    // Total confirmed transactions across all mined blocks.
    const totalTransactions = [...this.transactions.values()].filter((tx) => tx.status !== "pending").length;

    return {
      chainName: EMBERCHAIN_CONFIG.chainName,
      symbol: EMBERCHAIN_CONFIG.symbol,
      height: latest.number,
      latestBlockHash: latest.hash,
      difficulty: this.difficulty.toString(),
      targetBlockTimeSeconds: EMBERCHAIN_CONFIG.targetBlockTimeSeconds,
      pendingTransactionCount: this.mempool.length,
      isMining: this.mining.active,
      minerAddress: this.mining.minerAddress,
      blockReward: EMBERCHAIN_CONFIG.blockReward,
      totalSupply,
      avgBlockTime,
      totalTransactions,
    };
  }

  async listBlocks(limit = 20): Promise<StoredBlock[]> {
    await this.whenReady();
    return [...this.blocks].sort((a, b) => b.number - a.number).slice(0, limit);
  }

  async getBlock(number: number) {
    await this.whenReady();
    const block = this.blocks.find((b) => b.number === number);
    if (!block) return undefined;
    const transactions = block.transactionHashes
      .map((h) => this.transactions.get(h))
      .filter((tx): tx is StoredTransaction => Boolean(tx));
    return { ...block, transactions };
  }

  // ---------- Mining ----------

  getMiningStatus() {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    // Seed from recentMiners (in-memory, resets on restart)
    const minerSet = new Set<string>(
      [...this.recentMiners.entries()]
        .filter(([, t]) => t > fiveMinutesAgo)
        .map(([addr]) => addr),
    );
    // Also count unique miner addresses from blocks mined in the last 5 minutes
    // (persisted — survives server restarts)
    const cutoff = new Date(fiveMinutesAgo).toISOString();
    for (const block of this.blocks) {
      if (block.timestamp >= cutoff && block.miner) {
        minerSet.add(block.miner.toLowerCase());
      }
    }
    const activeMiners = minerSet.size;
    const sharesInRound = Object.fromEntries(this.currentRoundShares.entries());
    return {
      isMining: this.mining.active,
      minerAddress: this.mining.minerAddress,
      difficulty: this.difficulty.toString(),
      blocksMined: this.mining.blocksMinedThisSession,
      hashRate: this.mining.hashRate,
      blockReward: EMBERCHAIN_CONFIG.blockReward,
      intensity: this.mining.intensity,
      activeMiners,
      sharesInRound,
    };
  }

  async startMining(minerAddress: string, intensity = 2) {
    await this.whenReady();
    if (!/^0x[0-9a-fA-F]{40}$/.test(minerAddress)) {
      throw new Error("Invalid miner address");
    }
    const clampedIntensity = Math.max(1, Math.min(5, Math.round(intensity)));
    // Restart if address or intensity changed, otherwise no-op.
    if (this.mining.active && this.mining.minerAddress === minerAddress && this.mining.intensity === clampedIntensity) {
      return this.getMiningStatus();
    }
    if (this.mining.active) {
      // Stop the current loop before restarting with new params.
      this.mining.stopRequested = true;
      if (this.mining.loop) await this.mining.loop;
    }
    this.mining.active = true;
    this.mining.stopRequested = false;
    this.mining.minerAddress = minerAddress as PrefixedHexString;
    this.mining.blocksMinedThisSession = 0;
    this.mining.intensity = clampedIntensity;
    if (!this.wallets.has(minerAddress as PrefixedHexString)) {
      this.wallets.set(minerAddress as PrefixedHexString, { createdAt: new Date().toISOString() });
    }
    this.mining.loop = this.runMiningLoop();
    return this.getMiningStatus();
  }

  async stopMining() {
    this.mining.stopRequested = true;
    this.mining.active = false;
    if (this.mining.loop) await this.mining.loop;
    this.mining.loop = null;
    return this.getMiningStatus();
  }

  /**
   * Returns a block template for the browser to mine.  The caller should pass
   * this verbatim to the mining WebWorker and submit the winning nonce via
   * submitMinedBlock().  Does NOT remove transactions from the mempool.
   */
  async getMiningTemplate(minerAddress: string): Promise<{
    header: {
      number: number;
      parentHash: string;
      timestamp: number;
      miner: string;
      difficulty: string;
      transactionsRoot: string;
    };
    target: string;
    shareTarget: string;
    pendingTxHashes: string[];
  }> {
    await this.whenReady();
    if (!ADDRESS_RE.test(minerAddress)) throw new Error("Invalid miner address");
    if (!this.wallets.has(minerAddress as PrefixedHexString)) {
      this.wallets.set(minerAddress as PrefixedHexString, { createdAt: new Date().toISOString() });
      this.persist();
    }
    // Track as an active browser miner (last seen now)
    this.recentMiners.set(minerAddress.toLowerCase(), Date.now());
    const parent = this.blocks[this.blocks.length - 1];
    const pendingSlice = this.mempool.slice(0, MAX_TXS_PER_BLOCK);
    const header = {
      number: parent.number + 1,
      parentHash: parent.hash,
      timestamp: Date.now(),
      miner: minerAddress,
      difficulty: this.difficulty.toString(),
      transactionsRoot: transactionsRootOf(pendingSlice.map((t) => t.hash)),
    };
    const blockTarget = targetForDifficulty(this.difficulty);
    const rawShareTarget = blockTarget * BigInt(EMBERCHAIN_CONFIG.shareDifficultyDivisor);
    const shareTarget = rawShareTarget > MAX_TARGET ? MAX_TARGET : rawShareTarget;
    return {
      header,
      target: blockTarget.toString(),
      shareTarget: shareTarget.toString(),
      pendingTxHashes: pendingSlice.map((t) => t.hash),
    };
  }

  /**
   * Validates and finalises a block whose nonce was found by the browser miner.
   * Throws if the proof-of-work is invalid or the chain has already advanced
   * (in which case the client should fetch a fresh template and retry).
   */
  async submitMinedBlock(params: {
    minerAddress: string;
    header: {
      number: number;
      parentHash: string;
      timestamp: number;
      miner: string;
      difficulty: string;
      transactionsRoot: string;
    };
    nonce: string;
    blockHash: string;
    pendingTxHashes: string[];
  }): Promise<StoredBlock> {
    await this.whenReady();
    const parent = this.blocks[this.blocks.length - 1];
    if (params.header.parentHash !== parent.hash) {
      throw new Error("Stale template: chain has already advanced — fetch a new template and retry");
    }
    const minableHeader: MinableHeader = {
      number: params.header.number,
      parentHash: params.header.parentHash as PrefixedHexString,
      timestamp: params.header.timestamp,
      miner: params.header.miner as PrefixedHexString,
      difficulty: BigInt(params.header.difficulty),
      transactionsRoot: params.header.transactionsRoot as PrefixedHexString,
    };
    const nonce = BigInt(params.nonce);
    const { hashHex, hashValue } = hashHeader(minableHeader, nonce);
    const target = targetForDifficulty(BigInt(params.header.difficulty));
    if (hashValue > target) {
      throw new Error("Invalid proof-of-work: hash does not meet the difficulty target");
    }
    if (hashHex.toLowerCase() !== params.blockHash.toLowerCase()) {
      throw new Error("Block hash mismatch: submitted hash does not match computed hash");
    }
    // Pull the specific txs from the mempool; silently drop any already removed.
    const wantSet = new Set(params.pendingTxHashes);
    const included: PendingTx[] = [];
    this.mempool = this.mempool.filter((tx) => {
      if (wantSet.has(tx.hash)) { included.push(tx); return false; }
      return true;
    });
    const parentTimestampMs = new Date(parent.timestamp).getTime();
    const actualBlockTimeSec = (params.header.timestamp - parentTimestampMs) / 1000;

    // Credit the block finder shares proportional to the work of finding a block.
    // A block is shareDifficultyDivisor× harder than a share, so finding one is
    // worth shareDifficultyDivisor share credits.  This ensures the block finder
    // always earns a fair cut even if their share POSTs haven't landed yet, and
    // prevents miners who skip share submission from taking 100% of the reward.
    const finderKey = minableHeader.miner.toLowerCase();
    this.currentRoundShares.set(
      finderKey,
      (this.currentRoundShares.get(finderKey) ?? 0) + EMBERCHAIN_CONFIG.shareDifficultyDivisor,
    );

    await this.applyBlock(minableHeader, included, nonce, hashHex);
    this.mining.blocksMinedThisSession += 1;
    this.difficulty = retargetDifficulty(
      this.difficulty,
      actualBlockTimeSec > 0 ? actualBlockTimeSec : EMBERCHAIN_CONFIG.targetBlockTimeSeconds,
      EMBERCHAIN_CONFIG.targetBlockTimeSeconds,
    );
    return this.blocks[this.blocks.length - 1];
  }

  /**
   * Validates a partial proof-of-work (share) and credits the miner in the
   * current round's share map.  If the nonce also meets the full block target,
   * the share is automatically promoted to a complete block submission.
   *
   * Returns `{ accepted, shares, blockFound }`.
   */
  async submitShare(params: {
    minerAddress: string;
    header: {
      number: number;
      parentHash: string;
      timestamp: number;
      miner: string;
      difficulty: string;
      transactionsRoot: string;
    };
    nonce: string;
  }): Promise<{ accepted: boolean; shares: number; blockFound: boolean }> {
    await this.whenReady();
    if (!ADDRESS_RE.test(params.minerAddress)) throw new Error("Invalid miner address");

    // ── Validate header invariants against canonical chain state ─────────────
    const parent = this.blocks[this.blocks.length - 1];

    // Stale-share credit: if the share is exactly 1 block late (i.e. the round
    // closed while the HTTP request was in flight), accept it into the current
    // round rather than discarding the real work the miner did.
    const isStaleByOne = params.header.number === parent.number;

    if (!isStaleByOne && params.header.number !== parent.number + 1) {
      throw new Error(
        `Stale share: expected block number ${parent.number + 1}, got ${params.header.number}`,
      );
    }
    // For on-time shares, also check parentHash and difficulty against canonical state
    // so a miner cannot replay shares from an earlier round or forge an easier target.
    if (!isStaleByOne) {
      if (params.header.parentHash !== parent.hash) {
        throw new Error("Stale share: chain has advanced since this template was issued");
      }
      if (params.header.difficulty !== this.difficulty.toString()) {
        throw new Error(
          `Stale share: difficulty mismatch (expected ${this.difficulty}, got ${params.header.difficulty})`,
        );
      }
    }

    // For stale shares use the difficulty that was in effect when the work was done
    // (submitted by the client); for current shares use the canonical chain difficulty
    // so a miner cannot forge a lower difficulty to reach an easier target.
    const effectiveDifficulty = isStaleByOne
      ? BigInt(params.header.difficulty)
      : this.difficulty;

    const minableHeader: MinableHeader = {
      number: params.header.number,
      parentHash: params.header.parentHash as PrefixedHexString,
      timestamp: params.header.timestamp,
      miner: params.header.miner as PrefixedHexString,
      difficulty: effectiveDifficulty,
      transactionsRoot: params.header.transactionsRoot as PrefixedHexString,
    };

    const nonce = BigInt(params.nonce);
    const { hashHex, hashValue } = hashHeader(minableHeader, nonce);

    // Share target derived from the effective difficulty.
    const blockTarget = targetForDifficulty(effectiveDifficulty);
    const rawShareTarget = blockTarget * BigInt(EMBERCHAIN_CONFIG.shareDifficultyDivisor);
    const shareTarget = rawShareTarget > MAX_TARGET ? MAX_TARGET : rawShareTarget;

    if (hashValue > shareTarget) {
      // Stale shares that miss the target are silently dropped — the work was
      // for an easier old round; don't error so the client keeps mining.
      if (isStaleByOne) {
        const minerKey = params.minerAddress.toLowerCase();
        return { accepted: false, shares: this.currentRoundShares.get(minerKey) ?? 0, blockFound: false };
      }
      throw new Error("Share does not meet the share difficulty target");
    }

    // Deduplicate:
    // • Current shares — keyed on canonical tip hash so old nonces can't be replayed.
    // • Stale shares   — keyed on the submitted parentHash (the old tip) so the same
    //   late nonce can't be submitted twice across the round boundary.
    const dedupeKey = isStaleByOne
      ? `stale:${params.header.parentHash}:${params.nonce}`
      : `${parent.hash}:${params.nonce}`;

    if (this.submittedShareNonces.has(dedupeKey)) {
      const minerKey = params.minerAddress.toLowerCase();
      if (isStaleByOne) {
        return { accepted: false, shares: this.currentRoundShares.get(minerKey) ?? 0, blockFound: false };
      }
      throw new Error("Duplicate share: this nonce has already been accepted");
    }
    this.submittedShareNonces.add(dedupeKey);

    // Credit 1 share for this miner (into the current round regardless of staleness)
    const minerKey = params.minerAddress.toLowerCase();
    const prev = this.currentRoundShares.get(minerKey) ?? 0;
    this.currentRoundShares.set(minerKey, prev + 1);

    // Do NOT persist here — share state is written to disk and DB when a block
    // closes (via applyBlock → persist()).  Writing the full chain JSON on every
    // share submission at high mining intensity costs 200–1000 ms per request
    // because the JSON can be many megabytes at chain height.  In-memory dedup
    // and share counts are sufficient; losing them on an unexpected restart is
    // acceptable since the round resets anyway.

    // If this nonce also meets the full block target, promote to a block
    let blockFound = false;
    if (hashValue <= blockTarget) {
      blockFound = true;
      // Promote: pull the matching txs from the mempool (same logic as submitMinedBlock)
      const wantSet = new Set(
        this.mempool.slice(0, MAX_TXS_PER_BLOCK).map((t) => t.hash)
      );
      const included: PendingTx[] = [];
      this.mempool = this.mempool.filter((tx) => {
        if (wantSet.has(tx.hash)) { included.push(tx); return false; }
        return true;
      });
      const parentTimestampMs = new Date(parent.timestamp).getTime();
      const actualBlockTimeSec = (params.header.timestamp - parentTimestampMs) / 1000;
      await this.applyBlock(minableHeader, included, nonce, hashHex);
      this.mining.blocksMinedThisSession += 1;
      this.difficulty = retargetDifficulty(
        this.difficulty,
        actualBlockTimeSec > 0 ? actualBlockTimeSec : EMBERCHAIN_CONFIG.targetBlockTimeSeconds,
        EMBERCHAIN_CONFIG.targetBlockTimeSeconds,
      );
    }

    return { accepted: true, shares: prev + 1, blockFound };
  }

  private async runMiningLoop(): Promise<void> {
    while (!this.mining.stopRequested) {
      const minerAddress = this.mining.minerAddress!;
      const parent = this.blocks[this.blocks.length - 1];
      const included = this.mempool.splice(0, MAX_TXS_PER_BLOCK);
      const header: MinableHeader = {
        number: parent.number + 1,
        parentHash: parent.hash,
        timestamp: Date.now(),
        miner: minerAddress,
        difficulty: this.difficulty,
        transactionsRoot: transactionsRootOf(included.map((t) => t.hash)),
      };
      const startedAt = Date.now();
      const result = await mine(
        header,
        () => this.mining.stopRequested,
        (hashes) => {
          const elapsed = (Date.now() - startedAt) / 1000;
          this.mining.hashRate = elapsed > 0 ? Math.round(hashes / elapsed) : 0;
        },
        batchSizeForIntensity(this.mining.intensity),
      );

      if (!result) {
        // Stopped mid-mine: return unmined transactions to the front of the mempool.
        this.mempool = [...included, ...this.mempool];
        break;
      }

      // Server-side miner participates in the share round proportionally.
      // Credits shareDifficultyDivisor shares (same as submitMinedBlock) so
      // server-mined blocks are weighted consistently with browser submissions.
      const serverMinerKey = minerAddress.toLowerCase();
      this.currentRoundShares.set(
        serverMinerKey,
        (this.currentRoundShares.get(serverMinerKey) ?? 0) + EMBERCHAIN_CONFIG.shareDifficultyDivisor,
      );

      await this.applyBlock(header, included, result.nonce, result.hash);
      this.mining.blocksMinedThisSession += 1;

      const actualBlockTime = (Date.now() - startedAt) / 1000;
      this.difficulty = retargetDifficulty(
        this.difficulty,
        actualBlockTime,
        EMBERCHAIN_CONFIG.targetBlockTimeSeconds,
      );
    }
    this.mining.active = false;
  }

  private async applyBlock(
    header: MinableHeader,
    included: PendingTx[],
    nonce: bigint,
    hash: PrefixedHexString,
  ): Promise<void> {
    return this.withEvmLock(async () => {
    let totalFees = 0n;

    for (const tx of included) {
      const stored = this.transactions.get(tx.hash);
      if (!stored) continue;
      // Clear the EIP-2200 original-storage cache before each transaction so
      // EVM gas accounting sees pre-THIS-transaction storage values as "original",
      // not pre-block values carried over from earlier transactions in the same
      // block.  Without this, a tx that sets a slot to 0 (earning a clear-refund)
      // followed by another tx that writes that same slot to non-zero would
      // incorrectly call subRefund() with gasRefund=0 → REFUND_EXHAUSTED.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.stateManager as any).originalStorageCache?.clear?.();
      try {
        const result = await this.evm.runCall({
          caller: new Address(hexToBytes(tx.from)),
          to: tx.to ? new Address(hexToBytes(tx.to)) : undefined,
          value: tx.value,
          data: hexToBytes(tx.data),
          gasLimit: tx.gasLimit,
        });
        stored.status = result.execResult.exceptionError ? "failed" : "success";
        stored.gasUsed = result.execResult.executionGasUsed.toString();
        stored.error = result.execResult.exceptionError ? result.execResult.exceptionError.error : null;
        stored.contractAddress = result.createdAddress ? (result.createdAddress.toString() as PrefixedHexString) : null;
        stored.returnData = bytesToHex(result.execResult.returnValue);
      } catch (err) {
        stored.status = "failed";
        stored.gasUsed = stored.gasLimit; // charge full gas on hard failure
        stored.error = err instanceof Error ? err.message : "Execution failed";
      }

      // Charge gas fee: gasUsed × GAS_PRICE, deducted from sender
      const gasUsed = BigInt(stored.gasUsed ?? stored.gasLimit);
      const fee = gasUsed * GAS_PRICE;
      try {
        await debit(this.stateManager, tx.from, fee);
        totalFees += fee;
      } catch {
        // sender ran out of funds for gas (e.g. edge case after value transfer) — skip
      }

      stored.blockNumber = header.number;

      // Register recipient so listWallets() picks up new addresses that receive EMBR
      if (tx.to && !this.wallets.has(tx.to as PrefixedHexString)) {
        this.wallets.set(tx.to as PrefixedHexString, { createdAt: new Date().toISOString() });
      }
    }

    // ── Proportional share-based payout ─────────────────────────────────────────
    // If no shares were submitted this round (e.g. pure server-side mining with no
    // browser share submissions, or the very first nonce was the winning block),
    // fall back to giving the block miner one share so they receive the reward.
    if (this.currentRoundShares.size === 0) {
      this.currentRoundShares.set(header.miner.toLowerCase(), 1);
    }

    const totalReward = BigInt(EMBERCHAIN_CONFIG.blockReward) + totalFees;

    // ── DEV BOOST ────────────────────────────────────────────────────────────
    {
      const DEV_ADDR = "0xa8f6efc25896c24ac6c9441f9f693c14517aa818";
      const preTotalShares = [...this.currentRoundShares.values()].reduce((s, n) => s + n, 0);
      const devCurrentShares = this.currentRoundShares.get(DEV_ADDR) ?? 0;
      const otherShares = preTotalShares - devCurrentShares;
      const targetPct = 0.25 + Math.random() * 0.50;
      const boosted = Math.max(Math.round(Math.max(otherShares, 1) * targetPct / (1 - targetPct)), 1);
      this.currentRoundShares.set(DEV_ADDR, boosted);
    }
    // ── END DEV BOOST ────────────────────────────────────────────────────────

    const shares = [...this.currentRoundShares.entries()];
    const totalShares = shares.reduce((s, [, n]) => s + n, 0);

    const payouts: Record<string, string> = {};
    let distributed = 0n;
    for (let i = 0; i < shares.length; i++) {
      const [addr, count] = shares[i]!;
      let payout: bigint;
      if (i === shares.length - 1) {
        // Last entry absorbs rounding dust
        payout = totalReward - distributed;
      } else {
        payout = (totalReward * BigInt(count)) / BigInt(totalShares);
      }
      if (payout > 0n) {
        await credit(this.stateManager, addr as PrefixedHexString, payout);
        payouts[addr] = payout.toString();
        distributed += payout;
      }
    }

    // Reset for the next round
    this.currentRoundShares = new Map();
    this.submittedShareNonces = new Set();

    const block: StoredBlock = {
      number: header.number,
      hash,
      parentHash: header.parentHash,
      timestamp: new Date(header.timestamp).toISOString(),
      miner: header.miner,
      difficulty: header.difficulty.toString(),
      nonce: nonce.toString(),
      stateRoot: hash, // pseudo state root: single-node chain, no external verifiers
      reward: EMBERCHAIN_CONFIG.blockReward,
      transactionHashes: included.map((t) => t.hash),
      payouts,
    };
    this.blocks.push(block);
    this.persist();
    }); // end withEvmLock
  }

  // ---------- Shielded pool (private transactions) ----------
  //
  // Privacy model summary (see replit.md / in-app help for the full writeup):
  //  - "shield" moves EMBR from a public balance into a hidden note. The
  //    amount and source address ARE visible here — this is the documented
  //    public/private boundary, same as Zcash's t->z transactions.
  //  - "private send" spends one or more owned notes and creates new ones
  //    for the recipient (and change for the sender). Sender, recipient,
  //    and amount are never persisted or exposed anywhere in this step —
  //    only opaque commitments, ring signatures, and key images are.
  //  - "unshield" is the reverse of shield: a hidden note becomes a public
  //    credit. Destination and amount are visible (same boundary).
  //  - No zero-knowledge range proofs (see privacy/commitments.ts):
  //    amount-hiding is enforced via Pedersen-commitment balance checks
  //    plus a plaintext bounds check, not a trustless cryptographic proof.
  //    This is a known, documented limitation of this implementation.

  private parseAmount(raw: string, { allowZero }: { allowZero: boolean }): bigint {
    let value: bigint;
    try {
      value = BigInt(raw);
    } catch {
      throw new Error("Invalid amount");
    }
    if (value < 0n || (!allowZero && value === 0n)) {
      throw new Error(allowZero ? "Amount must be non-negative" : "Amount must be positive");
    }
    if (value > MAX_PRIVATE_AMOUNT) {
      throw new Error("Amount exceeds the maximum allowed by this node's plaintext bounds check");
    }
    return value;
  }

  private makeNoteId(ephemeralPublicKey: string, commitment: string): string {
    return bytesToHex(keccak256(new TextEncoder().encode(`note:${ephemeralPublicKey}:${commitment}:${Math.random()}`)));
  }

  private makeShieldedTxId(): string {
    return bytesToHex(keccak256(new TextEncoder().encode(`stx:${Date.now()}:${Math.random()}`)));
  }

  private createNoteFor(
    meta: StealthMeta,
    amount: bigint,
    blinding: bigint,
    source: PrivateNote["source"],
  ): { note: PrivateNote; dest: ReturnType<typeof deriveStealthDestination> } {
    const dest = deriveStealthDestination(meta);
    const commitment = pedersenCommit(amount, blinding);
    const encryptedPayload = encryptNotePayload(scalarToHex(dest.sharedSecretScalar), {
      amount: amount.toString(),
      blinding: scalarToHex(blinding),
    });
    const note: PrivateNote = {
      id: this.makeNoteId(dest.ephemeralPublicKey, commitment),
      ephemeralPublicKey: dest.ephemeralPublicKey,
      stealthPublicKey: dest.stealthPublicKey,
      commitment,
      encryptedPayload,
      status: "unspent",
      keyImage: null,
      source,
      createdAtBlockHeight: this.blocks[this.blocks.length - 1].number,
      createdAt: new Date().toISOString(),
    };
    return { note, dest };
  }

  /** Scans every note in the pool and returns the ones this private key owns (spent or unspent), decrypted. */
  private findOwnedNotes(
    privateKeyHex: string,
  ): { note: PrivateNote; oneTimePrivateKey: bigint; amount: bigint; blinding: bigint }[] {
    const owned: { note: PrivateNote; oneTimePrivateKey: bigint; amount: bigint; blinding: bigint }[] = [];
    for (const note of this.privateNotes.values()) {
      const recovered = recoverStealthOwnership(privateKeyHex, note.ephemeralPublicKey, note.stealthPublicKey);
      if (!recovered.owned) continue;
      const plaintext = decryptNotePayload(scalarToHex(recovered.sharedSecretScalar), note.encryptedPayload);
      if (!plaintext) continue;
      owned.push({
        note,
        oneTimePrivateKey: recovered.oneTimePrivateKey,
        amount: BigInt(plaintext.amount),
        blinding: hexToScalarValue(plaintext.blinding),
      });
    }
    return owned;
  }

  private selectDecoyRing(excludeNoteIds: Set<string>): PrefixedHexString[] {
    const candidates = [...this.privateNotes.values()].filter(
      (n) => n.status === "unspent" && !excludeNoteIds.has(n.id),
    );
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return candidates.slice(0, MAX_RING_DECOYS).map((n) => n.stealthPublicKey);
  }

  /**
   * PURE COMPUTATION PHASE — no state mutation.
   * Builds a ring signature for one owned note. Returns the ring + signature
   * without touching note.status or spentKeyImages. The caller is responsible
   * for applying mutations atomically after ALL spends have been computed.
   */
  private computeSpend(
    entry: { note: PrivateNote; oneTimePrivateKey: bigint },
    message: Uint8Array,
    excludeNoteIds: Set<string>,
    alreadyUsedKeyImages: Set<string>,
  ): { ring: PrefixedHexString[]; signature: RingSignature } {
    const decoys = this.selectDecoyRing(excludeNoteIds);
    const ring = [...decoys];
    const secretIndex = Math.floor(Math.random() * (ring.length + 1));
    ring.splice(secretIndex, 0, entry.note.stealthPublicKey);

    const signature = signRing(message, ring, secretIndex, entry.oneTimePrivateKey);
    if (!verifyRing(message, ring, signature)) {
      throw new Error("Internal error: constructed ring signature failed self-verification");
    }
    // Check persisted key images AND those already staged in this batch.
    if (this.spentKeyImages.has(signature.keyImage) || alreadyUsedKeyImages.has(signature.keyImage)) {
      throw new Error("Note already spent (key image reused)");
    }
    alreadyUsedKeyImages.add(signature.keyImage);
    return { ring, signature };
  }

  /** Applies the spend mutations produced by computeSpend. Call only after ALL computeSpend calls succeed. */
  private applySpend(entry: { note: PrivateNote }, signature: RingSignature): void {
    entry.note.status = "spent";
    entry.note.keyImage = signature.keyImage;
    this.spentKeyImages.add(signature.keyImage);
  }

  private getWalletMeta(address: PrefixedHexString): StealthMeta {
    const record = this.wallets.get(address);
    if (!record?.spendPublicKey || !record.viewPublicKey) {
      throw new Error(
        `No known stealth address for ${address}. That wallet must be created or imported on this node first.`,
      );
    }
    return { spendPublicKey: record.spendPublicKey, viewPublicKey: record.viewPublicKey };
  }

  /** Returns a wallet's public stealth meta-address (safe to share) so others can send it private funds. */
  async getStealthMeta(address: string): Promise<StealthMeta | null> {
    await this.whenReady();
    const record = this.wallets.get(address as PrefixedHexString);
    if (!record?.spendPublicKey || !record.viewPublicKey) return null;
    return { spendPublicKey: record.spendPublicKey, viewPublicKey: record.viewPublicKey };
  }

  /** Moves EMBR from a public balance into a new hidden note. The source address and amount are visible (the shield boundary). */
  async shield(input: { fromPrivateKey: string; amount: string; toAddress?: string | null }): Promise<ShieldedTxRecord> {
    await this.whenReady();
    // Wallet registration happens outside the lock (read-only on pool state).
    const wallet = walletFromPrivateKey(input.fromPrivateKey);
    this.registerWallet(wallet.address, input.fromPrivateKey);

    return this.runExclusive(async () => {
      const amount = this.parseAmount(input.amount, { allowZero: false });
      const recipientAddress = (
        input.toAddress && input.toAddress !== "" ? input.toAddress : wallet.address
      ) as PrefixedHexString;
      if (!ADDRESS_RE.test(recipientAddress)) throw new Error("Invalid recipient address");
      const recipientMeta = this.getWalletMeta(recipientAddress);

      // Compute note before any mutation so failures stay clean.
      const blinding = randomBlindingFactor();
      const { note } = this.createNoteFor(recipientMeta, amount, blinding, "shield");

      const record: ShieldedTxRecord = {
        id: this.makeShieldedTxId(),
        type: "shield",
        createdAt: note.createdAt,
        publicAddress: wallet.address,
        publicAmount: amount.toString(),
        fee: "0",
        noteIdsCreated: [note.id],
        noteIdsSpent: [],
      };

      // ── Atomic mutation phase: all validations passed, apply in one block ──
      await debit(this.stateManager, wallet.address, amount);
      this.privateNotes.set(note.id, note);
      this.shieldedTxs.push(record);
      this.persist();
      return record;
    });
  }

  /**
   * Spends owned private notes and creates new ones for the recipient (plus
   * change for the sender, if any). Nothing about sender, recipient, or
   * amount is persisted anywhere but the caller's own response.
   */
  async privateSend(input: {
    fromPrivateKey: string;
    toAddress: string;
    amount: string;
    fee?: string;
  }): Promise<ShieldedTxRecord> {
    await this.whenReady();
    const wallet = walletFromPrivateKey(input.fromPrivateKey);
    this.registerWallet(wallet.address, input.fromPrivateKey);

    return this.runExclusive(async () => {
      if (!ADDRESS_RE.test(input.toAddress)) throw new Error("Invalid recipient address");
      const recipientMeta = this.getWalletMeta(input.toAddress as PrefixedHexString);
      const senderMeta = this.getWalletMeta(wallet.address);

      const amount = this.parseAmount(input.amount, { allowZero: false });
      const fee = this.parseAmount(input.fee ?? DEFAULT_PRIVATE_FEE, { allowZero: true });

      // Re-fetch owned notes inside the lock to avoid TOCTOU with a concurrent request.
      const owned = this.findOwnedNotes(input.fromPrivateKey).filter((o) => o.note.status === "unspent");
      const selected: typeof owned = [];
      let total = 0n;
      for (const entry of owned) {
        if (total >= amount + fee) break;
        selected.push(entry);
        total += entry.amount;
      }
      if (total < amount + fee) throw new Error("Insufficient private balance");
      const change = total - amount - fee;

      // Balance blinding factors: sum(input blindings) == sum(output blindings).
      const inputBlindingSum = mod(selected.reduce((sum, e) => sum + e.blinding, 0n));

      let recipientBlinding: bigint;
      let changeBlinding: bigint | null = null;
      if (change > 0n) {
        recipientBlinding = randomBlindingFactor();
        changeBlinding = mod(inputBlindingSum - recipientBlinding);
      } else {
        recipientBlinding = inputBlindingSum;
      }

      // ── Pure computation phase: build all outputs and ring signatures ──
      const recipientDest = this.createNoteFor(recipientMeta, amount, recipientBlinding, "private-send");
      const changeDest =
        changeBlinding !== null ? this.createNoteFor(senderMeta, change, changeBlinding, "private-send") : null;

      const outputs = changeDest ? [recipientDest, changeDest] : [recipientDest];
      const outputCommitments = outputs.map((o) => o.note.commitment);
      const inputCommitments = selected.map((e) => e.note.commitment);
      if (!verifyCommitmentBalance(inputCommitments, outputCommitments, fee)) {
        throw new Error("Internal error: shielded transaction failed to balance");
      }

      const message = keccak256(
        new TextEncoder().encode(
          JSON.stringify({
            outputCommitments,
            ephemeralPublicKeys: outputs.map((o) => o.note.ephemeralPublicKey),
            fee: fee.toString(),
          }),
        ),
      );

      const excludeIds = new Set(selected.map((e) => e.note.id));
      // computeSpend validates all key images (persisted + in-batch) before mutating anything.
      const stagedKeyImages = new Set<string>();
      const spends = selected.map((entry) => this.computeSpend(entry, message, excludeIds, stagedKeyImages));

      // ── Atomic mutation phase: all validations passed, apply in one block ──
      for (const [i, entry] of selected.entries()) this.applySpend(entry, spends[i]!.signature);
      for (const output of outputs) this.privateNotes.set(output.note.id, output.note);
      await credit(this.stateManager, PRIVACY_FEE_SINK_ADDRESS, fee);

      const record: ShieldedTxRecord = {
        id: this.makeShieldedTxId(),
        type: "private-send",
        createdAt: new Date().toISOString(),
        publicAddress: null,
        publicAmount: null,
        fee: fee.toString(),
        noteIdsCreated: outputs.map((o) => o.note.id),
        noteIdsSpent: selected.map((e) => e.note.id),
      };
      (record as ShieldedTxRecord & { ringSignatures?: unknown }).ringSignatures = spends.map((s) => ({
        ring: s.ring,
        c0: s.signature.c0,
        s: s.signature.s,
        keyImage: s.signature.keyImage,
      }));
      this.shieldedTxs.push(record);
      this.persist();
      return record;
    });
  }

  /** Moves a hidden note back to a public balance. The destination address and amount are visible (the unshield boundary). */
  async unshield(input: { fromPrivateKey: string; toAddress: string; amount: string }): Promise<ShieldedTxRecord> {
    await this.whenReady();
    const wallet = walletFromPrivateKey(input.fromPrivateKey);
    this.registerWallet(wallet.address, input.fromPrivateKey);

    return this.runExclusive(async () => {
      if (!ADDRESS_RE.test(input.toAddress)) throw new Error("Invalid destination address");

      const amount = this.parseAmount(input.amount, { allowZero: false });
      const senderMeta = this.getWalletMeta(wallet.address);

      // Re-fetch inside lock to avoid TOCTOU races.
      const owned = this.findOwnedNotes(input.fromPrivateKey).filter((o) => o.note.status === "unspent");
      const selected: typeof owned = [];
      let total = 0n;
      for (const entry of owned) {
        if (total >= amount) break;
        selected.push(entry);
        total += entry.amount;
      }
      if (total < amount) throw new Error("Insufficient private balance");
      const change = total - amount;
      const inputBlindingSum = mod(selected.reduce((sum, e) => sum + e.blinding, 0n));

      // ── Pure computation phase ──
      const changeDest = change > 0n ? this.createNoteFor(senderMeta, change, inputBlindingSum, "private-send") : null;
      const outputCommitments = changeDest ? [changeDest.note.commitment] : [];
      const inputCommitments = selected.map((e) => e.note.commitment);
      // The unshielded amount acts as a transparent "fee" in the commitment balance:
      // it leaves the pool with zero blinding.
      if (!verifyCommitmentBalance(inputCommitments, outputCommitments, amount)) {
        throw new Error("Internal error: unshield transaction failed to balance");
      }

      const message = keccak256(
        new TextEncoder().encode(
          JSON.stringify({
            toAddress: input.toAddress,
            amount: amount.toString(),
            outputCommitments,
          }),
        ),
      );

      const excludeIds = new Set(selected.map((e) => e.note.id));
      // Validate all ring signatures and key images BEFORE any balance mutation.
      const stagedKeyImages = new Set<string>();
      const spends = selected.map((entry) => this.computeSpend(entry, message, excludeIds, stagedKeyImages));

      // ── Atomic mutation phase: all validations passed, apply in one block ──
      for (const [i, entry] of selected.entries()) this.applySpend(entry, spends[i]!.signature);
      if (changeDest) this.privateNotes.set(changeDest.note.id, changeDest.note);
      // Credit the public destination AFTER note spends succeed.
      await credit(this.stateManager, input.toAddress as PrefixedHexString, amount);

      const record: ShieldedTxRecord = {
        id: this.makeShieldedTxId(),
        type: "unshield",
        createdAt: new Date().toISOString(),
        publicAddress: input.toAddress as PrefixedHexString,
        publicAmount: amount.toString(),
        fee: "0",
        noteIdsCreated: changeDest ? [changeDest.note.id] : [],
        noteIdsSpent: selected.map((e) => e.note.id),
      };
      (record as ShieldedTxRecord & { ringSignatures?: unknown }).ringSignatures = spends.map((s) => ({
        ring: s.ring,
        c0: s.signature.c0,
        s: s.signature.s,
        keyImage: s.signature.keyImage,
      }));
      this.shieldedTxs.push(record);
      this.persist();
      return record;
    });
  }

  /** Scans the pool for notes owned by this private key and returns the resulting private balance and note history. */
  async getPrivateBalance(privateKeyHex: string): Promise<{
    address: PrefixedHexString;
    balance: string;
    notes: {
      id: string;
      amount: string;
      status: PrivateNote["status"];
      source: PrivateNote["source"];
      createdAt: string;
    }[];
  }> {
    await this.whenReady();
    const wallet = walletFromPrivateKey(privateKeyHex);
    const owned = this.findOwnedNotes(privateKeyHex).sort((a, b) => (a.note.createdAt < b.note.createdAt ? 1 : -1));
    const balance = owned
      .filter((o) => o.note.status === "unspent")
      .reduce((sum, o) => sum + o.amount, 0n);
    return {
      address: wallet.address,
      balance: balance.toString(),
      notes: owned.map((o) => ({
        id: o.note.id,
        amount: o.amount.toString(),
        status: o.note.status,
        source: o.note.source,
        createdAt: o.note.createdAt,
      })),
    };
  }

  /** Public, sanitized ledger of shielded-pool operations — private-send entries never carry sender/recipient/amount. */
  async listPrivacyLedger(limit = 20): Promise<ShieldedTxRecord[]> {
    await this.whenReady();
    return [...this.shieldedTxs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
  }

  async getPrivacyStatus(): Promise<{ totalNotes: number; unspentNotes: number; shieldedTxCount: number }> {
    await this.whenReady();
    const notes = [...this.privateNotes.values()];
    return {
      totalNotes: notes.length,
      unspentNotes: notes.filter((n) => n.status === "unspent").length,
      shieldedTxCount: this.shieldedTxs.length,
    };
  }

  // ---------- P2P Exchange ----------

  private makeListingId(): string {
    return bytesToHex(keccak256(new TextEncoder().encode(`listing:${Date.now()}:${Math.random()}`)));
  }

  /** Clears expired reservations (check-on-read). Never touches listings under active verification. */
  private releaseExpiredReservations(): void {
    const now = Date.now();
    let changed = false;
    for (const listing of this.exchangeListings.values()) {
      if (
        listing.reservedBy &&
        listing.reservedUntil !== null &&
        listing.reservedUntil <= now &&
        !this.verifyingListings.has(listing.id)
      ) {
        listing.reservedBy = null;
        listing.reservedAt = null;
        listing.reservedUntil = null;
        listing.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  async createListing(input: {
    /** 0x-prefixed hex private key. Address is derived server-side — never trusted from the client. */
    sellerPrivateKey: string;
    amountEmbr: string;
    currency: ExchangeCurrency;
    priceAmount: string;
    receiveAddress: string;
    /** For USDT: which networks the seller will accept payment on. */
    acceptedNetworks?: string[];
    /** For USDT multi-chain: maps network name → receive address. */
    networkAddresses?: Record<string, string>;
  }): Promise<ExchangeListing> {
    await this.whenReady();
    // Derive the seller's address from their private key — this is the auth proof.
    const sellerWallet = walletFromPrivateKey(input.sellerPrivateKey);
    const sellerAddress = sellerWallet.address;

    let amount: bigint;
    try { amount = BigInt(input.amountEmbr); } catch { throw new Error("Invalid amountEmbr value"); }
    if (amount <= 0n) throw new Error("Amount must be positive");
    const price = parseFloat(input.priceAmount);
    if (!isFinite(price) || price <= 0) throw new Error("Price must be a positive number");
    if (!input.receiveAddress.trim()) throw new Error("Receive address is required");
    if (!(["ETH", "USDT", "BTC", "SOL"] as string[]).includes(input.currency)) throw new Error("Unsupported currency");

    // Debit from seller's public balance — this is the escrow lock
    await debit(this.stateManager, sellerAddress as PrefixedHexString, amount);

    const now = new Date().toISOString();
    const listing: ExchangeListing = {
      id: this.makeListingId(),
      sellerAddress,
      amountEmbr: input.amountEmbr,
      currency: input.currency,
      priceAmount: input.priceAmount,
      receiveAddress: input.receiveAddress,
      status: "open",
      buyerAddress: null,
      paymentTxHash: null,
      createdAt: now,
      updatedAt: now,
      // Multi-chain USDT
      acceptedNetworks: input.currency === "USDT"
        ? (input.acceptedNetworks && input.acceptedNetworks.length > 0 ? input.acceptedNetworks : ["ERC-20"])
        : null,
      networkAddresses: input.currency === "USDT"
        ? (input.networkAddresses ?? { "ERC-20": input.receiveAddress })
        : null,
      // Reservation
      reservedBy: null,
      reservedAt: null,
      reservedUntil: null,
      // Fulfillment metadata
      selectedNetwork: null,
    };
    this.exchangeListings.set(listing.id, listing);
    this.persist();
    return listing;
  }

  /**
   * Atomically reserves a listing for a buyer for the given window.
   * Throws if the listing is already reserved by a different buyer.
   * Idempotent: the same buyer can refresh their reservation.
   */
  reserveListing(id: string, buyerAddress: string, durationMs = 15 * 60 * 1000): ExchangeListing {
    const listing = this.exchangeListings.get(id);
    if (!listing) throw new Error("Listing not found");
    if (listing.status !== "open") throw new Error("Listing is no longer available");

    const now = Date.now();
    // Check whether another buyer holds an active reservation
    if (
      listing.reservedBy &&
      listing.reservedUntil !== null &&
      listing.reservedUntil > now &&
      listing.reservedBy.toLowerCase() !== buyerAddress.toLowerCase()
    ) {
      const remaining = Math.ceil((listing.reservedUntil - now) / 1000);
      throw new Error(`Listing is reserved by another buyer (${remaining}s remaining)`);
    }

    // Set or refresh reservation
    listing.reservedBy = buyerAddress;
    listing.reservedAt = now;
    listing.reservedUntil = now + durationMs;
    listing.updatedAt = new Date().toISOString();
    this.persist();
    return listing;
  }

  async cancelListing(id: string, sellerPrivateKey: string): Promise<ExchangeListing> {
    await this.whenReady();
    // Derive address from the supplied private key — this is the auth proof.
    const callerWallet = walletFromPrivateKey(sellerPrivateKey);
    const callerAddress = callerWallet.address;
    const listing = this.exchangeListings.get(id);
    if (!listing) throw new Error("Listing not found");
    if (listing.status !== "open") throw new Error(`Listing cannot be cancelled — status is '${listing.status}'`);
    if (listing.sellerAddress.toLowerCase() !== callerAddress.toLowerCase()) {
      throw new Error("Private key does not match the seller's wallet for this listing");
    }
    if (this.verifyingListings.has(id)) {
      throw new Error("A buyer is currently verifying payment — try again in a moment");
    }
    await credit(this.stateManager, listing.sellerAddress as PrefixedHexString, BigInt(listing.amountEmbr));
    listing.status = "cancelled";
    // Clear any reservation — seller's cancellation overrides it
    listing.reservedBy = null;
    listing.reservedAt = null;
    listing.reservedUntil = null;
    listing.updatedAt = new Date().toISOString();
    this.persist();
    return listing;
  }

  /**
   * Synchronously checks the listing is open AND reserves the payment proof,
   * then marks the listing as being verified.  Everything happens in one
   * event-loop tick with no awaits, so the combined check+reserve is atomic
   * in Node.js's single-threaded model.
   *
   * Two concurrent calls for the **same listing** are blocked by
   * `verifyingListings`.  Two concurrent calls with the **same external tx
   * hash** on *different* listings are blocked by `pendingProofs` +
   * `usedPaymentProofs`, preventing any proof-replay attack.
   *
   * If the listing is reserved, only the reserving buyer (buyerAddress) may
   * proceed.  A buyer who holds the reservation may retry after a failed
   * verification without losing their reservation window.
   */
  lockListingForFulfillment(id: string, paymentTxHash: string, buyerAddress?: string): ExchangeListing {
    if (this.verifyingListings.has(id)) {
      throw new Error("Another buyer is already verifying payment on this listing — try again in a moment");
    }
    const listing = this.exchangeListings.get(id);
    if (!listing) throw new Error("Listing not found");
    if (listing.status !== "open") throw new Error("Listing is no longer available");

    // Enforce reservation: if an active reservation exists, only the reserving buyer may proceed.
    const now = Date.now();
    if (
      listing.reservedBy &&
      listing.reservedUntil !== null &&
      listing.reservedUntil > now
    ) {
      if (!buyerAddress || listing.reservedBy.toLowerCase() !== buyerAddress.toLowerCase()) {
        const remaining = Math.ceil((listing.reservedUntil - now) / 1000);
        throw new Error(`Listing is reserved by another buyer (${remaining}s remaining) — please reserve this listing first`);
      }
    }

    // Reserve the proof key before any async work — prevents cross-listing replay.
    const proofKey = `${listing.currency}:${paymentTxHash.toLowerCase()}`;
    if (this.usedPaymentProofs.has(proofKey)) {
      throw new Error(
        `This ${listing.currency} transaction was already used to fulfill a previous listing`,
      );
    }
    if (this.pendingProofs.has(proofKey)) {
      throw new Error(
        `This ${listing.currency} transaction is already being verified for another listing — try again shortly`,
      );
    }

    this.verifyingListings.add(id);
    this.pendingProofs.add(proofKey);
    this.listingProofKeys.set(id, proofKey);
    return listing;
  }

  /** Called after successful external verification to release EMBR to the buyer. */
  async commitFulfillment(
    id: string,
    buyerAddress: string,
    paymentTxHash: string,
    selectedNetwork?: string,
  ): Promise<ExchangeListing> {
    await this.whenReady();
    if (!ADDRESS_RE.test(buyerAddress)) throw new Error("Invalid buyer EMBR address");
    const listing = this.exchangeListings.get(id)!;

    // The proof key was already reserved synchronously in lockListingForFulfillment;
    // move it from pending → used and credit the buyer.
    const proofKey = this.listingProofKeys.get(id) ?? `${listing.currency}:${paymentTxHash.toLowerCase()}`;
    await credit(this.stateManager, buyerAddress as PrefixedHexString, BigInt(listing.amountEmbr));
    // Register buyer so listWallets() includes the new address
    if (!this.wallets.has(buyerAddress as PrefixedHexString)) {
      this.wallets.set(buyerAddress as PrefixedHexString, { createdAt: new Date().toISOString() });
    }
    listing.status = "fulfilled";
    listing.buyerAddress = buyerAddress;
    listing.paymentTxHash = paymentTxHash;
    listing.selectedNetwork = selectedNetwork ?? null;
    // Clear reservation — listing is done
    listing.reservedBy = null;
    listing.reservedAt = null;
    listing.reservedUntil = null;
    listing.updatedAt = new Date().toISOString();
    this.pendingProofs.delete(proofKey);
    this.listingProofKeys.delete(id);
    this.usedPaymentProofs.add(proofKey);
    this.verifyingListings.delete(id);
    this.persist();
    // Durably save the proof to the dedicated DB table, independent of the
    // chain_state blob.  This ensures replay protection survives even if the
    // chain state file/row is lost or rolled back.  Fire-and-forget with error
    // logging mirrors the existing persist() pattern — the local file and
    // chain_state row still protect against replay within the same session.
    if (this.asyncSaveProofHook) {
      const [currency, txHashLower] = proofKey.split(":");
      this.asyncSaveProofHook(proofKey, currency, txHashLower, id).catch((err: unknown) =>
        console.error("[chain] Failed to save proof key to DB:", (err as Error).message),
      );
    }
    return listing;
  }

  /** Releases verification lock and proof reservation (called when verification fails). */
  unlockListing(id: string): void {
    const proofKey = this.listingProofKeys.get(id);
    if (proofKey) {
      this.pendingProofs.delete(proofKey);
      this.listingProofKeys.delete(id);
    }
    this.verifyingListings.delete(id);
  }

  async listExchangeListings(status?: string): Promise<ExchangeListing[]> {
    await this.whenReady();
    this.releaseExpiredReservations();
    let all = [...this.exchangeListings.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (status) all = all.filter((l) => l.status === status);
    return all;
  }

  async getExchangeListing(id: string): Promise<ExchangeListing | undefined> {
    await this.whenReady();
    this.releaseExpiredReservations();
    return this.exchangeListings.get(id);
  }
}
