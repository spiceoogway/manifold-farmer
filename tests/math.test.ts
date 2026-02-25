import { strict as assert } from "node:assert";
import { test } from "node:test";

// We test pure functions by importing them directly.
// Run with: node --import tsx/esm --test tests/math.test.ts

import { computeWon, computeRealizedPnl, computeUnrealizedPnl, computeMaxPayout } from "../src/pnl.js";

test("computeWon YES/NO binary", () => {
  assert.equal(computeWon("YES", "YES", 1), true);
  assert.equal(computeWon("YES", "NO", 0), false);
  assert.equal(computeWon("NO", "NO", 0), true);
  assert.equal(computeWon("NO", "YES", 1), false);
});

test("computeWon MKT resolution", () => {
  assert.equal(computeWon("YES", "MKT", 0.8), true);
  assert.equal(computeWon("YES", "MKT", 0.3), false);
  assert.equal(computeWon("NO", "MKT", 0.2), true);
  assert.equal(computeWon("NO", "MKT", 0.7), false);
});

test("computeRealizedPnl won YES with shares", () => {
  // Bought 100 YES shares for $50, market resolves YES → profit = 100 - 50 = 50
  const pnl = computeRealizedPnl("YES", 50, 0.5, "YES", true, 100);
  assert.equal(pnl, 50);
});

test("computeRealizedPnl lost YES with shares", () => {
  // Bought 100 YES shares for $50, market resolves NO → loss = -50
  const pnl = computeRealizedPnl("YES", 50, 0.5, "NO", false, 100);
  assert.equal(pnl, -50);
});

test("computeRealizedPnl won NO with shares", () => {
  // Bought 100 NO shares for $50, market resolves NO → profit = 100 - 50 = 50
  const pnl = computeRealizedPnl("NO", 50, 0.5, "NO", true, 100);
  assert.equal(pnl, 50);
});

test("computeRealizedPnl approximation without shares", () => {
  // Bought YES at 25%, $25 bet. Resolves YES. Payout ≈ 25 * (1-0.25)/0.25 = 75. PnL = 75
  const pnl = computeRealizedPnl("YES", 25, 0.25, "YES", true);
  assert.equal(pnl, 75);
});

test("computeUnrealizedPnl with shares", () => {
  // 100 YES shares, paid $50 (50¢/share). Current prob 0.7 → value = 70. PnL = 20
  const pnl = computeUnrealizedPnl("YES", 50, 0.5, 0.7, 100);
  assert.equal(pnl, 20);
});

test("computeMaxPayout with shares", () => {
  // 100 shares at cost $50. Max = 100 - 50 = 50
  const max = computeMaxPayout("YES", 50, 0.5, 100);
  assert.equal(max, 50);
});
