import type { ManifoldUser, ManifoldMarket, BetResponse } from "./types.js";

const BASE = "https://api.manifold.markets/v0";

// Rate limiter: 450 req/min safety margin (Manifold allows 500)
let requestTimes: number[] = [];
const MAX_REQUESTS_PER_MINUTE = 450;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  requestTimes = requestTimes.filter((t) => now - t < 60_000);
  if (requestTimes.length >= MAX_REQUESTS_PER_MINUTE) {
    const oldest = requestTimes[0]!;
    const waitMs = 60_000 - (now - oldest) + 100;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  requestTimes.push(Date.now());
}

async function manifoldGet<T>(
  path: string,
  apiKey: string,
  params?: Record<string, string>
): Promise<T> {
  await rateLimit();
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Key ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Manifold API ${path}: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function manifoldPost<T>(
  path: string,
  apiKey: string,
  body: unknown
): Promise<T> {
  await rateLimit();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Manifold API POST ${path}: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function getMe(apiKey: string): Promise<ManifoldUser> {
  return manifoldGet<ManifoldUser>("/me", apiKey);
}

export async function searchMarkets(
  apiKey: string,
  limit: number = 50
): Promise<ManifoldMarket[]> {
  return manifoldGet<ManifoldMarket[]>("/search-markets", apiKey, {
    filter: "open",
    contractType: "BINARY",
    sort: "liquidity",
    limit: String(limit),
  });
}

export async function getMarket(
  apiKey: string,
  marketId: string
): Promise<ManifoldMarket> {
  return manifoldGet<ManifoldMarket>(`/market/${marketId}`, apiKey);
}

export async function placeBet(
  apiKey: string,
  marketId: string,
  outcome: "YES" | "NO",
  amount: number
): Promise<BetResponse> {
  return manifoldPost<BetResponse>("/bet", apiKey, {
    contractId: marketId,
    outcome,
    amount: Math.round(amount),
  });
}
