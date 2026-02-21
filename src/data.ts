import { readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, "..", "data");
export const DECISIONS_FILE = join(DATA_DIR, "decisions.jsonl");
export const TRADES_FILE = join(DATA_DIR, "trades.jsonl");
export const RESOLUTIONS_FILE = join(DATA_DIR, "resolutions.jsonl");

mkdirSync(DATA_DIR, { recursive: true });

export function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line) as T);
}
