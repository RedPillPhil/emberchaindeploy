/**
 * Complete the wEMBR/ETH seed using the already-created pair.
 *
 * Target price: $0.02 / EMBR  @ ETH = $3500
 *   → ratio: 0.0001 ETH : 17.5 wEMBR
 *   → 1 wEMBR already sits in pair from previous run, so mint 16.5 more.
 *
 * Steps:
 *   1. bridgeIn(deployer, 16.5 wEMBR, nonce)   – mint via relayer role
 *   2. wEMBR.transfer(pair, 16.5e18)            – pair now holds 17.5 wEMBR
 *   3. WETH.deposit{value: 0.0001 ETH}()
 *   4. WETH.transfer(pair, 0.0001 ETH)
 *   5. pair.mint(deployer)
 */

import { ethers } from "ethers";

const BASE_RPC      = "https://base-rpc.publicnode.com";
const DEPLOYER_PK   = process.env.DEPLOYER_PRIVATE_KEY;
const BRIDGE_ADDR   = "0x1573EdF8F933601e6f37AC9B104cF62C7f85a0F4"; // EmberchainBridge on Base
const WEMBR_ADDR    = "0x9362587019Ea0e4ef90fbd981c615d4441D9D2c4";
const WETH_ADDR     = "0x4200000000000000000000000000000000000006";
const PAIR_ADDR     = "0xD7e6A5Dfdee7D141A036a5Af8C92Fe7ac20392a6"; // already created

// Amounts for $0.02/EMBR @ $3500/ETH
const WEMBR_IN_PAIR_ALREADY = ethers.parseEther("1");        // already there
const WEMBR_TO_MINT         = ethers.parseEther("16.5");     // mint 16.5 more → 17.5 total
const WETH_AMOUNT           = ethers.parseEther("0.0001");   // = 17.5 × ($0.02/$3500)

if (!DEPLOYER_PK) { console.error("DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }

const provider = new ethers.JsonRpcProvider(BASE_RPC);
const signer   = new ethers.Wallet(DEPLOYER_PK, provider);

const bridgeAbi = ["function bridgeIn(address recipient, uint256 amount, uint256 nonce) external"];
const erc20Abi  = ["function transfer(address to, uint256 amount) external returns (bool)",
                   "function balanceOf(address) external view returns (uint256)"];
const wethAbi   = ["function deposit() external payable",
                   "function transfer(address to, uint256 amount) external returns (bool)"];
const pairAbi   = ["function mint(address to) external returns (uint256 liquidity)",
                   "function getReserves() external view returns (uint112,uint112,uint32)",
                   "function token0() external view returns (address)"];

const bridge = new ethers.Contract(BRIDGE_ADDR, bridgeAbi, signer);
const wembr  = new ethers.Contract(WEMBR_ADDR,  erc20Abi,  signer);
const weth   = new ethers.Contract(WETH_ADDR,   wethAbi,   signer);
const pair   = new ethers.Contract(PAIR_ADDR,   pairAbi,   signer);

async function go(desc, txPromise) {
  const tx = await txPromise;
  console.log(`  [${desc}] tx: ${tx.hash}`);
  const rcpt = await tx.wait();
  if (rcpt.status === 0) throw new Error(`${desc} REVERTED (block ${rcpt.blockNumber})`);
  console.log(`  [${desc}] confirmed block ${rcpt.blockNumber} ✓`);
  return rcpt;
}

async function main() {
  console.log("Signer:", signer.address);
  const ethBal = await provider.getBalance(signer.address);
  console.log("ETH balance:", ethers.formatEther(ethBal));

  // ── 1. Mint 16.5 wEMBR ────────────────────────────────────────────────────
  console.log("\n1. Minting 16.5 wEMBR via bridgeIn...");
  const nonce = BigInt(Date.now());
  await go("bridgeIn", bridge.bridgeIn(signer.address, WEMBR_TO_MINT, nonce, { gasLimit: 200_000 }));
  const wembrBal = await wembr.balanceOf(signer.address);
  console.log("   wEMBR balance:", ethers.formatEther(wembrBal));

  // ── 2. Transfer 16.5 wEMBR to pair (joins the 1 wEMBR already there) ─────
  console.log("\n2. Transferring wEMBR to pair...");
  await go("wEMBR.transfer", wembr.transfer(PAIR_ADDR, WEMBR_TO_MINT, { gasLimit: 100_000 }));

  // ── 3. Wrap 0.0001 ETH → WETH ─────────────────────────────────────────────
  console.log("\n3. Wrapping 0.0001 ETH → WETH...");
  await go("WETH.deposit", weth.deposit({ value: WETH_AMOUNT, gasLimit: 60_000 }));

  // ── 4. Transfer WETH to pair ───────────────────────────────────────────────
  console.log("\n4. Transferring WETH to pair...");
  await go("WETH.transfer", weth.transfer(PAIR_ADDR, WETH_AMOUNT, { gasLimit: 100_000 }));

  // ── 5. Mint LP tokens ─────────────────────────────────────────────────────
  console.log("\n5. Calling pair.mint...");
  await go("pair.mint", pair.mint(signer.address, { gasLimit: 300_000 }));

  // ── Result ─────────────────────────────────────────────────────────────────
  const [r0, r1] = await pair.getReserves();
  const token0   = await pair.token0();
  const wEmbrIsT0 = token0.toLowerCase() === WEMBR_ADDR.toLowerCase();
  const wEmbrR = wEmbrIsT0 ? r0 : r1;
  const wethR  = wEmbrIsT0 ? r1 : r0;
  const priceEth = Number(wethR) / Number(wEmbrR);
  const priceUsd = priceEth * 3500;

  console.log("\n✅ Pool seeded!");
  console.log("  Pair:        ", PAIR_ADDR);
  console.log("  wEMBR reserve:", ethers.formatEther(wEmbrR));
  console.log("  ETH reserve:  ", ethers.formatEther(wethR));
  console.log(`  Price:         ${priceEth.toFixed(8)} ETH/EMBR ≈ $${priceUsd.toFixed(4)}/EMBR`);
}

main().catch((e) => { console.error(e.shortMessage ?? e.message ?? e); process.exit(1); });
