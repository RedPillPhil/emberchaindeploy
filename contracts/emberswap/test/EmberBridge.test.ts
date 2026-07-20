import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { EmberBridge } from "../typechain-types";

describe("EmberBridge (EMBR chain side)", () => {
  let bridge: EmberBridge;
  let owner: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let other: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, relayer, user, other, recipient] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("EmberBridge");
    bridge = (await Factory.deploy(relayer.address)) as EmberBridge;
    await bridge.waitForDeployment();
  });

  describe("lockEMBR", () => {
    it("accepts native EMBR and emits BridgeOut", async () => {
      const amount = ethers.parseEther("5");
      const baseRecipient = other.address;
      const nonce = 1n;
      await expect(
        bridge.connect(user).lockEMBR(baseRecipient, nonce, { value: amount })
      )
        .to.emit(bridge, "BridgeOut")
        .withArgs(user.address, baseRecipient, amount, nonce);
    });

    it("increases totalLocked", async () => {
      const amount = ethers.parseEther("3");
      await bridge.connect(user).lockEMBR(other.address, 1n, { value: amount });
      expect(await bridge.totalLocked()).to.equal(amount);
    });

    it("holds ETH in the contract", async () => {
      const amount = ethers.parseEther("2");
      await bridge.connect(user).lockEMBR(other.address, 1n, { value: amount });
      const bridgeAddr = await bridge.getAddress();
      expect(await ethers.provider.getBalance(bridgeAddr)).to.equal(amount);
    });

    it("reverts if value is zero", async () => {
      await expect(
        bridge.connect(user).lockEMBR(other.address, 1n, { value: 0n })
      ).to.be.revertedWith("EmberBridge: zero value");
    });

    it("reverts if baseRecipient is zero address", async () => {
      await expect(
        bridge.connect(user).lockEMBR(ethers.ZeroAddress, 1n, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("EmberBridge: zero recipient");
    });

    it("reverts on nonce replay", async () => {
      const nonce = 7n;
      await bridge.connect(user).lockEMBR(other.address, nonce, { value: ethers.parseEther("1") });
      await expect(
        bridge.connect(user).lockEMBR(other.address, nonce, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("EmberBridge: nonce already used");
    });

    it("accepts multiple locks with unique nonces", async () => {
      await bridge.connect(user).lockEMBR(other.address, 1n, { value: ethers.parseEther("1") });
      await bridge.connect(user).lockEMBR(other.address, 2n, { value: ethers.parseEther("2") });
      expect(await bridge.totalLocked()).to.equal(ethers.parseEther("3"));
    });
  });

  describe("releaseEMBR", () => {
    beforeEach(async () => {
      // Pre-fund the bridge with some ETH (simulating prior lockEMBR calls)
      await bridge.connect(user).lockEMBR(other.address, 1n, { value: ethers.parseEther("10") });
    });

    it("sends native EMBR to recipient and emits BridgeIn", async () => {
      const amount = ethers.parseEther("5");
      const nonce = 100n;
      const before = await ethers.provider.getBalance(recipient.address);
      await bridge.connect(relayer).releaseEMBR(recipient.address, amount, nonce);
      const after = await ethers.provider.getBalance(recipient.address);
      expect(after - before).to.equal(amount);
      await expect(
        bridge.connect(relayer).releaseEMBR(recipient.address, ethers.parseEther("1"), 101n)
      ).to.emit(bridge, "BridgeIn");
    });

    it("decreases totalLocked", async () => {
      await bridge.connect(relayer).releaseEMBR(recipient.address, ethers.parseEther("3"), 100n);
      expect(await bridge.totalLocked()).to.equal(ethers.parseEther("7"));
    });

    it("reverts if called by non-relayer", async () => {
      await expect(
        bridge.connect(user).releaseEMBR(recipient.address, ethers.parseEther("1"), 100n)
      ).to.be.revertedWith("EmberBridge: caller is not the relayer");
    });

    it("reverts on nonce replay", async () => {
      const nonce = 200n;
      await bridge.connect(relayer).releaseEMBR(recipient.address, ethers.parseEther("1"), nonce);
      await expect(
        bridge.connect(relayer).releaseEMBR(recipient.address, ethers.parseEther("1"), nonce)
      ).to.be.revertedWith("EmberBridge: nonce already used");
    });

    it("reverts if amount exceeds escrow balance", async () => {
      await expect(
        bridge.connect(relayer).releaseEMBR(recipient.address, ethers.parseEther("100"), 100n)
      ).to.be.revertedWith("EmberBridge: insufficient escrow");
    });

    it("reverts if recipient is zero address", async () => {
      await expect(
        bridge.connect(relayer).releaseEMBR(ethers.ZeroAddress, ethers.parseEther("1"), 100n)
      ).to.be.revertedWith("EmberBridge: zero recipient");
    });

    it("reverts if amount is zero", async () => {
      await expect(
        bridge.connect(relayer).releaseEMBR(recipient.address, 0n, 100n)
      ).to.be.revertedWith("EmberBridge: zero amount");
    });
  });

  describe("setRelayer", () => {
    it("allows owner to update relayer", async () => {
      await bridge.connect(owner).setRelayer(other.address);
      expect(await bridge.relayer()).to.equal(other.address);
    });

    it("emits RelayerUpdated", async () => {
      await expect(bridge.connect(owner).setRelayer(other.address))
        .to.emit(bridge, "RelayerUpdated")
        .withArgs(relayer.address, other.address);
    });

    it("reverts if non-owner calls", async () => {
      await expect(
        bridge.connect(user).setRelayer(other.address)
      ).to.be.revertedWithCustomError(bridge, "OwnableUnauthorizedAccount");
    });

    it("reverts on zero address", async () => {
      await expect(
        bridge.connect(owner).setRelayer(ethers.ZeroAddress)
      ).to.be.revertedWith("EmberBridge: zero address");
    });
  });
});
