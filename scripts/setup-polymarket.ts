/**
 * One-time setup: approve Polymarket's exchange contracts to spend your USDC.
 * Run once before your first live trade.
 *
 *   pnpm setup:poly
 *
 * Requires POLY_PRIVATE_KEY in .env.
 */

import "dotenv/config";
import { ethers } from "ethers";

// Polygon mainnet — pulled from @polymarket/clob-client config.js
const CONTRACTS = {
  exchange:        "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  negRiskExchange: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  collateral:      "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC.e on Polygon
};

const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

async function main() {
  const privateKey = process.env.POLY_PRIVATE_KEY;
  if (!privateKey) {
    console.error("POLY_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(POLYGON_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  const usdc = new ethers.Contract(CONTRACTS.collateral, ERC20_ABI, wallet);

  const [decimals, symbol] = await Promise.all([
    usdc.decimals() as Promise<number>,
    usdc.symbol() as Promise<string>,
  ]);

  console.log(`\nWallet:  ${wallet.address}`);
  console.log(`Network: Polygon mainnet`);

  const balance: ethers.BigNumber = await usdc.balanceOf(wallet.address);
  console.log(`Balance: ${ethers.utils.formatUnits(balance, decimals)} ${symbol}`);

  if (balance.isZero()) {
    console.warn("\nWarning: wallet has no USDC. Bridge USDC to Polygon before trading.");
  }

  console.log();

  const spenders: Array<[string, string]> = [
    ["CTF Exchange    ", CONTRACTS.exchange],
    ["NegRisk Exchange", CONTRACTS.negRiskExchange],
  ];

  for (const [label, spender] of spenders) {
    const allowance: ethers.BigNumber = await usdc.allowance(wallet.address, spender);
    const threshold = ethers.utils.parseUnits("1000000", decimals); // 1M USDC

    if (allowance.gte(threshold)) {
      console.log(`${label}: already approved (${ethers.utils.formatUnits(allowance, decimals)} ${symbol})`);
    } else {
      console.log(`${label}: approving...`);
      const tx = await usdc.approve(spender, ethers.constants.MaxUint256, {
        maxPriorityFeePerGas: ethers.utils.parseUnits("30", "gwei"),
        maxFeePerGas: ethers.utils.parseUnits("250", "gwei"),
      });
      console.log(`  tx: https://polygonscan.com/tx/${tx.hash}`);
      await tx.wait();
      console.log(`  confirmed`);
    }
  }

  console.log("\nSetup complete. You're ready to trade on Polymarket.");
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
