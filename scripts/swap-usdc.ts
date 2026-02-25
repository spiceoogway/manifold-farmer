/**
 * Swap native USDC → USDC.e on Polygon via Uniswap V3 (0.01% fee pool).
 * Polymarket's exchange contract only accepts USDC.e as collateral.
 *
 *   pnpm swap:usdc
 *
 * Requires POLY_PRIVATE_KEY in .env.
 */

import "dotenv/config";
import { ethers } from "ethers";

const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";

const USDC_NATIVE = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"; // what you have
const USDC_E      = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // what Polymarket needs
const ROUTER      = "0xE592427A0AEce92De3Edee1F18E0157C05861564"; // Uniswap V3 SwapRouter
const FEE         = 100; // 0.01% pool — tightest spread for stable pair
const SLIPPAGE    = 0.005; // 0.5% max slippage

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
];

const ROUTER_ABI = [
  `function exactInputSingle(
    (address tokenIn, address tokenOut, uint24 fee, address recipient,
     uint256 deadline, uint256 amountIn, uint256 amountOutMinimum,
     uint160 sqrtPriceLimitX96) params
  ) external payable returns (uint256 amountOut)`,
];

const GAS_OVERRIDES = {
  maxPriorityFeePerGas: ethers.utils.parseUnits("30", "gwei"),
  maxFeePerGas:         ethers.utils.parseUnits("250", "gwei"),
};

async function main() {
  const privateKey = process.env.POLY_PRIVATE_KEY;
  if (!privateKey) { console.error("POLY_PRIVATE_KEY not set"); process.exit(1); }

  const provider = new ethers.providers.JsonRpcProvider(POLYGON_RPC);
  const wallet   = new ethers.Wallet(privateKey, provider);
  const usdcIn   = new ethers.Contract(USDC_NATIVE, ERC20_ABI, wallet);
  const usdcOut  = new ethers.Contract(USDC_E,      ERC20_ABI, wallet);
  const router   = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);

  const decimals = await usdcIn.decimals() as number;
  const balance: ethers.BigNumber = await usdcIn.balanceOf(wallet.address);
  const balanceHuman = ethers.utils.formatUnits(balance, decimals);

  console.log(`\nWallet:  ${wallet.address}`);
  console.log(`Balance: ${balanceHuman} native USDC`);

  if (balance.isZero()) {
    console.error("No native USDC to swap.");
    process.exit(1);
  }

  // Swap full balance
  const amountIn = balance;
  const amountOutMin = amountIn.mul(Math.floor((1 - SLIPPAGE) * 10000)).div(10000);
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min

  console.log(`\nSwapping ${balanceHuman} USDC → USDC.e`);
  console.log(`Min out: ${ethers.utils.formatUnits(amountOutMin, decimals)} USDC.e (${SLIPPAGE * 100}% slippage tolerance)`);

  // Approve router
  const allowance: ethers.BigNumber = await usdcIn.allowance(wallet.address, ROUTER);
  if (allowance.lt(amountIn)) {
    console.log("\nApproving router...");
    const approveTx = await usdcIn.approve(ROUTER, ethers.constants.MaxUint256, GAS_OVERRIDES);
    console.log(`  tx: https://polygonscan.com/tx/${approveTx.hash}`);
    await approveTx.wait();
    console.log("  confirmed");
  }

  // Execute swap
  console.log("\nExecuting swap...");
  const swapTx = await router.exactInputSingle(
    {
      tokenIn:           USDC_NATIVE,
      tokenOut:          USDC_E,
      fee:               FEE,
      recipient:         wallet.address,
      deadline,
      amountIn,
      amountOutMinimum:  amountOutMin,
      sqrtPriceLimitX96: 0,
    },
    { ...GAS_OVERRIDES }
  );
  console.log(`  tx: https://polygonscan.com/tx/${swapTx.hash}`);
  const receipt = await swapTx.wait();
  console.log(`  confirmed (block ${receipt.blockNumber})`);

  const newBalance: ethers.BigNumber = await usdcOut.balanceOf(wallet.address);
  console.log(`\nDone. USDC.e balance: ${ethers.utils.formatUnits(newBalance, decimals)}`);
  console.log("Ready to run pnpm setup:poly");
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
