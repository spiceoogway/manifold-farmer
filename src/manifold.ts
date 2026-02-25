import type { ManifoldUser, ManifoldMarket, BetResponse } from "./types.js";
import { withRetry } from "./utils.js";

const BASE = "https://api.manifold.markets/v0";
const FETCH_TIMEOUT_MS = 30_000;

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

  let res: Response;
  try {
    res = await withRetry(() => fetch(url.toString(), {
      headers: { Authorization: `Key ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }), 3, 1000);
  } catch (err) {
    throw new Error(`Manifold API ${path}: network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable body)");
    throw new Error(`Manifold API ${path}: ${res.status} ${body}`);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`Manifold API ${path}: invalid JSON response`);
  }
}

async function manifoldPost<T>(
  path: string,
  apiKey: string,
  body: unknown
): Promise<T> {
  await rateLimit();

  let res: Response;
  try {
    res = await withRetry(() => fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }), 3, 1000);
  } catch (err) {
    throw new Error(`Manifold API POST ${path}: network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable body)");
    throw new Error(`Manifold API POST ${path}: ${res.status} ${body}`);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`Manifold API POST ${path}: invalid JSON response`);
  }
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

export async function sellShares(
  apiKey: string,
  marketId: string,
  outcome: "YES" | "NO"
): Promise<unknown> {
  return manifoldPost(`/market/${marketId}/sell`, apiKey, { outcome });
}
