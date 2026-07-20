/**
 * Direct ethers.js deployment of EmberBridge to the EMBR production chain.
 * Bypasses Hardhat's eth_estimateGas entirely — uses an explicit gas limit.
 * Polls for the receipt with long intervals suited to high-difficulty chains.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... EMBR_RPC=https://emberchain.org/api/rpc \
 *   RELAYER_ADDRESS=0x... node scripts/deploy-embr-direct.mjs
 */

import { ethers } from "ethers";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RPC_URL      = process.env.EMBR_RPC        ?? "http://localhost:8080/api/rpc";
const PRIVATE_KEY  = process.env.DEPLOYER_PRIVATE_KEY;
const RELAYER_ADDR = process.env.RELAYER_ADDRESS;

if (!PRIVATE_KEY)  { console.error("DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }
if (!RELAYER_ADDR) { console.error("RELAYER_ADDRESS not set");       process.exit(1); }

const artifact = JSON.parse(
  readFileSync(join(__dirname, "../artifacts/contracts/EmberBridge.sol/EmberBridge.json"), "utf8")
);

// Long-timeout provider — production chain may take time to respond
const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
  staticNetwork: true,
  polling: true,
  pollingInterval: 8000,        // check every 8 s (target block time)
  batchMaxCount: 1,             // no batching — keep requests simple
});

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

async function waitForReceipt(hash, timeoutMs = 5 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  console.log(`  Waiting for receipt (up to ${timeoutMs/1000}s)...`);
  while (Date.now() < deadline) {
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (receipt) return receipt;
    } catch { /* ignore transient errors */ }
    await new Promise(r => setTimeout(r, 8000));
    process.stdout.write(".");
  }
  console.log("");
  throw new Error(`Timed out waiting for tx ${hash}`);
}

async function main() {
  const network = await provider.getNetwork();
  const nonce   = await provider.getTransactionCount(wallet.address);
  const balance = await provider.getBalance(wallet.address);

  console.log("Deployer :", wallet.address);
  console.log("Network  : chainId", network.chainId.toString());
  console.log("Nonce    :", nonce);
  console.log("Balance  :", ethers.formatEther(balance), "EMBR");

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  // Explicit gas limit — bypasses eth_estimateGas on the production chain.
  // EmberBridge bytecode is ~2.8 KB; 2 000 000 gas is more than enough.
  const GAS_LIMIT = 2_000_000n;
  const GAS_PRICE = 1_000_000_000n; // 1 gwei (matches EMBR chain config)

  console.log("\nDeploying EmberBridge to EMBR mainnet...");
  const deployTx = await factory.getDeployTransaction(RELAYER_ADDR);
  
  const txRequest = {
    ...deployTx,
    nonce,
    gasLimit: GAS_LIMIT,
    gasPrice: GAS_PRICE,
    chainId: network.chainId,
  };

  const signedTx = await wallet.signTransaction(txRequest);
  const txResponse = await provider.broadcastTransaction(signedTx);
  console.log("  Tx hash:", txResponse.hash);

  const receipt = await waitForReceipt(txResponse.hash);
  console.log("");

  if (receipt.status === 0) {
    throw new Error(`Deployment reverted. Receipt: ${JSON.stringify(receipt)}`);
  }

  const addr = receipt.contractAddress;
  console.log("  EmberBridge deployed:", addr);

  // Update deployed-addresses.json
  const addressFile = join(__dirname, "../deployed-addresses.json");
  if (existsSync(addressFile)) {
    const existing = JSON.parse(readFileSync(addressFile, "utf8"));
    existing.contracts.EmberBridge = addr;
    existing.embrChainId = 7773;
    writeFileSync(addressFile, JSON.stringify(existing, null, 2));
    console.log("  Updated deployed-addresses.json");
  } else {
    writeFileSync(
      join(__dirname, "../deployed-addresses.embr.json"),
      JSON.stringify({ EmberBridge: addr, chainId: 7773, relayer: RELAYER_ADDR }, null, 2)
    );
  }

  console.log("\n✅ EmberBridge deployed to EMBR mainnet:", addr);
  return addr;
}

main().then(addr => {
  console.log("\nNext steps:");
  console.log("  Set EMBER_BRIDGE_ADDRESS =", addr, "in production env vars");
  process.exit(0);
}).catch(err => {
  console.error("\nDeploy failed:", err.message);
  process.exit(1);
});
