import Anthropic from "@anthropic-ai/sdk";
import type { Config, ManifoldMarket, ClaudeEstimate } from "./types.js";
import { fetchFinanceContext } from "./finance-tool.js";
import { fetchSportsContext } from "./sports-tool.js";

const SYSTEM_PROMPT = `You are an expert superforecaster trained in the methodology of Philip Tetlock's Good Judgment Project. Your task is to estimate the probability that a prediction market question resolves YES.

## Your Process

1. **Identify the reference class** — What broad category does this event belong to? How often do similar events happen?
2. **Start with the base rate** (outside view) — What's the historical frequency for this type of event?
3. **Adjust with specifics** (inside view) — What makes this particular case different from the average?
4. **Look for clashing causal forces** — What pushes toward YES? What pushes toward NO?
5. **Decompose if complex** — Break into sub-questions and estimate each component
6. **Calibrate your confidence** — 50% means genuine uncertainty, 90%+ means you'd be shocked if wrong

## Calibration Guidelines

- 50%: "I genuinely don't know"
- 60-70%: "Leaning one way, but substantial uncertainty"
- 80-90%: "Pretty confident, but surprises possible"
- 95%+: "Would be genuinely shocked if wrong" (use rarely!)
- Avoid extreme probabilities (below 5% or above 95%) unless the evidence is overwhelming

## Critical Rules

- Do NOT anchor to any market price. Form your estimate independently.
- Consider base rates before specific details.
- Think about the strongest argument AGAINST your position.
- Be honest about your uncertainty — don't pretend to know more than you do.

## Output Format

Respond with ONLY a JSON object (no markdown, no code fences):
{"probability": 0.XX, "confidence": "low|medium|high", "reasoning": "Your 2-3 sentence reasoning"}`;

export async function estimateProbability(
  config: Config,
  market: ManifoldMarket,
  calibrationFeedback?: string
): Promise<ClaudeEstimate> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  // Extract text description, handling various formats
  let description = "";
  if (market.textDescription) {
    description = market.textDescription;
  } else if (typeof market.description === "string") {
    description = market.description;
  } else if (market.description && typeof market.description === "object") {
    // Manifold uses TipTap JSON format — extract text nodes
    description = extractText(market.description);
  }

  let systemPrompt = SYSTEM_PROMPT;
  if (calibrationFeedback) {
    systemPrompt += "\n\n" + calibrationFeedback;
  }

  // Fetch real-time data from tools
  let dataContext = "";
  const [financeCtx, sportsCtx] = await Promise.all([
    fetchFinanceContext(market.question).catch(() => null),
    fetchSportsContext(market.question).catch(() => null),
  ]);
  if (financeCtx) dataContext += "\n\n" + financeCtx;
  if (sportsCtx) dataContext += "\n\n" + sportsCtx;

  const userPrompt = `Estimate the probability that this question resolves YES:

**Question:** ${market.question}

${description ? `**Description/Context:** ${description.slice(0, 3000)}` : ""}

**Created by:** ${market.creatorUsername}
**Market closes:** ${new Date(market.closeTime).toISOString().split("T")[0]}
**Today's date:** ${new Date().toISOString().split("T")[0]}
${dataContext}
Respond with ONLY a JSON object: {"probability": 0.XX, "confidence": "low|medium|high", "reasoning": "..."}`;

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  if (!text) {
    throw new Error(`Empty response from Claude for market: ${market.id}`);
  }

  return parseEstimate(text);
}

function parseEstimate(text: string): ClaudeEstimate {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse Claude response as JSON: ${text.slice(0, 200)}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`Malformed JSON in Claude response: ${jsonMatch[0].slice(0, 200)}`);
  }

  const prob = Number(parsed.probability);
  if (isNaN(prob) || prob < 0 || prob > 1) {
    throw new Error(`Invalid probability: ${parsed.probability}`);
  }

  const confidence = String(parsed.confidence ?? "");
  if (!["low", "medium", "high"].includes(confidence)) {
    throw new Error(`Invalid confidence: ${confidence}`);
  }

  return {
    probability: prob,
    confidence: confidence as ClaudeEstimate["confidence"],
    reasoning: String(parsed.reasoning || ""),
  };
}

function extractText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    return n.content.map(extractText).join(" ");
  }
  return "";
}
