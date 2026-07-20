/**
 * Deploy EmberBridge.sol to the EMBR chain (chain ID 7773).
 *
 * This is a separate script because EmberBridge lives on the EMBR chain,
 * not on Base. Run this against the EMBR chain RPC.
 *
 * Usage:
 *   pnpm hardhat run scripts/deploy-embr-chain.ts --network embr
 *
 * Required env vars:
 *   DEPLOYER_PRIVATE_KEY   — must have EMBR balance for gas
 *   EMBR_RPC               — EMBR chain RPC (e.g. http://localhost:3001 in dev)
 *   RELAYER_ADDRESS        — same relayer wallet used for Base side
 *
 * Appends the EmberBridge address to deployed-addresses.json if it exists.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log("Deployer:", deployer.address);
  console.log("Network chainId:", network.chainId.toString());

  const relayerAddress = process.env.RELAYER_ADDRESS;
  if (!relayerAddress) throw new Error("RELAYER_ADDRESS not set");

  console.log("\nDeploying EmberBridge (EMBR chain side)...");
  const Factory = await ethers.getContractFactory("EmberBridge");
  const emberBridge = await Factory.deploy(relayerAddress);
  await emberBridge.waitForDeployment();
  const addr = await emberBridge.getAddress();
  console.log("  EmberBridge deployed:", addr);

  // Append to deployed-addresses.json if it exists
  const addressFile = path.join(__dirname, "..", "deployed-addresses.json");
  if (fs.existsSync(addressFile)) {
    const existing = JSON.parse(fs.readFileSync(addressFile, "utf8"));
    existing.contracts.EmberBridge = addr;
    existing.embrChainId = 7773;
    fs.writeFileSync(addressFile, JSON.stringify(existing, null, 2));
    console.log("  Updated deployed-addresses.json with EmberBridge address.");
  } else {
    fs.writeFileSync(
      path.join(__dirname, "..", "deployed-addresses.embr.json"),
      JSON.stringify({ EmberBridge: addr, chainId: 7773, relayer: relayerAddress }, null, 2)
    );
  }

  console.log("\n✅ EmberBridge deployed to EMBR chain.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
