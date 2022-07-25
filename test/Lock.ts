import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { assert, expect } from "chai";
import { ethers } from "hardhat";

describe("Vesting", function () {
  async function seedSaleFixture() {
    const MONTH = 60 * 60 * 24 * 30;
    const FIVE_MONTH = MONTH * 5;
    const SALE_AMOUNT = ethers.utils.parseEther("42000000");
    const PRICE = 2500000000000000;
    const TOKENS_BOUGHT = 4000;
    const currentTime = await time.latest();

    const [owner, user, treasury] = await ethers.getSigners();

    const mockERC20 = await ethers.getContractFactory("MockERC20");
    const vorpal = await mockERC20.deploy();
    const usdc = await mockERC20.deploy();

    const Vesting = await ethers.getContractFactory("VestingSale");
    const vesting = await Vesting.deploy(
      vorpal.address,
      usdc.address,
      PRICE,
      SALE_AMOUNT,
      MONTH,
      0,
      FIVE_MONTH
    );

    await vorpal.mint(vesting.address, SALE_AMOUNT);
    await usdc.mint(owner.address, ethers.utils.parseEther("1000"));
    await usdc.increaseAllowance(
      vesting.address,
      ethers.utils.parseEther("10000")
    );

    return {
      vesting,
      owner,
      user,
      treasury,
      currentTime,
      MONTH,
      FIVE_MONTH,
      SALE_AMOUNT,
      TOKENS_BOUGHT,
      vorpal,
      usdc,
    };
  }

  describe("Vesting Sale", function () {
    it("Should buy a token (SEED)", async function () {
      const { vesting, owner, usdc, currentTime, FIVE_MONTH } =
        await loadFixture(seedSaleFixture);
      let buyAmount = ethers.utils.parseEther("2.5");

      await vesting.startSale();
      await vesting.buyTokens(buyAmount);
      const usdcBalance = await usdc.balanceOf(owner.address);
      const vestingSchedule = await vesting.getSchedule(owner.address);
      const tokensLeft = await vesting.totalTokensLeft();

      assert.equal(
        usdcBalance.toString(),
        "997500000000000000000",
        "Different amount of USDC after transaction"
      );
      assert.equal(
        vestingSchedule.amount.toString(),
        "1000000000000000000000",
        "Different amount of tokens in schedule"
      );
      assert.isAbove(
        vestingSchedule.unlockingEnd.toNumber(),
        currentTime + FIVE_MONTH,
        "Different time end"
      );
      assert.equal(
        tokensLeft.toString(),
        "41999000",
        "Different amount of tokens left"
      );
    });

    it("Shouldn't buy a token (sale didn't start)", async function () {
      const { vesting } = await loadFixture(seedSaleFixture);
      let buyAmount = ethers.utils.parseEther("2.5");

      await expect(vesting.buyTokens(buyAmount)).to.be.reverted;
    });

    it("Shouldn't buy a token (amount too small)", async function () {
      const { vesting } = await loadFixture(seedSaleFixture);
      let buyAmount = ethers.utils.parseEther("0.5");

      await vesting.startSale();
      await expect(vesting.buyTokens(buyAmount)).to.be.reverted;
    });

    it("Should withdraw tokens (2 month)", async function () {
      const { vesting, owner, vorpal, currentTime, MONTH } = await loadFixture(
        seedSaleFixture
      );
      let buyAmount = ethers.utils.parseEther("50");

      await vesting.startSale();
      await vesting.buyTokens(buyAmount);
      await time.increaseTo(currentTime + MONTH + MONTH);
      await vesting.withdrawTokens(ethers.utils.parseEther("10"));

      const balance = await vorpal.balanceOf(owner.address);
      const balanceContract = await vorpal.balanceOf(vesting.address);

      assert.equal(
        ethers.utils.formatEther(balance.toString()),
        "10.0",
        "Different amount of Vorpal transferred"
      );
      assert.equal(
        balanceContract.toString(),
        "41999990000000000000000000",
        "Different amount of Vorpal"
      );
    });

    it("Should withdraw tokens (5 month)", async function () {
      const { vesting, owner, vorpal, currentTime, MONTH } = await loadFixture(
        seedSaleFixture
      );
      let buyAmount = ethers.utils.parseEther("50");

      await vesting.startSale();
      await vesting.buyTokens(buyAmount);
      await time.increaseTo(currentTime + MONTH + MONTH);
      await vesting.withdrawTokens(ethers.utils.parseEther("2000"));

      const balance = await vorpal.balanceOf(owner.address);
      const balanceContract = await vorpal.balanceOf(vesting.address);
      assert.equal(
        ethers.utils.formatEther(balance.toString()),
        "2000.0",
        "Different amount of Vorpal transferred"
      );
      assert.equal(
        balanceContract.toString(),
        "41998000000000000000000000",
        "Different amount of Vorpal"
      );
    });

    it("Shouldn't withdraw tokens (too many requested)", async function () {
      const { vesting, currentTime, MONTH } = await loadFixture(
        seedSaleFixture
      );
      let buyAmount = ethers.utils.parseEther("2");

      await vesting.startSale();
      await vesting.buyTokens(buyAmount);
      await time.increaseTo(currentTime + MONTH + MONTH);
      await expect(vesting.withdrawTokens(ethers.utils.parseEther("1000"))).to
        .be.reverted;
    });

    it("Shouldn't withdraw tokens (not enough tokens)", async function () {
      const { vesting, currentTime, MONTH } = await loadFixture(
        seedSaleFixture
      );
      let buyAmount = ethers.utils.parseEther("2");

      await vesting.startSale();
      await vesting.buyTokens(buyAmount);
      await time.increaseTo(currentTime + MONTH + MONTH);
      await vesting.withdrawTokens(ethers.utils.parseEther("500"));
      await expect(vesting.withdrawTokens(ethers.utils.parseEther("500"))).to.be
        .reverted;
    });
  });

  describe("Admin Functions", function () {
    it("Should start a sale", async function () {
      const { vesting, currentTime, MONTH } = await loadFixture(
        seedSaleFixture
      );

      await vesting.startSale();
      const saleEnd = await vesting.saleEnd();
      const status = await vesting.status();

      assert.isAbove(
        saleEnd.toNumber(),
        currentTime + MONTH,
        "Sale ends earlier than one month"
      );
      assert.equal(status, 1, "Contrat has different status");
    });

    it("Shouldn't start a sale (only owner)", async function () {
      const { vesting, user } = await loadFixture(seedSaleFixture);

      await expect(vesting.connect(user).startSale()).to.be.reverted;
    });

    it("Shouldn't start a sale (only pending)", async function () {
      const { vesting } = await loadFixture(seedSaleFixture);
      await vesting.startSale();
      await expect(vesting.startSale()).to.be.reverted;
    });

    it("Should finish a sale", async function () {
      const { vesting, currentTime, MONTH } = await loadFixture(
        seedSaleFixture
      );

      await vesting.startSale();
      await time.increaseTo(currentTime + MONTH + 100);
      await vesting.finishSale();
      const status = await vesting.status();
      const endTime = await vesting.saleEnd();

      assert.equal(status, 2, "Contract has different status");
      assert.isAbove(endTime.toNumber(), currentTime + MONTH);
    });

    it("Shouldn't finish a sale (only owner)", async function () {
      const { vesting, user, currentTime, MONTH } = await loadFixture(
        seedSaleFixture
      );

      await vesting.startSale();
      await time.increaseTo(currentTime + MONTH + 100);
      await expect(vesting.connect(user).finishSale()).to.be.reverted;
    });

    it("Shouldn't finish a sale (sale not ended)", async function () {
      const { vesting, user } = await loadFixture(seedSaleFixture);

      await vesting.startSale();
      await expect(vesting.connect(user).finishSale()).to.be.reverted;
    });

    it("Should finish a sale", async function () {
      const { vesting, treasury, currentTime, MONTH } = await loadFixture(
        seedSaleFixture
      );

      await vesting.startSale();
      await time.increaseTo(currentTime + MONTH + 100);
      await vesting.finishSale();
    });

    it("Should withdraw remaining tokens", async function () {
      const { vesting, owner, treasury, vorpal, usdc, currentTime, MONTH } =
        await loadFixture(seedSaleFixture);
      let buyAmount = ethers.utils.parseEther("50");

      await vesting.startSale();
      await vesting.buyTokens(buyAmount);
      await time.increaseTo(currentTime + MONTH + MONTH);
      await vesting.finishSale();
      const schedule = await vesting.getSchedule(owner.address);
      // await vesting.withdrawTokens(ethers.utils.parseEther("10"));

      // const treasuryUSDC = await usdc.balanceOf(treasury.address);
      // const treasuryVorpal = await vorpal.balanceOf(treasury.address);
    });
  });
});
