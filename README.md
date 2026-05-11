# SOL_WAR_ROOM — Solana Trade Center

A self-hosted, open-source Solana multi-wallet trading panel with a dark terminal UI.

Manage wallets, execute trades, run volume bots, snipe new pools, and monitor the market — all from a single, self-hosted web interface. No subscriptions required, no data leaves your server.

---

## Features

- **Multi-wallet HD management** — Generate wallets from BIP39 mnemonics, derive N accounts per wallet (m/44'/501'/index'/0')
- **AES-256-GCM encryption** — Mnemonics and private keys encrypted server-side with a PBKDF2-derived key; password never stored
- **Token lookup** — Resolves pump.fun (graduated/ungraduated), Raydium, and Jupiter tokens via Helius DAS API
- **Multi-account buy/sell** — Select accounts across wallets, execute coordinated buys/sells via Jupiter v6
- **Jito MEV bundling** — Atomic transaction submission via Jito block engine
- **Volume generation** — Automated bots with random, wash, and ladder patterns
- **Cross-DEX arbitrage** — Scans Jupiter routes for circular arb, executes via Jito bundles
- **New pool sniper** — WebSocket logsSubscribe on Raydium AMM v4, Raydium CPMM, Pump.fun; simultaneous multi-account buy + auto-exit
- **DexScreener monitor** — Tracks CTO claims with live timestamps
- **CSV wallet import** — Import from mnemonics CSV or private keys CSV
- **Task queue** — Persistent DCA, limit buy, exit sell tasks that survive restarts
- **Operations dashboard** — Live view of all snipers, arb engines, volume bots, and queued tasks

---

## Quick Start

### Option 1 — Docker (recommended)

Requires [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/).

```bash
# 1. Download the compose file
curl -O https://raw.githubusercontent.com/Ofoq-Modern-Technology/solana-trade-center/main/docker-compose.yml

# 2. Start the container
docker compose up -d

# 3. Open in your browser
open http://localhost:8080
```

Or run without Compose:

```bash
docker run -d \
  --name solana-trade-center \
  -p 8080:8080 \
  -v solwarroom-data:/data \
  -e DATABASE_PATH=/data/solwarroom.db \
  ofoq/solana-trade-center:latest
```

---

### Option 2 — Standalone Binary (no Node.js required)

Download the pre-built binary for your platform from the [latest release](https://github.com/Ofoq-Modern-Technology/solana-trade-center/releases/latest).

| Platform       | File                          |
|----------------|-------------------------------|
| Linux x64      | `solwarroom-linux-x64`        |
| Linux ARM64    | `solwarroom-linux-arm64`      |
| Windows x64    | `solwarroom-win-x64.exe`      |
| macOS x64      | `solwarroom-macos-x64`        |
| macOS ARM64    | `solwarroom-macos-arm64`      |

```bash
# Linux / macOS
chmod +x solwarroom-linux-x64
PORT=8080 ./solwarroom-linux-x64

# Windows (PowerShell or CMD)
.\solwarroom-win-x64.exe
```

The binary is fully self-contained — no Node.js, no `npm install` needed. The SQLite database is created automatically in the current directory as `solwarroom.db`.

---

### Option 3 — Node.js (from source)

Requires Node.js ≥ 20 and [pnpm](https://pnpm.io).

```bash
# 1. Clone the repo
git clone https://github.com/Ofoq-Modern-Technology/solana-trade-center.git
cd solana-trade-center

# 2. Install dependencies
pnpm install

# 3. Start in development mode
pnpm --filter @workspace/api-server run dev &
pnpm --filter @workspace/sol-war run dev

# Or build and run for production
pnpm run build:release
node artifacts/api-server/dist/server.cjs
```

---

## Environment Variables

| Variable               | Default                   | Description                                      |
|------------------------|---------------------------|--------------------------------------------------|
| `PORT`                 | `8080`                    | Port the server listens on                       |
| `DATABASE_PATH`        | `./solwarroom.db`         | Path to the SQLite database file                 |
| `NODE_ENV`             | `development`             | Set to `production` for the built release        |
| `LICENSE_CHECK_ENABLED`| *(not set)*               | Set to `1` to enable the license gate            |
| `LICENSE_SERVER_URL`   | `https://license.ofoq.om` | License server URL (only used when check is on)  |

By default the panel runs fully open — no license key required. If you want to add a license gate to your own deployment, set `LICENSE_CHECK_ENABLED=1` and point `LICENSE_SERVER_URL` at your own [License Manager](https://github.com/Ofoq-Modern-Technology/License-Manager) instance.

---

## Building Binaries Locally

```bash
pnpm install

# All platforms
pnpm --filter @workspace/api-server run build:binary

# Specific platform
pnpm --filter @workspace/api-server run build:binary linux
pnpm --filter @workspace/api-server run build:binary win
pnpm --filter @workspace/api-server run build:binary mac
```

Output is in `artifacts/api-server/dist/`.

---

## Building the Docker Image Locally

```bash
docker build -t ofoq/solana-trade-center .
docker run -p 8080:8080 -v $(pwd)/data:/data ofoq/solana-trade-center
```

---

## License

MIT — free to self-host, modify, and redistribute.
