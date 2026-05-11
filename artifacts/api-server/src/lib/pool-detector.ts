import { EventEmitter } from "events";
import WebSocket from "ws";

export interface NewPoolEvent {
  signature: string;
  mintAddress: string;
  dex: "raydium" | "raydium_cpmm" | "pumpfun";
  timestamp: number;
}

// Solana program IDs
const RAYDIUM_AMM_V4  = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const RAYDIUM_CPMM    = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
const PUMPFUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const WSOL            = "So11111111111111111111111111111111111111112";

// Exact Solana program-log instruction patterns per DEX (case-insensitive)
// Solana emits "Program log: Instruction: <Name>" for named anchor instructions
const POOL_INIT_KEYWORDS: Record<string, string[]> = {
  raydium:      ["instruction: initialize2"],
  raydium_cpmm: ["instruction: initialize"],
  pumpfun:      ["instruction: create"],
};

export class PoolDetector extends EventEmitter {
  private ws: WebSocket | null = null;
  private rpcEndpoint: string;
  private wssEndpoint: string;
  private seenSignatures = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private targetDexes: Set<string>;
  private subscriptionOpenedAt = 0; // ms timestamp when WS connected

  // subscription ID → dex mapping for reliable detection
  private subIdToDex = new Map<number, "raydium" | "raydium_cpmm" | "pumpfun">();
  private nextSubId = 1;

  constructor(rpcEndpoint: string, heliusApiKey: string | null | undefined, targetDexes: string[]) {
    super();
    this.targetDexes = new Set(targetDexes);

    if (heliusApiKey) {
      this.rpcEndpoint = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
      this.wssEndpoint = `wss://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
    } else {
      this.rpcEndpoint = rpcEndpoint || "https://api.mainnet-beta.solana.com";
      this.wssEndpoint = "wss://api.mainnet-beta.solana.com";
    }
  }

  connect() {
    this.stopped = false;
    this._connect();
  }

  private _connect() {
    if (this.stopped) return;
    console.log("[pool-detector] connecting to WSS:", this.wssEndpoint.replace(/api-key=\S+/, "api-key=***"));

    this.ws = new WebSocket(this.wssEndpoint);
    this.subIdToDex.clear();
    this.nextSubId = 1;

    this.ws.on("open", () => {
      this.subscriptionOpenedAt = Date.now();
      console.log("[pool-detector] connected");

      const subscribe = (programId: string, dex: "raydium" | "raydium_cpmm" | "pumpfun") => {
        const id = this.nextSubId++;
        this.subIdToDex.set(id, dex);
        this.ws!.send(JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "logsSubscribe",
          params: [{ mentions: [programId] }, { commitment: "confirmed" }],
        }));
      };

      if (this.targetDexes.has("raydium"))      subscribe(RAYDIUM_AMM_V4,  "raydium");
      if (this.targetDexes.has("raydium_cpmm")) subscribe(RAYDIUM_CPMM,    "raydium_cpmm");
      if (this.targetDexes.has("pumpfun"))      subscribe(PUMPFUN_PROGRAM, "pumpfun");
    });

    this.ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          method?: string;
          id?: number;
          result?: number; // subscription confirmation gives subscription ID as result
          params?: {
            result: { value: { signature: string; logs: string[]; err: unknown } };
            subscription: number;
          };
        };

        // When the server confirms a logsSubscribe, it sends { id: N, result: <subscriptionId> }
        // We need to remap our request id → actual subscription id
        if (msg.id !== undefined && typeof msg.result === "number" && !msg.method) {
          const dex = this.subIdToDex.get(msg.id);
          if (dex) {
            // Re-map from request id to server-assigned subscription id
            this.subIdToDex.delete(msg.id);
            this.subIdToDex.set(msg.result, dex);
          }
          return;
        }

        if (msg.method === "logsNotification" && msg.params) {
          const subId = msg.params.subscription;
          const dex = this.subIdToDex.get(subId);
          if (dex) {
            void this._handleLog(msg.params.result, dex);
          }
        }
      } catch { /* ignore parse errors */ }
    });

    this.ws.on("close", () => {
      console.log("[pool-detector] WS closed, reconnecting in 5s...");
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(() => this._connect(), 5000);
      }
    });

    this.ws.on("error", (err) => {
      console.error("[pool-detector] WS error:", err.message);
    });
  }

  disconnect() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    console.log("[pool-detector] disconnected");
  }

  private async _handleLog(
    result: { value: { signature: string; logs: string[]; err: unknown } },
    dex: "raydium" | "raydium_cpmm" | "pumpfun",
  ) {
    const { signature, logs, err } = result.value;
    if (err || !logs) return;
    if (this.seenSignatures.has(signature)) return;

    const logsJoined = logs.join("\n");
    const logsLower = logsJoined.toLowerCase();

    // Check if this transaction includes a pool-creation instruction
    const keywords = POOL_INIT_KEYWORDS[dex] ?? [];
    const isPoolCreate = keywords.some(kw => logsLower.includes(kw.toLowerCase()));
    if (!isPoolCreate) return;

    // For Raydium events: only keep if pump.fun program is also in the logs
    // (that's the graduation signal — pump.fun triggers the Raydium pool creation)
    // Without this check, any new Raydium pool (for USDC, Jupiter, etc.) would appear
    if (dex === "raydium" || dex === "raydium_cpmm") {
      const isPumpGraduation = logsJoined.includes(PUMPFUN_PROGRAM);
      if (!isPumpGraduation) return;
    }

    this.seenSignatures.add(signature);
    if (this.seenSignatures.size > 10000) {
      const first = this.seenSignatures.values().next().value;
      if (first) this.seenSignatures.delete(first);
    }

    const { mint, blockTime } = await this._extractMint(signature, dex);
    if (!mint) {
      console.log(`[pool-detector] no mint found for ${signature.slice(0, 12)} (${dex})`);
      return;
    }

    // Reject historical events: block time must be within 3 minutes of when we subscribed
    if (blockTime !== null) {
      const blockMs = blockTime * 1000;
      const cutoff = this.subscriptionOpenedAt - 3 * 60 * 1000;
      if (blockMs < cutoff) {
        const ageMin = ((this.subscriptionOpenedAt - blockMs) / 60000).toFixed(1);
        console.log(`[pool-detector] skipped stale event (${ageMin}min old) sig=${signature.slice(0, 12)}`);
        return;
      }
    }

    console.log(`[pool-detector] NEW POOL detected! dex=${dex} mint=${mint} sig=${signature.slice(0, 12)}`);
    const event: NewPoolEvent = { signature, mintAddress: mint, dex, timestamp: Date.now() };
    this.emit("newPool", event);
  }

  private async _extractMint(signature: string, dex: string): Promise<{ mint: string | null; blockTime: number | null }> {
    try {
      const res = await fetch(this.rpcEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json() as {
        result?: {
          blockTime?: number | null;
          meta?: { postTokenBalances?: Array<{ mint: string; uiTokenAmount?: { decimals?: number } }> };
          transaction?: { message?: { accountKeys?: Array<{ pubkey: string }> } };
        };
      };

      const blockTime = data.result?.blockTime ?? null;
      const balances = data.result?.meta?.postTokenBalances ?? [];

      // For pump.fun: find mint with 6 decimals (pump tokens are always 6 decimals)
      if (dex === "pumpfun") {
        const pump = balances.find(b => b.mint !== WSOL && b.uiTokenAmount?.decimals === 6);
        if (pump) return { mint: pump.mint, blockTime };
      }

      // Generic: return first non-WSOL mint
      for (const b of balances) {
        if (b.mint && b.mint !== WSOL) return { mint: b.mint, blockTime };
      }

      return { mint: null, blockTime };
    } catch (err) {
      console.error("[pool-detector] getTransaction error:", err instanceof Error ? err.message : String(err));
    }
    return { mint: null, blockTime: null };
  }
}
