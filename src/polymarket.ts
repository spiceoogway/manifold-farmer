import { ClobClient, Side, OrderType, Chain } from "@polymarket/clob-client";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import type { Config } from "./types.js";

// === Types ===

interface PolymarketApiMarket {
  condition_id: string;
  question_id: string;
  question: string;
  market_slug: string;
  outcomes: string;         // JSON: '["Yes","No"]'
  outcomePrices: string;    // JSON: '["0.65","0.35"]'
  volume: string;
  volume24hr: number;
  liquidityNum: number;
  endDate: string;
  active: boolean;
  closed: boolean;
  tokens: { token_id: string; outcome: string }[];
}

export interface PolymarketMarket {
  conditionId: string;
  question: string;
  slug: string;
  yesPrice: number;
  noPrice: number;
  yesTokenId: string;
  noTokenId: string;
  volume24hr: number;
  liquidity: number;
  endDate: Date;
}

// === Market Fetching (Gamma API, no auth) ===

const GAMMA_API = "https://gamma-api.polymarket.com";

export async function fetchPolymarketMarkets(config: Config): Promise<PolymarketMarket[]> {
  const url = `${GAMMA_API}/markets?closed=false&active=true&limit=200`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "manifold-farmer/1.0" },
    });

    if (!res.ok) {
      throw new Error(`Gamma API error: ${res.status} ${res.statusText}`);
    }

    const raw: PolymarketApiMarket[] = await res.json();
    const results: PolymarketMarket[] = [];

    for (const m of raw) {
      // Only binary markets
      let outcomes: string[];
      try {
        outcomes = JSON.parse(m.outcomes);
      } catch {
        continue;
      }
      if (outcomes.length !== 2) continue;

      let prices: string[];
      try {
        prices = JSON.parse(m.outcomePrices);
      } catch {
        continue;
      }
      if (prices.length !== 2) continue;

      const yesPrice = parseFloat(prices[0]);
      const noPrice = parseFloat(prices[1]);
      if (isNaN(yesPrice) || isNaN(noPrice)) continue;

      // Need token IDs for order placement
      if (!m.tokens || m.tokens.length < 2) continue;
      const yesToken = m.tokens.find(t => t.outcome === "Yes");
      const noToken = m.tokens.find(t => t.outcome === "No");
      if (!yesToken || !noToken) continue;

      // Filter by volume and liquidity
      if (m.volume24hr < config.polyMinVolume24hr) continue;
      if (m.liquidityNum < config.polyMinLiquidity) continue;

      // Filter: endDate within 7 days
      const endDate = new Date(m.endDate);
      if (isNaN(endDate.getTime())) continue;
      const msUntilEnd = endDate.getTime() - Date.now();
      if (msUntilEnd < 0 || msUntilEnd > 7 * 24 * 60 * 60 * 1000) continue;

      results.push({
        conditionId: m.condition_id,
        question: m.question,
        slug: m.market_slug,
        yesPrice,
        noPrice,
        yesTokenId: yesToken.token_id,
        noTokenId: noToken.token_id,
        volume24hr: m.volume24hr,
        liquidity: m.liquidityNum,
        endDate,
      });
    }

    return results;
  } finally {
    clearTimeout(timeout);
  }
}

export function filterPolymarketMarkets(
  markets: PolymarketMarket[],
): PolymarketMarket[] {
  return markets
    .filter(m => m.yesPrice >= 0.05 && m.yesPrice <= 0.95)
    .sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
}

// === Orderbook & Slippage ===

const CLOB_API = "https://clob.polymarket.com";

interface BookLevel {
  price: string;
  size: string;  // shares
}

interface OrderBookResponse {
  bids: BookLevel[];
  asks: BookLevel[];
}

export async function fetchOrderBook(tokenId: string): Promise<OrderBookResponse> {
  const url = `${CLOB_API}/book?token_id=${tokenId}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "manifold-farmer/1.0" },
    });
    if (!res.ok) throw new Error(`CLOB book ${res.status}`);
    return await res.json() as OrderBookResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sweep the ask side to calculate the effective average fill price for a BUY
 * of `usdcAmount`. Returns null if there isn't enough depth to fill.
 * OrderSummary size is in shares; price is USDC per share.
 */
export function effectiveBuyPrice(
  asks: BookLevel[],
  usdcAmount: number,
): number | null {
  const sorted = [...asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

  let remaining = usdcAmount;
  let totalShares = 0;

  for (const level of sorted) {
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    if (isNaN(price) || isNaN(size) || price <= 0) continue;

    const capacityUsdc = price * size;
    if (remaining <= capacityUsdc) {
      totalShares += remaining / price;
      remaining = 0;
      break;
    } else {
      totalShares += size;
      remaining -= capacityUsdc;
    }
  }

  if (remaining > 0 || totalShares === 0) return null;
  return usdcAmount / totalShares;
}

/**
 * Fetch both token orderbooks in parallel and return updated markets with
 * effective fill prices replacing the quoted prices.
 * Markets where neither side can fill `usdcAmount` are dropped.
 */
export async function enrichWithEffectivePrices(
  markets: PolymarketMarket[],
  usdcAmount: number,
): Promise<PolymarketMarket[]> {
  const results = await Promise.all(
    markets.map(async (m): Promise<PolymarketMarket | null> => {
      try {
        const [yesBook, noBook] = await Promise.all([
          fetchOrderBook(m.yesTokenId),
          fetchOrderBook(m.noTokenId),
        ]);

        const yesEffective = effectiveBuyPrice(yesBook.asks, usdcAmount);
        const noEffective = effectiveBuyPrice(noBook.asks, usdcAmount);

        // Drop the market if neither side has enough depth to fill
        if (yesEffective === null && noEffective === null) return null;

        return {
          ...m,
          yesPrice: yesEffective ?? m.yesPrice,
          noPrice: noEffective ?? m.noPrice,
        };
      } catch {
        // On book fetch failure, keep original prices rather than dropping
        return m;
      }
    })
  );

  return results.filter((m): m is PolymarketMarket => m !== null);
}

// === Trading (CLOB API, auth required) ===

let cachedCreds: ApiKeyCreds | undefined;

export async function createClobClient(config: Config): Promise<ClobClient> {
  if (!config.polyPrivateKey) {
    throw new Error("POLY_PRIVATE_KEY is required for Polymarket trading");
  }

  const wallet = new Wallet(config.polyPrivateKey);

  const client = new ClobClient(
    "https://clob.polymarket.com",
    Chain.POLYGON,
    wallet,
    cachedCreds,
    config.polySignatureType,
    config.polyFunderAddress,
  );

  // Derive API creds on first call
  if (!cachedCreds) {
    cachedCreds = await client.deriveApiKey();
  }

  return new ClobClient(
    "https://clob.polymarket.com",
    Chain.POLYGON,
    wallet,
    cachedCreds,
    config.polySignatureType,
    config.polyFunderAddress,
  );
}

export async function placePolyOrder(
  client: ClobClient,
  tokenId: string,
  side: "BUY" | "SELL",
  amount: number,
  price: number,
): Promise<{ orderId: string; status: string } | { error: string }> {
  try {
    const result = await client.createAndPostMarketOrder(
      {
        tokenID: tokenId,
        amount,
        price,
        side: side === "BUY" ? Side.BUY : Side.SELL,
      },
      undefined,
      OrderType.FOK,
    );

    if (result?.orderID) {
      return { orderId: result.orderID, status: result.status ?? "filled" };
    }

    // FOK order may not fill — that's expected
    return { orderId: result?.orderID ?? "no-fill", status: result?.status ?? "no-fill" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}

// === Position Checking ===

export interface PolyPosition {
  conditionId: string;
  size: number;
  avgPrice: number;
  currentValue: number;
}

export async function getPolyPositions(walletAddress: string): Promise<PolyPosition[]> {
  const url = `https://data-api.polymarket.com/positions?user=${walletAddress}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "manifold-farmer/1.0" },
    });

    if (!res.ok) return [];

    const data: Array<{
      conditionId: string;
      size: string;
      avgPrice: string;
      currentValue: string;
    }> = await res.json();

    return data.map(p => ({
      conditionId: p.conditionId,
      size: parseFloat(p.size) || 0,
      avgPrice: parseFloat(p.avgPrice) || 0,
      currentValue: parseFloat(p.currentValue) || 0,
    }));
  } finally {
    clearTimeout(timeout);
  }
}
