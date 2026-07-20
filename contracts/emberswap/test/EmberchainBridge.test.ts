import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { EmberchainBridge, WrappedEMBR } from "../typechain-types";

describe("EmberchainBridge", () => {
  let bridge: EmberchainBridge;
  let wEMBR: WrappedEMBR;
  let owner: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, relayer, user, other] = await ethers.getSigners();

    // Deploy bridge first with a placeholder wEMBR address, then deploy wEMBR pointing at bridge
    const BridgeFactory = await ethers.getContractFactory("EmberchainBridge");
    const WEMBRFactory = await ethers.getContractFactory("WrappedEMBR");

    // Use a two-step: deploy bridge with temp address, deploy wEMBR with bridge address,
    // then update bridge's wEMBR reference. Actually wEMBR is immutable on bridge —
    // so deploy wEMBR with a temp bridge, deploy bridge, then setBridge on wEMBR.
    wEMBR = (await WEMBRFactory.deploy(owner.address)) as WrappedEMBR; // temp bridge = owner
    await wEMBR.waitForDeployment();

    bridge = (await BridgeFactory.deploy(
      await wEMBR.getAddress(),
      relayer.address
    )) as EmberchainBridge;
    await bridge.waitForDeployment();

    // Wire: set the real bridge on wEMBR
    await wEMBR.connect(owner).setBridge(await bridge.getAddress());
  });

  describe("bridgeIn (relayer mints wEMBR)", () => {
    it("mints wEMBR to recipient when called by relayer", async () => {
      const amount = ethers.parseEther("10");
      const nonce = 1n;
      await bridge.connect(relayer).bridgeIn(user.address, amount, nonce);
      expect(await wEMBR.balanceOf(user.address)).to.equal(amount);
    });

    it("emits BridgeIn event", async () => {
      const amount = ethers.parseEther("5");
      const nonce = 42n;
      await expect(bridge.connect(relayer).bridgeIn(user.address, amount, nonce))
        .to.emit(bridge, "BridgeIn")
        .withArgs(user.address, amount, nonce);
    });

    it("reverts if called by non-relayer", async () => {
      await expect(
        bridge.connect(user).bridgeIn(user.address, ethers.parseEther("1"), 1n)
      ).to.be.revertedWith("Bridge: caller is not the relayer");
    });

    it("reverts on nonce replay", async () => {
      const amount = ethers.parseEther("1");
      const nonce = 100n;
      await bridge.connect(relayer).bridgeIn(user.address, amount, nonce);
      await expect(
        bridge.connect(relayer).bridgeIn(user.address, amount, nonce)
      ).to.be.revertedWith("Bridge: nonce already used");
    });

    it("reverts if recipient is zero address", async () => {
      await expect(
        bridge.connect(relayer).bridgeIn(ethers.ZeroAddress, ethers.parseEther("1"), 1n)
      ).to.be.revertedWith("Bridge: zero recipient");
    });

    it("reverts if amount is zero", async () => {
      await expect(
        bridge.connect(relayer).bridgeIn(user.address, 0n, 1n)
      ).to.be.revertedWith("Bridge: zero amount");
    });

    it("marks nonce as used after bridgeIn", async () => {
      const nonce = 77n;
      await bridge.connect(relayer).bridgeIn(user.address, ethers.parseEther("1"), nonce);
      expect(await bridge.usedNonces(nonce)).to.equal(true);
    });

    it("allows different nonces independently", async () => {
      await bridge.connect(relayer).bridgeIn(user.address, ethers.parseEther("1"), 1n);
      await bridge.connect(relayer).bridgeIn(user.address, ethers.parseEther("2"), 2n);
      expect(await wEMBR.balanceOf(user.address)).to.equal(ethers.parseEther("3"));
    });
  });

  describe("bridgeOut (user burns wEMBR)", () => {
    beforeEach(async () => {
      // Mint some wEMBR to user first
      await bridge.connect(relayer).bridgeIn(user.address, ethers.parseEther("50"), 1n);
    });

    it("burns wEMBR from user and emits BridgeOut", async () => {
      const amount = ethers.parseEther("20");
      const nonce = 2n;
      const embrAddr = "0xabcdef1234567890abcdef1234567890abcdef12";
      await wEMBR.connect(user).approve(await bridge.getAddress(), amount);
      await expect(bridge.connect(user).bridgeOut(amount, embrAddr, nonce))
        .to.emit(bridge, "BridgeOut")
        .withArgs(user.address, embrAddr, amount, nonce);
      expect(await wEMBR.balanceOf(user.address)).to.equal(ethers.parseEther("30"));
    });

    it("reverts if nonce is reused", async () => {
      const amount = ethers.parseEther("1");
      const nonce = 999n;
      await wEMBR.connect(user).approve(await bridge.getAddress(), amount * 2n);
      await bridge.connect(user).bridgeOut(amount, "0x1234567890123456789012345678901234567890", nonce);
      await expect(
        bridge.connect(user).bridgeOut(amount, "0x1234567890123456789012345678901234567890", nonce)
      ).to.be.revertedWith("Bridge: nonce already used");
    });

    it("reverts if amount is zero", async () => {
      await expect(
        bridge.connect(user).bridgeOut(0n, "0x1234567890123456789012345678901234567890", 2n)
      ).to.be.revertedWith("Bridge: zero amount");
    });

    it("reverts if embrRecipient is empty", async () => {
      await wEMBR.connect(user).approve(await bridge.getAddress(), ethers.parseEther("1"));
      await expect(
        bridge.connect(user).bridgeOut(ethers.parseEther("1"), "", 2n)
      ).to.be.revertedWith("Bridge: empty recipient");
    });
  });

  describe("setRelayer", () => {
    it("allows owner to update relayer", async () => {
      await bridge.connect(owner).setRelayer(other.address);
      expect(await bridge.relayer()).to.equal(other.address);
    });

    it("emits RelayerUpdated event", async () => {
      await expect(bridge.connect(owner).setRelayer(other.address))
        .to.emit(bridge, "RelayerUpdated")
        .withArgs(relayer.address, other.address);
    });

    it("reverts if non-owner calls setRelayer", async () => {
      await expect(
        bridge.connect(user).setRelayer(other.address)
      ).to.be.revertedWithCustomError(bridge, "OwnableUnauthorizedAccount");
    });

    it("reverts on zero address", async () => {
      await expect(
        bridge.connect(owner).setRelayer(ethers.ZeroAddress)
      ).to.be.revertedWith("Bridge: zero address");
    });

    it("new relayer can call bridgeIn", async () => {
      await bridge.connect(owner).setRelayer(other.address);
      await bridge.connect(other).bridgeIn(user.address, ethers.parseEther("1"), 200n);
      expect(await wEMBR.balanceOf(user.address)).to.equal(ethers.parseEther("1"));
    });

    it("old relayer cannot call bridgeIn after update", async () => {
      await bridge.connect(owner).setRelayer(other.address);
      await expect(
        bridge.connect(relayer).bridgeIn(user.address, ethers.parseEther("1"), 201n)
      ).to.be.revertedWith("Bridge: caller is not the relayer");
    });
  });
});
