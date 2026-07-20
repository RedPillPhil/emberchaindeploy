import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { WrappedEMBR } from "../typechain-types";

describe("WrappedEMBR", () => {
  let wEMBR: WrappedEMBR;
  let owner: HardhatEthersSigner;
  let bridge: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, bridge, user, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("WrappedEMBR");
    wEMBR = (await Factory.deploy(bridge.address)) as WrappedEMBR;
    await wEMBR.waitForDeployment();
  });

  describe("deployment", () => {
    it("has correct name and symbol", async () => {
      expect(await wEMBR.name()).to.equal("Wrapped EMBR");
      expect(await wEMBR.symbol()).to.equal("wEMBR");
    });

    it("has 18 decimals", async () => {
      expect(await wEMBR.decimals()).to.equal(18n);
    });

    it("sets the bridge address", async () => {
      expect(await wEMBR.bridge()).to.equal(bridge.address);
    });

    it("reverts if bridge address is zero", async () => {
      const Factory = await ethers.getContractFactory("WrappedEMBR");
      await expect(
        Factory.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("wEMBR: zero bridge address");
    });
  });

  describe("mint", () => {
    it("allows bridge to mint tokens", async () => {
      const amount = ethers.parseEther("100");
      await wEMBR.connect(bridge).mint(user.address, amount);
      expect(await wEMBR.balanceOf(user.address)).to.equal(amount);
    });

    it("reverts if non-bridge tries to mint", async () => {
      await expect(
        wEMBR.connect(user).mint(user.address, ethers.parseEther("1"))
      ).to.be.revertedWith("wEMBR: caller is not the bridge");
    });

    it("reverts if owner (not bridge) tries to mint", async () => {
      await expect(
        wEMBR.connect(owner).mint(user.address, ethers.parseEther("1"))
      ).to.be.revertedWith("wEMBR: caller is not the bridge");
    });

    it("updates total supply correctly", async () => {
      await wEMBR.connect(bridge).mint(user.address, ethers.parseEther("50"));
      await wEMBR.connect(bridge).mint(other.address, ethers.parseEther("50"));
      expect(await wEMBR.totalSupply()).to.equal(ethers.parseEther("100"));
    });
  });

  describe("burn", () => {
    beforeEach(async () => {
      await wEMBR.connect(bridge).mint(user.address, ethers.parseEther("100"));
    });

    it("allows bridge to burn tokens from a holder", async () => {
      await wEMBR.connect(bridge).burn(user.address, ethers.parseEther("40"));
      expect(await wEMBR.balanceOf(user.address)).to.equal(ethers.parseEther("60"));
    });

    it("reverts if non-bridge tries to burn", async () => {
      await expect(
        wEMBR.connect(user).burn(user.address, ethers.parseEther("1"))
      ).to.be.revertedWith("wEMBR: caller is not the bridge");
    });

    it("reverts if burning more than balance", async () => {
      await expect(
        wEMBR.connect(bridge).burn(user.address, ethers.parseEther("101"))
      ).to.be.revertedWithCustomError(wEMBR, "ERC20InsufficientBalance");
    });
  });

  describe("setBridge", () => {
    it("allows owner to update the bridge address", async () => {
      await wEMBR.connect(owner).setBridge(other.address);
      expect(await wEMBR.bridge()).to.equal(other.address);
    });

    it("emits BridgeUpdated event", async () => {
      await expect(wEMBR.connect(owner).setBridge(other.address))
        .to.emit(wEMBR, "BridgeUpdated")
        .withArgs(bridge.address, other.address);
    });

    it("reverts if non-owner tries to update bridge", async () => {
      await expect(
        wEMBR.connect(user).setBridge(other.address)
      ).to.be.revertedWithCustomError(wEMBR, "OwnableUnauthorizedAccount");
    });

    it("reverts if new bridge is zero address", async () => {
      await expect(
        wEMBR.connect(owner).setBridge(ethers.ZeroAddress)
      ).to.be.revertedWith("wEMBR: zero address");
    });

    it("new bridge can mint after update", async () => {
      await wEMBR.connect(owner).setBridge(other.address);
      await wEMBR.connect(other).mint(user.address, ethers.parseEther("10"));
      expect(await wEMBR.balanceOf(user.address)).to.equal(ethers.parseEther("10"));
    });

    it("old bridge cannot mint after update", async () => {
      await wEMBR.connect(owner).setBridge(other.address);
      await expect(
        wEMBR.connect(bridge).mint(user.address, ethers.parseEther("1"))
      ).to.be.revertedWith("wEMBR: caller is not the bridge");
    });
  });
});
