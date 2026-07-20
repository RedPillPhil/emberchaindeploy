/**
 * Export ABI JSON files from Hardhat artifacts to contracts/emberswap/abis/
 * Run after `pnpm compile`.
 *
 * Usage:
 *   pnpm export-abis
 */

import * as fs from "fs";
import * as path from "path";

const CONTRACTS = [
  "WrappedEMBR",
  "EmberchainBridge",
  "EmberBridge",
  "EmberSwap",
];

const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts", "contracts");
const ABIS_DIR = path.join(__dirname, "..", "abis");

function findArtifact(contractName: string): string | null {
  const candidates = [
    path.join(ARTIFACTS_DIR, `${contractName}.sol`, `${contractName}.json`),
    path.join(ARTIFACTS_DIR, "mocks", `${contractName}.sol`, `${contractName}.json`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  if (!fs.existsSync(ABIS_DIR)) {
    fs.mkdirSync(ABIS_DIR, { recursive: true });
  }

  for (const name of CONTRACTS) {
    const artifactPath = findArtifact(name);
    if (!artifactPath) {
      console.warn(`⚠️  Artifact not found for ${name} — run 'pnpm compile' first`);
      continue;
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const abiPath = path.join(ABIS_DIR, `${name}.json`);
    fs.writeFileSync(abiPath, JSON.stringify({ abi: artifact.abi, contractName: name }, null, 2));
    console.log(`  ✅ ${name}.json → abis/`);
  }

  console.log("\nDone. ABI files written to contracts/emberswap/abis/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
