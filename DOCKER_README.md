# SOL_WAR_ROOM — Solana Trade Center

A self-hosted, open-source Solana multi-wallet trading panel with a dark terminal UI.

Manage wallets, execute trades, run volume bots, snipe new pools, and monitor the market — all from a single web interface running on your own server.

## Quick Start

### Docker Compose (recommended)

```yaml
services:
  solwarroom:
    image: ofoq/solana-trade-center:latest
    container_name: solana-trade-center
    ports:
      - "8080:8080"
    volumes:
      - solwarroom-data:/data
    environment:
      PORT: "8080"
      DATABASE_PATH: /data/solwarroom.db
    restart: unless-stopped

volumes:
  solwarroom-data:
```

Save as `docker-compose.yml` and run:

```bash
docker compose up -d
```

Then open [http://localhost:8080](http://localhost:8080).

### Docker Run

```bash
docker run -d \
  --name solana-trade-center \
  -p 8080:8080 \
  -v solwarroom-data:/data \
  -e DATABASE_PATH=/data/solwarroom.db \
  ofoq/solana-trade-center:latest
```

## Environment Variables

| Variable               | Default           | Description                                    |
|------------------------|-------------------|------------------------------------------------|
| `PORT`                 | `8080`            | Port the server listens on                     |
| `DATABASE_PATH`        | `./solwarroom.db` | Path to the SQLite database file               |
| `LICENSE_CHECK_ENABLED`| *(not set)*       | Set to `1` to enable the built-in license gate |
| `LICENSE_SERVER_URL`   | `https://license.ofoq.om` | License server (only when check enabled) |

## Data Persistence

The database is stored at `DATABASE_PATH` (default `/data/solwarroom.db`). Mount a volume at `/data` to keep your wallets and settings across container restarts.

## Tags

| Tag      | Description                  |
|----------|------------------------------|
| `latest` | Latest stable release        |
| `main`   | Built from the main branch   |
| `vX.Y.Z` | Specific release version     |

## Source & Full Documentation

[github.com/Ofoq-Modern-Technology/solana-trade-center](https://github.com/Ofoq-Modern-Technology/solana-trade-center)
