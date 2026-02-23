/**
 * Sports data tool — fetches current odds and game info from ESPN
 * to enrich Claude's analysis of sports markets.
 */

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_ODDS = "https://sports.core.api.espn.com/v2/sports";
const FETCH_TIMEOUT_MS = 15_000;

interface SportConfig {
  pattern: RegExp;
  espnSport: string;
  espnLeague: string;
}

const SPORT_CONFIGS: SportConfig[] = [
  { pattern: /\bnba\b/i, espnSport: "basketball", espnLeague: "nba" },
  { pattern: /\bnfl\b/i, espnSport: "football", espnLeague: "nfl" },
  { pattern: /\bmlb\b/i, espnSport: "baseball", espnLeague: "mlb" },
  { pattern: /\bnhl\b/i, espnSport: "hockey", espnLeague: "nhl" },
  { pattern: /\bpremier league\b|\bepl\b/i, espnSport: "soccer", espnLeague: "eng.1" },
  { pattern: /\bchampions league\b|\bucl\b/i, espnSport: "soccer", espnLeague: "uefa.champions" },
  { pattern: /\bufc\b|\bmma\b/i, espnSport: "mma", espnLeague: "ufc" },
];

// Common team name aliases
const TEAM_ALIASES: Record<string, string[]> = {
  "Los Angeles Lakers": ["lakers", "lal"],
  "Boston Celtics": ["celtics", "bos"],
  "Golden State Warriors": ["warriors", "gsw"],
  "Denver Nuggets": ["nuggets", "den"],
  "Milwaukee Bucks": ["bucks", "mil"],
  "Toronto Raptors": ["raptors", "tor"],
  "Philadelphia 76ers": ["76ers", "sixers", "phi"],
  "New Orleans Pelicans": ["pelicans", "nop"],
  "Phoenix Suns": ["suns", "phx"],
  "Orlando Magic": ["magic", "orl"],
  "Oklahoma City Thunder": ["thunder", "okc"],
  "Cleveland Cavaliers": ["cavaliers", "cavs", "cle"],
  "San Antonio Spurs": ["spurs", "sas"],
  "Detroit Pistons": ["pistons", "det"],
};

function findTeamInQuestion(question: string): string[] {
  const q = question.toLowerCase();
  const found: string[] = [];
  for (const [fullName, aliases] of Object.entries(TEAM_ALIASES)) {
    for (const alias of aliases) {
      if (q.includes(alias)) {
        found.push(fullName);
        break;
      }
    }
  }
  return found;
}

interface ESPNEvent {
  id: string;
  name: string;
  date: string;
  status: { type: { state: string; description: string } };
  competitions: {
    id: string;
    competitors: {
      homeAway: string;
      team: { displayName: string; abbreviation: string };
      score?: string;
      records?: { summary: string }[];
      curatedRank?: { current: number };
    }[];
    odds?: { details: string; overUnder: number }[];
  }[];
}

interface ESPNOddsItem {
  provider: { name: string };
  details?: string;
  overUnder?: number;
  spread?: number;
  homeTeamOdds?: {
    moneyLine?: number;
    spreadOdds?: number;
    pointSpread?: number;
    favorite?: boolean;
  };
  awayTeamOdds?: {
    moneyLine?: number;
    spreadOdds?: number;
    pointSpread?: number;
    favorite?: boolean;
  };
}

/**
 * Check if a market question is sports-related and return enrichment context.
 */
export async function fetchSportsContext(question: string): Promise<string | null> {
  for (const config of SPORT_CONFIGS) {
    if (!config.pattern.test(question)) continue;

    // Extract date from question (e.g., "Feb 22", "February 22")
    const dateMatch = question.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{1,2})/i);
    let dateStr: string | undefined;
    if (dateMatch) {
      const monthStr = dateMatch[0].slice(0, 3).toLowerCase();
      const months: Record<string, string> = {
        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
        jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
      };
      const month = months[monthStr];
      const day = dateMatch[1]!.padStart(2, "0");
      const year = new Date().getFullYear();
      dateStr = `${year}${month}${day}`;
    }

    const events = await fetchScoreboard(config, dateStr);
    if (!events || events.length === 0) continue;

    // Find the specific game mentioned
    const teamsInQuestion = findTeamInQuestion(question);
    let matchedEvent: ESPNEvent | undefined;

    if (teamsInQuestion.length > 0) {
      matchedEvent = events.find((e) => {
        const eventTeams = e.competitions[0]?.competitors.map((c) => c.team.displayName) ?? [];
        return teamsInQuestion.some((t) => eventTeams.includes(t));
      });
    }

    if (!matchedEvent && events.length === 1) {
      matchedEvent = events[0];
    }

    if (!matchedEvent) {
      // Return general schedule context
      const lines = events.slice(0, 5).map((e) => {
        const comp = e.competitions[0];
        const away = comp?.competitors.find((c) => c.homeAway === "away");
        const home = comp?.competitors.find((c) => c.homeAway === "home");
        const odds = comp?.odds?.[0];
        return `- ${away?.team.displayName} @ ${home?.team.displayName} — ${e.status.type.description}${odds ? ` (${odds.details}, O/U ${odds.overUnder})` : ""}`;
      });
      return `## Sports Data (${config.espnLeague.toUpperCase()})\n${lines.join("\n")}`;
    }

    // Build detailed context for the matched game
    return await buildGameContext(config, matchedEvent);
  }

  return null;
}

async function fetchScoreboard(config: SportConfig, dateStr?: string): Promise<ESPNEvent[] | null> {
  try {
    let url = `${ESPN_SCOREBOARD}/${config.espnSport}/${config.espnLeague}/scoreboard`;
    if (dateStr) url += `?dates=${dateStr}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { events?: ESPNEvent[] };
    return data.events ?? null;
  } catch {
    return null;
  }
}

async function buildGameContext(config: SportConfig, event: ESPNEvent): Promise<string> {
  const comp = event.competitions[0]!;
  const away = comp.competitors.find((c) => c.homeAway === "away")!;
  const home = comp.competitors.find((c) => c.homeAway === "home")!;

  const lines: string[] = [];
  lines.push(`## Sports Data: ${away.team.displayName} @ ${home.team.displayName}`);
  lines.push(`- **Status**: ${event.status.type.description}`);
  lines.push(`- **Date**: ${new Date(event.date).toLocaleString()}`);

  // Records
  const awayRecord = away.records?.[0]?.summary;
  const homeRecord = home.records?.[0]?.summary;
  if (awayRecord || homeRecord) {
    lines.push(`- **Records**: ${away.team.displayName} (${awayRecord ?? "?"}) vs ${home.team.displayName} (${homeRecord ?? "?"})`);
  }

  // Scores if in-progress or completed
  if (event.status.type.state !== "pre") {
    lines.push(`- **Score**: ${away.team.displayName} ${away.score ?? "?"} - ${home.team.displayName} ${home.score ?? "?"}`);
  }

  // Fetch detailed odds
  const odds = await fetchOdds(config, event.id);
  if (odds && odds.length > 0) {
    for (const odd of odds.slice(0, 2)) {
      const provider = odd.provider.name;
      const awayML = odd.awayTeamOdds?.moneyLine;
      const homeML = odd.homeTeamOdds?.moneyLine;
      const spread = odd.details ?? `${odd.homeTeamOdds?.pointSpread}`;
      const ou = odd.overUnder;

      lines.push(`- **Odds (${provider})**: ${away.team.displayName} ${awayML ? formatML(awayML) : "?"} / ${home.team.displayName} ${homeML ? formatML(homeML) : "?"} | Spread: ${spread} | O/U: ${ou ?? "?"}`);

      // Convert moneyline to implied probability
      if (awayML && homeML) {
        const awayImplied = mlToProb(awayML);
        const homeImplied = mlToProb(homeML);
        lines.push(`- **Implied Win%**: ${away.team.displayName} ${(awayImplied * 100).toFixed(1)}% / ${home.team.displayName} ${(homeImplied * 100).toFixed(1)}% (before vig)`);
      }
    }
  }

  return lines.join("\n");
}

async function fetchOdds(config: SportConfig, eventId: string): Promise<ESPNOddsItem[] | null> {
  try {
    const url = `${ESPN_ODDS}/${config.espnSport}/leagues/${config.espnLeague}/events/${eventId}/competitions/${eventId}/odds?lang=en&region=us`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { items?: ESPNOddsItem[] };
    return data.items ?? null;
  } catch {
    return null;
  }
}

function formatML(ml: number): string {
  return ml > 0 ? `+${ml}` : String(ml);
}

function mlToProb(ml: number): number {
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

/**
 * Returns true if the question matches any sports pattern.
 */
export function isSportsMarket(question: string): boolean {
  return SPORT_CONFIGS.some((c) => c.pattern.test(question));
}
