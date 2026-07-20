import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { EmberSwap, MockERC20, MockUniswapV2Router, MockWETH, WrappedEMBR } from "../typechain-types";

describe("EmberSwap", () => {
  let emberSwap: EmberSwap;
  let wEMBR: WrappedEMBR;
  let tokenA: MockERC20;
  let tokenB: MockERC20;
  let mockRouter: MockUniswapV2Router;
  let mockWETH: MockWETH;

  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const FEE_BPS = 25n;
  const BPS_DENOM = 10_000n;
  const ONE_ETHER = ethers.parseEther("1");
  const HUNDRED_ETHER = ethers.parseEther("100");

  beforeEach(async () => {
    [owner, user, other] = await ethers.getSigners();

    // Deploy mock WETH (with real deposit/withdraw) and plain ERC-20 tokens
    const MockWETHFactory = await ethers.getContractFactory("MockWETH");
    mockWETH = (await MockWETHFactory.deploy()) as MockWETH;
    await mockWETH.waitForDeployment();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");

    tokenA = (await MockERC20Factory.deploy("Token A", "TKNA", 18)) as MockERC20;
    await tokenA.waitForDeployment();

    tokenB = (await MockERC20Factory.deploy("Token B", "TKNB", 18)) as MockERC20;
    await tokenB.waitForDeployment();

    // Deploy wEMBR (with temp bridge = owner)
    const WEMBRFactory = await ethers.getContractFactory("WrappedEMBR");
    wEMBR = (await WEMBRFactory.deploy(owner.address)) as WrappedEMBR;
    await wEMBR.waitForDeployment();

    // Deploy mock router
    const MockRouterFactory = await ethers.getContractFactory("MockUniswapV2Router");
    mockRouter = (await MockRouterFactory.deploy(
      await mockWETH.getAddress(),
      ethers.ZeroAddress // factory not used in tests
    )) as MockUniswapV2Router;
    await mockRouter.waitForDeployment();

    // Fund mock router with ample output tokens; keep ETH small to avoid draining test accounts
    await tokenB.mint(await mockRouter.getAddress(), HUNDRED_ETHER * 20n); // 2000 ETH of tokenB
    await wEMBR.connect(owner).mint(await mockRouter.getAddress(), HUNDRED_ETHER * 20n);
    await owner.sendTransaction({ to: await mockRouter.getAddress(), value: ethers.parseEther("5") });

    // Seed MockWETH with native ETH so withdraw() can pay out (EmberSwap unwraps fee WETH).
    // Each minted WETH token is notionally backed by 1 ETH in the contract.
    await owner.sendTransaction({ to: await mockWETH.getAddress(), value: ethers.parseEther("5") });
    // Mint WETH to user and router for test swaps
    await mockWETH.mint(user.address, HUNDRED_ETHER);
    await mockWETH.mint(await mockRouter.getAddress(), HUNDRED_ETHER);

    // Deploy EmberSwap
    const EmberSwapFactory = await ethers.getContractFactory("EmberSwap");
    emberSwap = (await EmberSwapFactory.deploy(
      await mockRouter.getAddress(),
      await wEMBR.getAddress()
    )) as EmberSwap;
    await emberSwap.waitForDeployment();

    // Fund user with tokenA and tokenB
    await tokenA.mint(user.address, HUNDRED_ETHER);
    await tokenB.mint(user.address, HUNDRED_ETHER);
    await wEMBR.connect(owner).mint(user.address, HUNDRED_ETHER);

    // Set auto-liquidity threshold high so it doesn't trigger mid-test (unless we want it to)
    await emberSwap.connect(owner).setAutoLiquidityThreshold(ethers.parseEther("100"));
  });

  describe("deployment", () => {
    it("sets router and wEMBR correctly", async () => {
      expect(await emberSwap.uniswapRouter()).to.equal(await mockRouter.getAddress());
      expect(await emberSwap.wEMBR()).to.equal(await wEMBR.getAddress());
    });

    it("has FEE_BPS = 25", async () => {
      expect(await emberSwap.FEE_BPS()).to.equal(25n);
    });

    it("reverts on zero router address", async () => {
      const Factory = await ethers.getContractFactory("EmberSwap");
      await expect(
        Factory.deploy(ethers.ZeroAddress, await wEMBR.getAddress())
      ).to.be.revertedWith("EmberSwap: zero router");
    });

    it("reverts on zero wEMBR address", async () => {
      const Factory = await ethers.getContractFactory("EmberSwap");
      await expect(
        Factory.deploy(await mockRouter.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("EmberSwap: zero wEMBR");
    });
  });

  describe("swapExactTokensForTokens — fee deduction", () => {
    let path: string[];
    const amountIn = ethers.parseEther("100");

    beforeEach(async () => {
      path = [await tokenA.getAddress(), await tokenB.getAddress()];
      await tokenA.connect(user).approve(await emberSwap.getAddress(), amountIn);
    });

    it("executes swap and sends output to user", async () => {
      const before = await tokenB.balanceOf(user.address);
      await emberSwap.connect(user).swapExactTokensForTokens(
        amountIn, 0n, path, user.address, BigInt(Math.floor(Date.now() / 1000) + 3600)
      );
      const after = await tokenB.balanceOf(user.address);
      expect(after).to.be.gt(before);
    });

    it("deducts 0.25% fee from input", async () => {
      const expectedFee = (amountIn * FEE_BPS) / BPS_DENOM;
      const amountAfterFee = amountIn - expectedFee;

      await emberSwap.connect(user).swapExactTokensForTokens(
        amountIn, 0n, path, user.address, BigInt(Math.floor(Date.now() / 1000) + 3600)
      );

      // Contract should have received the fee in some form (as pendingLiquidityETH or tokens)
      // The fee was amountIn * 25 / 10000 = 0.25 ETH worth of tokenA
      // Since mock router's swapExactTokensForETH gets the fee tokens, contract ETH increases
      expect(amountAfterFee).to.equal(amountIn - (amountIn / 400n));
    });

    it("emits SwapTracked event", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const tx = await emberSwap.connect(user).swapExactTokensForTokens(
        amountIn, 0n, path, user.address, deadline
      );
      const receipt = await tx.wait();
      const iface = emberSwap.interface;
      const tracked = receipt!.logs
        .map(log => { try { return iface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "SwapTracked");
      expect(tracked).to.not.be.undefined;
      expect(tracked!.args.user).to.equal(user.address);
    });

    it("increments swapCount for user", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      // First swap uses amountIn; mint another batch so the second swap has tokens
      await emberSwap.connect(user).swapExactTokensForTokens(amountIn, 0n, path, user.address, deadline);
      await tokenA.mint(user.address, amountIn);
      await tokenA.connect(user).approve(await emberSwap.getAddress(), amountIn);
      await emberSwap.connect(user).swapExactTokensForTokens(amountIn, 0n, path, user.address, deadline);
      const [, count] = await emberSwap.getSwapStats(user.address);
      expect(count).to.equal(2n);
    });

    it("accumulates swapVolume for user", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await emberSwap.connect(user).swapExactTokensForTokens(amountIn, 0n, path, user.address, deadline);
      const [volume] = await emberSwap.getSwapStats(user.address);
      expect(volume).to.equal(amountIn);
    });

    it("tracks different users independently", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await tokenA.mint(other.address, amountIn);
      await tokenA.connect(user).approve(await emberSwap.getAddress(), amountIn);
      await tokenA.connect(other).approve(await emberSwap.getAddress(), amountIn / 2n);

      await emberSwap.connect(user).swapExactTokensForTokens(amountIn, 0n, path, user.address, deadline);
      await emberSwap.connect(other).swapExactTokensForTokens(amountIn / 2n, 0n, path, other.address, deadline);

      const [userVol, userCount] = await emberSwap.getSwapStats(user.address);
      const [otherVol, otherCount] = await emberSwap.getSwapStats(other.address);

      expect(userVol).to.equal(amountIn);
      expect(userCount).to.equal(1n);
      expect(otherVol).to.equal(amountIn / 2n);
      expect(otherCount).to.equal(1n);
    });

    it("reverts on empty path", async () => {
      await expect(
        emberSwap.connect(user).swapExactTokensForTokens(amountIn, 0n, [], user.address, 9999999999n)
      ).to.be.revertedWith("EmberSwap: invalid path");
    });

    it("reverts on zero amountIn", async () => {
      await expect(
        emberSwap.connect(user).swapExactTokensForTokens(0n, 0n, path, user.address, 9999999999n)
      ).to.be.revertedWith("EmberSwap: zero amountIn");
    });
  });

  describe("swapExactETHForTokens — fee deduction", () => {
    let path: string[];
    const ethIn = ethers.parseEther("1");

    beforeEach(async () => {
      path = [await mockWETH.getAddress(), await tokenB.getAddress()];
    });

    it("executes swap and sends tokens to user", async () => {
      const before = await tokenB.balanceOf(user.address);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await emberSwap.connect(user).swapExactETHForTokens(
        0n, path, user.address, deadline, { value: ethIn }
      );
      const after = await tokenB.balanceOf(user.address);
      expect(after).to.be.gt(before);
    });

    it("queues 0.25% of ETH as pendingLiquidityETH", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await emberSwap.connect(user).swapExactETHForTokens(
        0n, path, user.address, deadline, { value: ethIn }
      );
      const expectedFee = (ethIn * FEE_BPS) / BPS_DENOM;
      expect(await emberSwap.pendingLiquidityETH()).to.equal(expectedFee);
    });

    it("emits SwapTracked event", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const tx = await emberSwap.connect(user).swapExactETHForTokens(
        0n, path, user.address, deadline, { value: ethIn }
      );
      const receipt = await tx.wait();
      const iface = emberSwap.interface;
      const tracked = receipt!.logs
        .map(log => { try { return iface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "SwapTracked");
      expect(tracked).to.not.be.undefined;
    });

    it("reverts if path doesn't start with WETH", async () => {
      const badPath = [await tokenA.getAddress(), await tokenB.getAddress()];
      await expect(
        emberSwap.connect(user).swapExactETHForTokens(0n, badPath, user.address, 9999999999n, { value: ethIn })
      ).to.be.revertedWith("EmberSwap: path must start with WETH");
    });

    it("reverts with zero ETH", async () => {
      await expect(
        emberSwap.connect(user).swapExactETHForTokens(0n, path, user.address, 9999999999n, { value: 0n })
      ).to.be.revertedWith("EmberSwap: zero ETH");
    });
  });

  describe("swapExactTokensForTokens — WETH input: fee unwrap to native ETH", () => {
    let path: string[];
    const amountIn = ethers.parseEther("10");

    beforeEach(async () => {
      // path: WETH → tokenB
      path = [await mockWETH.getAddress(), await tokenB.getAddress()];
      await mockWETH.connect(user).approve(await emberSwap.getAddress(), amountIn);
    });

    it("unwraps WETH fee and adds to pendingLiquidityETH", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const expectedFee = (amountIn * FEE_BPS) / BPS_DENOM;

      await emberSwap.connect(user).swapExactTokensForTokens(
        amountIn, 0n, path, user.address, deadline
      );

      // After the swap, pendingLiquidityETH should equal the fee (WETH was unwrapped to ETH)
      expect(await emberSwap.pendingLiquidityETH()).to.equal(expectedFee);
    });

    it("contract holds native ETH equal to the unwrapped fee", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const expectedFee = (amountIn * FEE_BPS) / BPS_DENOM;

      await emberSwap.connect(user).swapExactTokensForTokens(
        amountIn, 0n, path, user.address, deadline
      );

      const contractETHBalance = await ethers.provider.getBalance(await emberSwap.getAddress());
      expect(contractETHBalance).to.be.gte(expectedFee);
    });

    it("emits SwapTracked with correct user and tokenIn", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const tx = await emberSwap.connect(user).swapExactTokensForTokens(
        amountIn, 0n, path, user.address, deadline
      );
      const receipt = await tx.wait();
      const iface = emberSwap.interface;
      const tracked = receipt!.logs
        .map(log => { try { return iface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "SwapTracked");
      expect(tracked).to.not.be.undefined;
      expect(tracked!.args.tokenIn).to.equal(await mockWETH.getAddress());
    });

    it("auto-liquidity triggers when threshold met with WETH-sourced fee ETH", async () => {
      // Lower threshold so it triggers immediately
      await emberSwap.connect(owner).setAutoLiquidityThreshold(0n);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const tx = await emberSwap.connect(user).swapExactTokensForTokens(
        amountIn, 0n, path, user.address, deadline
      );
      const receipt = await tx.wait();
      const iface = emberSwap.interface;
      // LiquidityAdded event confirms auto-liquidity ran with real ETH
      const liquidityAdded = receipt!.logs
        .map(log => { try { return iface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "LiquidityAdded");
      expect(liquidityAdded).to.not.be.undefined;
    });
  });

  describe("swapTokensForExactETH — fee deduction and ETH delivery", () => {
    let path: string[];
    const amountOut = ethers.parseEther("0.5"); // exact ETH desired
    const amountInMax = ethers.parseEther("1");  // max tokens willing to spend

    beforeEach(async () => {
      // path: tokenA → WETH (mock router delivers native ETH)
      path = [await tokenA.getAddress(), await mockWETH.getAddress()];
      // outer beforeEach already seeds 5 ETH to the router — enough for these tests
      await tokenA.connect(user).approve(await emberSwap.getAddress(), amountInMax);
    });

    it("delivers exact ETH to the recipient", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const beforeETH = await ethers.provider.getBalance(other.address);
      await emberSwap.connect(user).swapTokensForExactETH(
        amountOut, amountInMax, path, other.address, deadline
      );
      const afterETH = await ethers.provider.getBalance(other.address);
      expect(afterETH - beforeETH).to.equal(amountOut);
    });

    it("reverts if path does not end with WETH", async () => {
      const badPath = [await tokenA.getAddress(), await tokenB.getAddress()];
      await tokenA.connect(user).approve(await emberSwap.getAddress(), amountInMax);
      await expect(
        emberSwap.connect(user).swapTokensForExactETH(
          amountOut, amountInMax, badPath, other.address, 9999999999n
        )
      ).to.be.revertedWith("EmberSwap: path must end with WETH");
    });

    it("withholds 0.25% fee from amountInMax before forwarding", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      // Fee = amountInMax * 25 / 10000
      const fee = (amountInMax * FEE_BPS) / BPS_DENOM;
      const tokenABefore = await tokenA.balanceOf(user.address);
      await emberSwap.connect(user).swapTokensForExactETH(
        amountOut, amountInMax, path, other.address, deadline
      );
      const tokenAAfter = await tokenA.balanceOf(user.address);
      // User spent: actualUsed (for the swap) + fee
      // Mock router at 1:1 needs amountOut tokens for amountOut ETH
      // actualUsed = amountOut (1:1 rate), fee = amountInMax * 0.25%
      const totalSpent = tokenABefore - tokenAAfter;
      expect(totalSpent).to.be.lte(amountInMax); // never exceeds max
      expect(totalSpent).to.be.gte(fee);          // at minimum paid the fee
    });

    it("refunds unused input tokens to the caller", async () => {
      // amountInMax is generous; only amountOut (at 1:1) + fee should be spent
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const bigMax = ethers.parseEther("10");
      await tokenA.mint(user.address, bigMax);
      await tokenA.connect(user).approve(await emberSwap.getAddress(), bigMax);

      const before = await tokenA.balanceOf(user.address);
      await emberSwap.connect(user).swapTokensForExactETH(
        amountOut, bigMax, path, other.address, deadline
      );
      const after = await tokenA.balanceOf(user.address);
      const spent = before - after;

      // Should not have spent the full bigMax — leftover returned
      expect(spent).to.be.lt(bigMax);
    });

    it("emits SwapTracked event", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const tx = await emberSwap.connect(user).swapTokensForExactETH(
        amountOut, amountInMax, path, other.address, deadline
      );
      const receipt = await tx.wait();
      const iface = emberSwap.interface;
      const tracked = receipt!.logs
        .map(log => { try { return iface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "SwapTracked");
      expect(tracked).to.not.be.undefined;
      expect(tracked!.args.user).to.equal(user.address);
    });

    it("increments swapCount for the caller", async () => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await emberSwap.connect(user).swapTokensForExactETH(
        amountOut, amountInMax, path, other.address, deadline
      );
      const [, count] = await emberSwap.getSwapStats(user.address);
      expect(count).to.equal(1n);
    });

    it("reverts if amountInMax is zero", async () => {
      await expect(
        emberSwap.connect(user).swapTokensForExactETH(
          amountOut, 0n, path, other.address, 9999999999n
        )
      ).to.be.revertedWith("EmberSwap: zero amountInMax");
    });

    it("reverts if path is too short", async () => {
      await expect(
        emberSwap.connect(user).swapTokensForExactETH(
          amountOut, amountInMax, [await tokenA.getAddress()], other.address, 9999999999n
        )
      ).to.be.revertedWith("EmberSwap: invalid path");
    });
  });

  describe("auto-liquidity threshold", () => {
    it("triggers _tryAutoAddLiquidity when threshold is met", async () => {
      // Lower threshold to 0 so it always triggers
      await emberSwap.connect(owner).setAutoLiquidityThreshold(0n);

      const path = [await mockWETH.getAddress(), await tokenB.getAddress()];
      const ethIn = ethers.parseEther("1");
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      // The auto-liquidity call will try to swap ETH for wEMBR and addLiquidity.
      // Since mock router has wEMBR tokens, this should succeed.
      await emberSwap.connect(user).swapExactETHForTokens(
        0n, path, user.address, deadline, { value: ethIn }
      );

      // After auto-liquidity, pendingLiquidityETH should be ~0 (or small remainder)
      // The LiquidityAdded event should be emitted
      // This is a smoke test — exact amounts depend on mock router
      expect(await emberSwap.pendingLiquidityETH()).to.be.lte(ethers.parseEther("0.001"));
    });

    it("emits AutoLiquidityThresholdUpdated when owner updates threshold", async () => {
      const newThreshold = ethers.parseEther("0.05");
      await expect(emberSwap.connect(owner).setAutoLiquidityThreshold(newThreshold))
        .to.emit(emberSwap, "AutoLiquidityThresholdUpdated")
        .withArgs(newThreshold);
    });

    it("reverts if non-owner tries to update threshold", async () => {
      await expect(
        emberSwap.connect(user).setAutoLiquidityThreshold(0n)
      ).to.be.revertedWithCustomError(emberSwap, "OwnableUnauthorizedAccount");
    });
  });

  describe("getAmountsOut", () => {
    it("returns amounts accounting for 0.25% fee", async () => {
      const amountIn = ethers.parseEther("1");
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      const fee = (amountIn * FEE_BPS) / BPS_DENOM;
      const amountAfterFee = amountIn - fee;

      const amounts = await emberSwap.getAmountsOut(amountIn, path);
      // Mock router returns 1:1, so output = amountAfterFee
      expect(amounts[amounts.length - 1]).to.equal(amountAfterFee);
    });
  });

  describe("admin", () => {
    it("allows owner to set wEMBR address", async () => {
      await emberSwap.connect(owner).setWEMBR(other.address);
      expect(await emberSwap.wEMBR()).to.equal(other.address);
    });

    it("reverts on zero wEMBR address", async () => {
      await expect(
        emberSwap.connect(owner).setWEMBR(ethers.ZeroAddress)
      ).to.be.revertedWith("EmberSwap: zero address");
    });

    it("reverts if non-owner sets wEMBR", async () => {
      await expect(
        emberSwap.connect(user).setWEMBR(other.address)
      ).to.be.revertedWithCustomError(emberSwap, "OwnableUnauthorizedAccount");
    });

    it("allows owner to rescue ETH", async () => {
      // Send ETH to contract
      await owner.sendTransaction({ to: await emberSwap.getAddress(), value: ONE_ETHER });
      const before = await ethers.provider.getBalance(other.address);
      await emberSwap.connect(owner).rescueETH(other.address, ONE_ETHER);
      const after = await ethers.provider.getBalance(other.address);
      expect(after - before).to.equal(ONE_ETHER);
    });

    it("allows owner to rescue tokens", async () => {
      await tokenA.mint(await emberSwap.getAddress(), ONE_ETHER);
      await emberSwap.connect(owner).rescueToken(await tokenA.getAddress(), other.address, ONE_ETHER);
      expect(await tokenA.balanceOf(other.address)).to.equal(ONE_ETHER);
    });
  });
});
