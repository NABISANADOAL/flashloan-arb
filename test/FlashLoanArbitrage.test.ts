import { expect } from "chai";
import { ethers } from "hardhat";
import { AAVE_V3_POOL } from "../scripts/addresses";

describe("FlashLoanArbitrage", () => {
  it("deploys against the canonical Aave V3 pool address", async () => {
    const Factory = await ethers.getContractFactory("FlashLoanArbitrage");
    const c = await Factory.deploy(AAVE_V3_POOL);
    await c.waitForDeployment();
    expect((await c.POOL()).toLowerCase()).to.equal(AAVE_V3_POOL.toLowerCase());
  });

  it("rejects flash-arb from non-owner", async () => {
    const [, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("FlashLoanArbitrage");
    const c = await Factory.deploy(AAVE_V3_POOL);
    await c.waitForDeployment();
    const params = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address buyRouter,address sellRouter,address tokenMid,uint256 minProfit)"],
      [
        {
          buyRouter: ethers.ZeroAddress,
          sellRouter: ethers.ZeroAddress,
          tokenMid: ethers.ZeroAddress,
          minProfit: 0n,
        },
      ]
    );
    await expect(
      c.connect(other).executeFlashArb(ethers.ZeroAddress, 1n, params)
    ).to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount");
  });
});
