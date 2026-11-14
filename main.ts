// polymarket-faa-attribution-02 entry (Node 22, standard library only).
//
// Forecast: for each market, the median is its last price (prediction-market
// prices are near-martingales: on the practice data, trend-following drift
// and smoothed anchors both made the median WORSE, so the median stays the
// last tick), and the spread is a per-market volatility estimate that widens
// like a random walk:
//
//   q_tau(h) = clamp(x + z_tau * sigma * sqrt(h), 0, 1), rounded to 6 decimals
//
// What makes this beat the house baseline (fixed sigma 0.0025 for every
// market) is how sigma is measured. Polymarket minute prices move in steps:
// most minutes do not move at all, then a tick, now and then a jump. A
// standard deviation or RMS over the history is dominated by the rare huge
// moves (on the practice it scored WORSE than the baseline), and a median
// absolute move misses the jumps entirely. So sigma is the average of two
// robust upper quantiles of the absolute 1-minute returns, each rescaled to
// a normal-consistent sigma:
//
//   sigma = 0.5 * ( Q90(|r|, last 240 min) / 1.64485
//                 + Q80(|r|, last 720 min) / 1.28155 )
//
// The short window tracks the market's current regime; the long window
// stabilises the estimate. The blend of the two beat either alone on the
// practice. Sigma is floored at max(0.0005, 0.006 * x): most markets are
// dead-quiet over any 4-hour window (their Q90 is exactly 0), yet they do
// jump, so a dead market still gets a nonzero spread, and the floor scales
// with the price level because higher-priced markets move in bigger absolute
// steps. Sigma is capped at 0.05 as a safety valve for wild markets.
//
// Tuned on the kit's six practice cases only through this local scorer
// (practice answers recovered from the cases' own overlapping windows plus
// Polymarket's public history for the last case; the scorer reproduces the
// house baseline's published practice loss of 0.363589 exactly, so the
// numbers below are on the same scale):
//
//   house baseline (fixed 0.0025) ............ 0.363589
//   this entry ............................... 0.280554
//   (90% coverage 0.898, median error 0.768)
//
// Deliberately NOT used, each tested and rejected on the practice:
// drift from the recent trend, anchor smoothing, asymmetric up/down sigmas,
// empirical quantiles of past h-minute moves (their median is biased by the
// early history's one-way collapse), RMS/std volatility, and horizon
// exponents other than sqrt(h). No cross-market structure is used either:
// the final's four FAA markets are independent events, so the practice
// event's sum-to-one structure does not transfer.
//
// Deterministic: no randomness, no clock, no network. Two runs on the same
// case write byte-identical output.
//
// Input:  every <id>.in in $MAKEFUN_INPUT_DIR (else /input), canonical JSON
//         {"schema":"makefun/polymarket-case/v1","case","at","horizon_minutes",
//         "quantiles","event","markets":[{"id","name","slug","yes_token",
//         "start","prices"}]}, prices one per minute from `start` to `at`.
// Output: <id>.out per case, {"forecasts":[{"id","q"}]}, every market once,
//         `q` exactly horizon_minutes rows of the five quantiles in the
//         levels' order, each finite in [0,1] and non-decreasing.
// Run locally: mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level, to 6 decimals. */
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];

/** Short window: the market's current regime, in minutes. */
const SHORT_WINDOW = 240;
/** Long window: stabilises the estimate, in minutes. */
const LONG_WINDOW = 720;
/** |N(0,1)| quantile at 0.90: rescales Q90(|r|) to a normal sigma. */
const Z_Q90 = 1.64485;
/** |N(0,1)| quantile at 0.80: rescales Q80(|r|) to a normal sigma. */
const Z_Q80 = 1.28155;
/** Absolute sigma floor: dead-quiet markets still jump. */
const SIGMA_FLOOR_ABS = 0.0005;
/** Relative sigma floor: higher-priced markets move in bigger steps. */
const SIGMA_FLOOR_REL = 0.006;
/** Sigma cap: a safety valve for wild markets. */
const SIGMA_CAP = 0.05;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

/**
 * Linear-interpolation quantile of a sorted ascending array (the same
 * definition as the prototype that tuned this: position tau*(n-1),
 * interpolated between the bracketing points).
 */
function quantileSorted(sorted: number[], tau: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0] as number;
  const pos = tau * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  const frac = pos - lo;
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
}

/**
 * One robust sigma estimate: the tau-quantile of the absolute 1-minute
 * returns over the last `window` minutes, rescaled by the matching
 * half-normal quantile so it reads as a per-minute normal sigma. Returns 0
 * when the window holds fewer than two prices (the floor then applies).
 */
function quantileSigma(prices: number[], window: number, tau: number, zq: number): number {
  const seg = prices.slice(-window);
  if (seg.length < 2) return 0;
  const absReturns: number[] = [];
  for (let i = 0; i + 1 < seg.length; i++) {
    absReturns.push(Math.abs((seg[i + 1] as number) - (seg[i] as number)));
  }
  absReturns.sort((a, b) => a - b);
  return quantileSorted(absReturns, tau) / zq;
}

/**
 * A market's per-minute sigma: the blend of the short-window Q90 and the
 * long-window Q80 estimates, floored (absolute + price-relative) and capped.
 */
function marketSigma(prices: number[]): number {
  const x = prices[prices.length - 1] as number;
  const shortSigma = quantileSigma(prices, SHORT_WINDOW, 0.9, Z_Q90);
  const longSigma = quantileSigma(prices, LONG_WINDOW, 0.8, Z_Q80);
  const blended = 0.5 * (shortSigma + longSigma);
  const floor = Math.max(SIGMA_FLOOR_ABS, SIGMA_FLOOR_REL * x);
  return Math.min(SIGMA_CAP, Math.max(floor, blended));
}

/** The forecast of one market: horizon rows of the five quantiles. */
function forecast(market: CaseMarket, horizon: number): number[][] {
  if (market.prices.length === 0) throw new Error(`market ${market.id} has no prices`);
  const x = market.prices[market.prices.length - 1] as number;
  const sigma = marketSigma(market.prices);
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const spread = sigma * Math.sqrt(h);
    const row = Z.map((z) => price6(x + z * spread));
    // Keep each row non-decreasing after rounding.
    for (let j = 1; j < row.length; j++) {
      if ((row[j] as number) < (row[j - 1] as number)) row[j] = row[j - 1] as number;
    }
    rows.push(row);
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) {
    throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  }
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
