/**
 * Seed initial wEMBR/ETH liquidity on Uniswap V2 (Base mainnet).
 *
 * Steps:
 *   1. Mint a tiny amount of wEMBR to the deployer via EmberchainBridge.bridgeIn()
 *   2. Approve Uniswap V2 router to spend wEMBR
 *   3. Call router.addLiquidityETH() to create and seed the pair
 *
 * Usage:
 *   node scripts/seed-liquidity.mjs
 */

import { ethers } from "ethers";

const BASE_RPC        = "https://base-rpc.publicnode.com";
const DEPLOYER_PK     = process.env.DEPLOYER_PRIVATE_KEY;
const BRIDGE_ADDR     = "0x1573EdF8F933601e6f37AC9B104cF62C7f85a0F4"; // EmberchainBridge on Base
const WEMBR_ADDR      = "0x9362587019Ea0e4ef90fbd981c615d4441D9D2c4"; // WrappedEMBR on Base
const ROUTER_ADDR     = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24"; // Uniswap V2 Router on Base

if (!DEPLOYER_PK) {
  console.error("DEPLOYER_PRIVATE_KEY not set");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(BASE_RPC);
const wallet   = new ethers.Wallet(DEPLOYER_PK, provider);

const bridgeAbi = [
  "function bridgeIn(address recipient, uint256 amount, uint256 nonce) external",
  "function relayer() external view returns (address)",
];
const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];
const routerAbi = [
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)",
  "function factory() external view returns (address)",
  "function WETH() external view returns (address)",
];

const bridge = new ethers.Contract(BRIDGE_ADDR, bridgeAbi, wallet);
const wembr  = new ethers.Contract(WEMBR_ADDR,  erc20Abi,  wallet);
const router = new ethers.Contract(ROUTER_ADDR, routerAbi, wallet);

async function main() {
  console.log("Deployer:", wallet.address);
  const ethBal = await provider.getBalance(wallet.address);
  console.log("ETH balance:", ethers.formatEther(ethBal), "ETH");

  // ── 0. Check relayer ────────────────────────────────────────────────────────
  const relayer = await bridge.relayer();
  console.log("Bridge relayer:", relayer);
  if (relayer.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error("ERROR: deployer is not the relayer — cannot call bridgeIn");
    process.exit(1);
  }

  // ── 1. Mint wEMBR via bridgeIn ─────────────────────────────────────────────
  // Check existing balance first
  let wembrBal = await wembr.balanceOf(wallet.address);
  console.log("Current wEMBR balance:", ethers.formatEther(wembrBal));

  // We want 1 wEMBR for the pool (sets initial price = 0.0001 ETH/EMBR ≈ $0.35)
  const WEMBR_AMOUNT = ethers.parseEther("1");

  if (wembrBal < WEMBR_AMOUNT) {
    const toMint = WEMBR_AMOUNT - wembrBal;
    const nonce  = BigInt(Date.now());
    console.log(`\nMinting ${ethers.formatEther(toMint)} wEMBR via bridgeIn...`);
    const tx = await bridge.bridgeIn(wallet.address, toMint, nonce, { gasLimit: 200_000 });
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  confirmed ✓");
    wembrBal = await wembr.balanceOf(wallet.address);
    console.log("  new wEMBR balance:", ethers.formatEther(wembrBal));
  } else {
    console.log("Sufficient wEMBR already in wallet — skipping mint");
  }

  // ── 2. Approve router ──────────────────────────────────────────────────────
  const allowance = await wembr.allowance(wallet.address, ROUTER_ADDR);
  if (allowance < WEMBR_AMOUNT) {
    console.log("\nApproving Uniswap V2 router to spend wEMBR...");
    const tx = await wembr.approve(ROUTER_ADDR, ethers.MaxUint256, { gasLimit: 100_000 });
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  approved ✓");
  } else {
    console.log("Router already approved — skipping");
  }

  // ── 3. Add liquidity ───────────────────────────────────────────────────────
  // Router creates the pair automatically on first deposit if needed.
  // Use 0.0001 ETH + 1 wEMBR → initial price = 0.0001 ETH/EMBR
  const ETH_AMOUNT   = ethers.parseEther("0.0001");
  const deadline     = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 min

  console.log(`\nAdding liquidity: ${ethers.formatEther(WEMBR_AMOUNT)} wEMBR + ${ethers.formatEther(ETH_AMOUNT)} ETH...`);
  const tx = await router.addLiquidityETH(
    WEMBR_ADDR,
    WEMBR_AMOUNT,   // amountTokenDesired
    0n,             // amountTokenMin (accept any)
    0n,             // amountETHMin (accept any)
    wallet.address, // LP tokens go to deployer
    deadline,
    { value: ETH_AMOUNT, gasLimit: 500_000 }
  );
  console.log("  tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("  confirmed in block", receipt.blockNumber, "✓");

  // Final state
  const ethFinal   = await provider.getBalance(wallet.address);
  const wembrFinal = await wembr.balanceOf(wallet.address);
  console.log("\n✅ Done!");
  console.log("  ETH remaining:", ethers.formatEther(ethFinal));
  console.log("  wEMBR remaining:", ethers.formatEther(wembrFinal));
}

main().catch((e) => { console.error(e); process.exit(1); });
