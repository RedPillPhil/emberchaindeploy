/**
 * Deploy EmberSwap contracts to Base Mainnet.
 *
 * Usage:
 *   pnpm deploy:mainnet
 *
 * Required env vars (in .env):
 *   DEPLOYER_PRIVATE_KEY            — wallet that pays gas and becomes owner
 *   BASE_MAINNET_RPC                — RPC endpoint
 *   RELAYER_ADDRESS                 — address of the bridge relayer wallet
 *   UNISWAP_V2_ROUTER_BASE_MAINNET  — Uniswap V2 Router02 on Base mainnet
 *                                     (0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24 on Base)
 *
 * ⚠️  Review all addresses carefully before running against mainnet.
 *     This script is intentionally identical in structure to deploy-testnet.ts
 *     so the deployment process is reproducible.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, "chainId:", network.chainId.toString());

  if (network.chainId !== 8453n) {
    throw new Error(`Expected Base mainnet (8453), got ${network.chainId}`);
  }

  const relayerAddress = process.env.RELAYER_ADDRESS;
  const uniswapRouter = process.env.UNISWAP_V2_ROUTER_BASE_MAINNET;

  if (!relayerAddress) throw new Error("RELAYER_ADDRESS not set");
  if (!uniswapRouter) throw new Error("UNISWAP_V2_ROUTER_BASE_MAINNET not set");

  // ── 1. WrappedEMBR ────────────────────────────────────────────────────────
  console.log("\n[1/4] Deploying WrappedEMBR...");
  const WEMBRFactory = await ethers.getContractFactory("WrappedEMBR");
  const wEMBR = await WEMBRFactory.deploy(deployer.address);
  await wEMBR.waitForDeployment();
  const wEMBRAddr = await wEMBR.getAddress();
  console.log("  WrappedEMBR:", wEMBRAddr);

  // ── 2. EmberchainBridge ───────────────────────────────────────────────────
  console.log("\n[2/4] Deploying EmberchainBridge...");
  const BridgeFactory = await ethers.getContractFactory("EmberchainBridge");
  const bridge = await BridgeFactory.deploy(wEMBRAddr, relayerAddress);
  await bridge.waitForDeployment();
  const bridgeAddr = await bridge.getAddress();
  console.log("  EmberchainBridge:", bridgeAddr);

  // ── 3. Wire ───────────────────────────────────────────────────────────────
  console.log("\n[3/4] Wiring wEMBR.setBridge...");
  await (await wEMBR.setBridge(bridgeAddr)).wait();
  console.log("  Done.");

  // ── 4. EmberSwap ──────────────────────────────────────────────────────────
  console.log("\n[4/4] Deploying EmberSwap...");
  const EmberSwapFactory = await ethers.getContractFactory("EmberSwap");
  const emberSwap = await EmberSwapFactory.deploy(uniswapRouter, wEMBRAddr);
  await emberSwap.waitForDeployment();
  const emberSwapAddr = await emberSwap.getAddress();
  console.log("  EmberSwap:", emberSwapAddr);

  // ── Write addresses ───────────────────────────────────────────────────────
  const addresses = {
    network: "base-mainnet",
    chainId: 8453,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    relayer: relayerAddress,
    contracts: {
      WrappedEMBR: wEMBRAddr,
      EmberchainBridge: bridgeAddr,
      EmberSwap: emberSwapAddr,
    },
  };

  const outPath = path.join(__dirname, "..", "deployed-addresses.mainnet.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log("\n✅ Mainnet deployment complete.");
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
