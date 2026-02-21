import { loadConfig } from "./config.js";
import { getMarket } from "./manifold.js";

// Markets I can likely form informed opinions on
const IDS = [
  "UgQuzSqAtg",  // earthquake 5+ in 24h
  "5lQIsyOLgS",  // Microsoft Majorana qubit
  "8A0ASuCLN2",  // UK solar Saturday vs Friday
  "UtsOQ8yz6l",  // Magic beat Suns
  "cdp6SEEg0Z",  // 76ers beat Pelicans
  "ysunAU9ZuZ",  // Strickland beat Hernandez
  "Rudls6lRu5",  // Hernandez beat Strickland by sub
  "lzOdh2y005",  // Cavs beat Thunder
  "UQSUhcqOq5",  // Nuggets beat Warriors
  "u8pCzd6ZOc",  // Raptors beat Bucks
  "LEALz8zsZO",  // Celtics beat Lakers
  "S6ItCSyttE",  // ICE agents consequences
  "U6hpSdEyzl",  // US govt go after ICE victim family
  "dhutplcugE",  // Nvidia stock Feb > Jan
  "RtpP6gRuy0",  // Elon open source Grok 3
  "d2Rc2Cd9gt",  // new Gemini+Claude+GPT+Grok this week
  "RdNtDiR9mBxmSSj27BLt",  // Z-Library online
  "lEtdlI0lcO",  // Ukrainian athlete win race Olympics
  "EzOnELn2Ol",  // Ukraine win medal Olympics
  "RqE2zPh5zs",  // Norway most medals
  "qRL0gqpRL8",  // country other than Norway most golds
  "Egchsq6ChS",  // China more golds than USA
  "zpzy6p59nR",  // ICE incident at Olympics
  "puIO9tcgdO",  // Nvidia Q4 > $67B
  "LNPQz0OlUI",  // Nvidia Q4 > $65B
  "IgsppSzZ8O",  // Democrat distraction at SOTU
  "0gy5o8mr6s",  // Trump convictions overturned
  "6Ymg3Bcox6drzU230YMa",  // Andrew Tate guilty
  "zLn2tpCZRu",  // US-Iran agreement
  "zgpsAu5ts0",  // govt agent kill citizen before Feb 28
  "s92PSpZlus",  // Trump invade Greenland
  "sgzpU5tCRN",  // ICE at Olympics
  "CczuqztSnL",  // Gold above $5000
  "66SgPntg8g",  // Trump N-word SOTU
  "NNP968EZII",  // Russia invade Finland/Norway
  "6Ndqlu0g2z",  // Trump pardon Mangione
  "n59qp9usU5",  // S&P above 7000 March 2
  "tUStPOynIU",  // Biden attends former president funeral
  "Z2z22uUCL8",  // #QuantumComputing trend on X
  "NdntyEh6Zl",  // Al Green make a scene
  "Ncy9OQ2dS0",  // MrBeast 500k subs/day
  "QOyPINEUz0",  // Spurs beat Pistons
  "6ctz0dpuOI",  // Mbappe 25 goals before Feb 25
  "uZpnqOOLps",  // famous person bet on market
];

async function main() {
  const config = loadConfig();
  const results = [];

  for (const id of IDS) {
    try {
      const m = await getMarket(config.manifoldApiKey, id);
      let desc = "";
      if (m.textDescription) desc = m.textDescription;
      else if (typeof m.description === "string") desc = m.description;

      results.push({
        id: m.id,
        question: m.question,
        probability: m.probability,
        closeTime: new Date(m.closeTime).toISOString().split("T")[0],
        totalLiquidity: m.totalLiquidity,
        uniqueBettorCount: m.uniqueBettorCount,
        description: desc?.slice(0, 800) || "(none)",
      });
    } catch (e) {
      console.error(`Failed ${id}: ${e}`);
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main();
