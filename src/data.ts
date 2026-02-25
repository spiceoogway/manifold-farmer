import { readFileSync, mkdirSync, existsSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
export const DECISIONS_FILE = join(DATA_DIR, "decisions.jsonl");
export const TRADES_FILE = join(DATA_DIR, "trades.jsonl");
export const RESOLUTIONS_FILE = join(DATA_DIR, "resolutions.jsonl");
export const SNAPSHOTS_FILE = join(DATA_DIR, "snapshots.jsonl");

mkdirSync(DATA_DIR, { recursive: true });

export function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  const results: T[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed) as T);
    } catch {
      process.stderr.write(`Warning: skipping malformed JSONL line in ${filePath}\n`);
    }
  }
  return results;
}

export function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
}
