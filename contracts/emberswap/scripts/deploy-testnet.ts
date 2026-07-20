/**
 * Deploy EmberSwap contracts to Base Sepolia (testnet).
 *
 * Usage:
 *   pnpm deploy:testnet
 *
 * Required env vars (in .env):
 *   DEPLOYER_PRIVATE_KEY   — wallet that pays gas and becomes owner
 *   BASE_SEPOLIA_RPC       — RPC endpoint (e.g. Alchemy Base Sepolia)
 *   RELAYER_ADDRESS        — address of the bridge relayer wallet
 *   UNISWAP_V2_ROUTER_BASE_SEPOLIA — Uniswap V2 Router02 on Base Sepolia
 *
 * Deployment order:
 *   1. EmberchainBridge (needs a placeholder wEMBR — we deploy wEMBR after)
 *      Actually: deploy wEMBR with deployer as temp bridge, deploy real bridge,
 *      then setBridge on wEMBR.
 *   2. WrappedEMBR
 *   3. EmberchainBridge
 *   4. Wire: wEMBR.setBridge(bridge)
 *   5. EmberBridge (note: this is for the EMBR chain — address exported for reference)
 *   6. EmberSwap
 *
 * Writes deployed-addresses.json with all addresses.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Network:", (await ethers.provider.getNetwork()).name);

  const relayerAddress = process.env.RELAYER_ADDRESS;
  const uniswapRouter = process.env.UNISWAP_V2_ROUTER_BASE_SEPOLIA;

  if (!relayerAddress) throw new Error("RELAYER_ADDRESS not set");
  if (!uniswapRouter) throw new Error("UNISWAP_V2_ROUTER_BASE_SEPOLIA not set");

  // ── 1. WrappedEMBR (temp bridge = deployer) ──────────────────────────────
  console.log("\n[1/4] Deploying WrappedEMBR...");
  const WEMBRFactory = await ethers.getContractFactory("WrappedEMBR");
  const wEMBR = await WEMBRFactory.deploy(deployer.address);
  await wEMBR.waitForDeployment();
  const wEMBRAddr = await wEMBR.getAddress();
  console.log("  WrappedEMBR deployed:", wEMBRAddr);

  // ── 2. EmberchainBridge ───────────────────────────────────────────────────
  console.log("\n[2/4] Deploying EmberchainBridge...");
  const BridgeFactory = await ethers.getContractFactory("EmberchainBridge");
  const bridge = await BridgeFactory.deploy(wEMBRAddr, relayerAddress);
  await bridge.waitForDeployment();
  const bridgeAddr = await bridge.getAddress();
  console.log("  EmberchainBridge deployed:", bridgeAddr);

  // ── 3. Wire: setBridge on wEMBR ───────────────────────────────────────────
  console.log("\n[3/4] Wiring wEMBR bridge address...");
  const setTx = await wEMBR.setBridge(bridgeAddr);
  await setTx.wait();
  console.log("  wEMBR.setBridge →", bridgeAddr);

  // ── 4. EmberSwap ──────────────────────────────────────────────────────────
  console.log("\n[4/4] Deploying EmberSwap...");
  const EmberSwapFactory = await ethers.getContractFactory("EmberSwap");
  const emberSwap = await EmberSwapFactory.deploy(uniswapRouter, wEMBRAddr);
  await emberSwap.waitForDeployment();
  const emberSwapAddr = await emberSwap.getAddress();
  console.log("  EmberSwap deployed:", emberSwapAddr);

  // ── Write addresses ───────────────────────────────────────────────────────
  const addresses = {
    network: "base-sepolia",
    chainId: 84532,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    relayer: relayerAddress,
    contracts: {
      WrappedEMBR: wEMBRAddr,
      EmberchainBridge: bridgeAddr,
      EmberSwap: emberSwapAddr,
    },
    note: "EmberBridge (EMBR chain side) must be deployed separately to chain ID 7773 using deploy-embr-chain.ts",
  };

  const outPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log("\n✅ Deployment complete. Addresses saved to deployed-addresses.json");
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
