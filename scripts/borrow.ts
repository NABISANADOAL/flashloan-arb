import { ethers, network } from "hardhat";
import { AAVE_V3_POOL, TOKENS } from "./addresses";
import { formatUnits } from "./amm";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];
const POOL_ABI = ["function FLASHLOAN_PREMIUM_TOTAL() view returns (uint128)"];

const USDC_HOLDERS = [
  "0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341",
  "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503",
  "0x28C6c06298d514Db089934071355E5743bf21d60",
];

async function fundPremium(token: string, to: string, premium: bigint): Promise<void> {
  const erc20 = new ethers.Contract(token, ERC20_ABI, ethers.provider);
  for (const holder of USDC_HOLDERS) {
    const balance: bigint = await erc20.balanceOf(holder);
    if (balance < premium) continue;
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [holder] });
    await network.provider.request({
      method: "hardhat_setBalance",
      params: [holder, "0x8AC7230489E80000"],
    });
    const signer = await ethers.getSigner(holder);
    const sending = erc20.connect(signer) as typeof erc20;
    await sending.transfer(to, premium);
    return;
  }
  throw new Error("No forked USDC holder had enough balance to cover the Aave premium");
}

async function main() {
  const token = TOKENS.USDC;
  const amount = 10_000n * 10n ** BigInt(token.decimals);
  const pool = new ethers.Contract(AAVE_V3_POOL, POOL_ABI, ethers.provider);
  const premiumBps = BigInt(await pool.FLASHLOAN_PREMIUM_TOTAL());
  const premium = (amount * premiumBps) / 10_000n;

  const Factory = await ethers.getContractFactory("FlashLoanArbitrage");
  const borrower = await Factory.deploy(AAVE_V3_POOL);
  await borrower.waitForDeployment();
  const borrowerAddress = await borrower.getAddress();

  await fundPremium(token.address, borrowerAddress, premium);

  const block = await ethers.provider.getBlockNumber();
  console.log(`chain=1 block=${block}`);
  console.log(`borrowing ${formatUnits(amount, token.decimals)} ${token.symbol} from Aave with no collateral`);
  console.log(`premium funded on the fork: ${formatUnits(premium, token.decimals)} ${token.symbol}`);

  const tx = await borrower.flashBorrow(token.address, amount);
  const receipt = await tx.wait();
  const erc20 = new ethers.Contract(token.address, ERC20_ABI, ethers.provider);
  const left: bigint = await erc20.balanceOf(borrowerAddress);

  console.log("tx status", receipt?.status, "gas", receipt?.gasUsed?.toString());
  console.log("contract", borrowerAddress);
  console.log("Aave pool", AAVE_V3_POOL);
  console.log(`repaid ${formatUnits(amount + premium, token.decimals)} ${token.symbol} in the same transaction`);
  console.log(`left in contract ${formatUnits(left, token.decimals)} ${token.symbol}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
