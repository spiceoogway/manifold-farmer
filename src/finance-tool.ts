/**
 * Finance data tool — fetches real-time stock prices and commodity prices
 * via Yahoo Finance v8 chart API (no auth required) to enrich Claude's
 * analysis of finance markets.
 */

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const FETCH_TIMEOUT_MS = 15_000;

// Patterns that indicate a finance-related market
const FINANCE_PATTERNS: { pattern: RegExp; symbols?: string[]; type: string }[] = [
  { pattern: /\bnvda\b|nvidia/i, symbols: ["NVDA"], type: "stock" },
  { pattern: /\baapl\b|apple.*stock/i, symbols: ["AAPL"], type: "stock" },
  { pattern: /\btsla\b|tesla.*stock/i, symbols: ["TSLA"], type: "stock" },
  { pattern: /\bmeta\b.*stock|meta platforms/i, symbols: ["META"], type: "stock" },
  { pattern: /\bgoogl?\b|alphabet.*stock/i, symbols: ["GOOGL"], type: "stock" },
  { pattern: /\bmsft\b|microsoft.*stock/i, symbols: ["MSFT"], type: "stock" },
  { pattern: /\bamzn\b|amazon.*stock/i, symbols: ["AMZN"], type: "stock" },
  { pattern: /s&p.?500|sp500|\^gspc/i, symbols: ["^GSPC", "SPY"], type: "index" },
  { pattern: /nasdaq|qqq/i, symbols: ["^IXIC", "QQQ"], type: "index" },
  { pattern: /dow jones|djia/i, symbols: ["^DJI", "DIA"], type: "index" },
  { pattern: /\bgold\b.*(?:price|above|below|\$)/i, symbols: ["GC=F"], type: "gold" },
  { pattern: /\bearning|revenue|eps\b/i, type: "earnings" },
  { pattern: /\bstock\b.*(?:close|higher|lower|above|below)/i, type: "stock_generic" },
  { pattern: /\b(?:interest rate|fed\b|federal reserve|inflation|gdp|recession|tariff)\b/i, type: "macro" },
];

interface ChartMeta {
  currency: string;
  symbol: string;
  regularMarketPrice: number;
  chartPreviousClose: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketVolume: number;
  shortName?: string;
  longName?: string;
}

/**
 * Check if a market question is finance-related and return enrichment context.
 */
export async function fetchFinanceContext(question: string): Promise<string | null> {
  const symbolsToFetch = new Set<string>();

  for (const rule of FINANCE_PATTERNS) {
    if (!rule.pattern.test(question)) continue;

    if (rule.symbols) {
      for (const s of rule.symbols) symbolsToFetch.add(s);
    }

    if (rule.type === "earnings" || rule.type === "stock_generic") {
      const symbolMatch = question.match(/\b([A-Z]{2,5})\b/g);
      if (symbolMatch) {
        const known = ["NVDA", "AAPL", "TSLA", "META", "GOOGL", "MSFT", "AMZN", "AMD", "INTC", "NFLX", "GOOG"];
        for (const s of symbolMatch) {
          if (known.includes(s)) symbolsToFetch.add(s);
        }
      }
    }
  }

  if (symbolsToFetch.size === 0) return null;

  const quotes = await Promise.all(
    [...symbolsToFetch].map((s) => fetchChartQuote(s))
  );

  const lines = quotes.filter((q): q is string => q !== null);
  if (lines.length === 0) return null;

  return `## Real-Time Financial Data\n${lines.join("\n")}`;
}

async function fetchChartQuote(symbol: string): Promise<string | null> {
  try {
    const url = `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      chart?: { result?: { meta: ChartMeta }[] };
    };

    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose;
    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    const changeSign = change >= 0 ? "+" : "";
    const name = meta.shortName ?? meta.longName ?? symbol;

    return (
      `- **${symbol}** (${name}): $${price.toFixed(2)} ` +
      `(${changeSign}${changePct.toFixed(2)}% today)` +
      ` | Day: $${meta.regularMarketDayLow.toFixed(2)}-$${meta.regularMarketDayHigh.toFixed(2)}` +
      ` | 52w: $${meta.fiftyTwoWeekLow.toFixed(0)}-$${meta.fiftyTwoWeekHigh.toFixed(0)}`
    );
  } catch {
    return null;
  }
}

/**
 * Returns true if the question matches any finance pattern.
 */
export function isFinanceMarket(question: string): boolean {
  return FINANCE_PATTERNS.some((r) => r.pattern.test(question));
}
