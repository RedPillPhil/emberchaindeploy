import { Common, Hardfork, Mainnet, createCustomCommon } from "@ethereumjs/common";

/** Emberchain's chain id — unique to this fork, never used by a real network. */
export const EMBERCHAIN_ID = 7773;

/**
 * Shared EVM parameter set for Emberchain. We borrow Mainnet's opcode/gas
 * tables (via Cancun) purely for EVM execution semantics — Emberchain's own
 * consensus (proof-of-work, block rewards, difficulty retargeting) is
 * implemented independently in `blockchain.ts` and does not depend on this.
 */
export function createEmberchainCommon(): Common {
  return createCustomCommon(
    { chainId: EMBERCHAIN_ID, name: "emberchain" },
    Mainnet,
    { hardfork: Hardfork.Cancun },
  );
}
