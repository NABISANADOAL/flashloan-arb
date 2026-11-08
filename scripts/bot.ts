import { ethers } from "hardhat";
import { AAVE_V3_POOL, TOKENS } from "./addresses";
import { formatUnits } from "./amm";
import { describeOpportunity, findOpportunities, Leg, Opportunity } from "./scan";

function encodeParams(hit: Opportunity): string {
  const leg = (item: Leg) => ({
    router: item.router,
    venue: item.venue,
    fee: item.fee,
    minOut: item.minOut,
  });
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(tuple(address router,uint8 venue,uint24 fee,uint256 minOut) buy, tuple(address router,uint8 venue,uint24 fee,uint256 minOut) sell, address tokenMid, uint256 minProfit)",
    ],
    [
      {
        buy: leg(hit.buy),
        sell: leg(hit.sell),
        tokenMid: TOKENS[hit.mid].address,
        minProfit: 1n,
      },
    ]
  );
}

export async function runBot(): Promise<void> {
  const block = await ethers.provider.getBlockNumber();
  const net = await ethers.provider.getNetwork();
  console.log(`chain=${net.chainId} block=${block}`);

  const { profitable, nearest } = await findOpportunities();
  const best = profitable[0];
  if (!best) {
    console.log("No swap left a profit after gas. Balancer's loan fee is zero. Nothing was sent.");
    console.log("Closest quotes:");
    for (const hit of nearest) console.log(describeOpportunity(hit));
    return;
  }

  const signers = await ethers.getSigners();
  const owner = signers[0];
  if (!owner) {
    console.log(describeOpportunity(best));
    console.log("Opportunity is profitable, but this process has no signer. Put PRIVATE_KEY in the local .env to broadcast. Do not paste the key into chat.");
    return;
  }

  console.log(`executing ${describeOpportunity(best)}`);
  const Factory = await ethers.getContractFactory("FlashLoanArbitrage", owner);
  const arb = await Factory.deploy(AAVE_V3_POOL);
  await arb.waitForDeployment();

  const token = TOKENS[best.borrow];
  const tx = await arb.executeBalancerArb(token.address, best.amount, encodeParams(best));
  const receipt = await tx.wait();
  const erc20 = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)"],
    token.address,
    owner
  );
  const received = BigInt(await erc20.balanceOf(owner.address));
  console.log("flash loan tx", receipt?.hash, "status", receipt?.status, "gas", receipt?.gasUsed?.toString());
  console.log("owner received", formatUnits(received, token.decimals), best.borrow);
  console.log("contract", await arb.getAddress());
}

if (require.main === module) {
  const loops = process.env.BOT_LOOPS ? Number(process.env.BOT_LOOPS) : Number.POSITIVE_INFINITY;
  const waitMs = Number(process.env.BOT_INTERVAL_MS ?? "30000");
  const run = async () => {
    let pass = 0;
    while (pass < loops) {
      pass += 1;
      console.log(`pass ${pass}`);
      try {
        await runBot();
      } catch (err) {
        console.error(err);
      }
      if (pass < loops) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  };
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
