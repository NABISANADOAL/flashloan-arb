import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import * as dotenv from "dotenv";

dotenv.config();

const MAINNET_RPC_URL =
  process.env.MAINNET_RPC_URL || "https://eth.drpc.org";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 1,
      forking: {
        url: MAINNET_RPC_URL,
      },
    },
    mainnet: {
      url: MAINNET_RPC_URL,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  mocha: {
    timeout: 120000,
  },
};

export default config;
