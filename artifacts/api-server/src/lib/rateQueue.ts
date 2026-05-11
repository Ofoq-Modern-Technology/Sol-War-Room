/**
 * Shared Jupiter API rate limiter — all bots on this server use one pool.
 * Uses a sliding window so the budget is shared fairly across bots.
 *
 * Default: 8 req/s (480/min) — comfortably under Jupiter free-tier ~600/min
 * and leaves headroom for burst retries.
 * Set JUPITER_RPS env var to override (e.g. 20 for paid Metis tier).
 */

import { jupiterFetch } from "./solana.js";

const MAX_RPS = parseInt(process.env["JUPITER_RPS"] ?? "8", 10);
const WINDOW_MS = 1000;

const requestTimestamps: number[] = [];

async function acquireSlot(): Promise<void> {
  while (true) {
    const now = Date.now();
    // Drop timestamps older than the sliding window
    while (requestTimestamps.length > 0 && requestTimestamps[0]! < now - WINDOW_MS) {
      requestTimestamps.shift();
    }
    if (requestTimestamps.length < MAX_RPS) {
      requestTimestamps.push(now);
      return;
    }
    // Wait until the oldest slot expires
    const oldest = requestTimestamps[0]!;
    const waitMs = WINDOW_MS - (now - oldest) + 5;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export async function rateLimitedJupiterFetch(
  url: string,
  init?: RequestInit,
  apiKey?: string | null,
): Promise<Response> {
  await acquireSlot();
  return jupiterFetch(url, init, apiKey);
}

/** Current queue depth — for diagnostics / logging */
export function queueDepth(): number {
  const now = Date.now();
  return requestTimestamps.filter((t) => t >= now - WINDOW_MS).length;
}
