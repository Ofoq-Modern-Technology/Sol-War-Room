import { HelpCircle, Key, Settings, Layers, ArrowRightLeft, Activity, Bot, Crosshair, Radio, TrendingUp, Rocket, AlertTriangle, CheckCircle, ExternalLink } from "lucide-react";

interface Section {
  id: string;
  icon: React.ReactNode;
  title: string;
  content: React.ReactNode;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border/50 rounded-lg p-5 space-y-3">
      {children}
    </div>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="font-mono font-semibold text-primary text-sm">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>;
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs font-mono">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-md bg-primary/10 border border-primary/20 text-primary text-xs font-mono">
      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-primary/20 text-primary font-mono text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        {n}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

const SECTIONS: Section[] = [
  {
    id: "quickstart",
    icon: <CheckCircle className="w-4 h-4" />,
    title: "Quick Start",
    content: (
      <div className="space-y-4">
        <Card>
          <H3>Getting started in 5 steps</H3>
          <div className="space-y-3">
            <Step n={1}><strong className="text-foreground">Settings first</strong> — go to Settings and paste your Helius API key (for RPC + token metadata), your Jupiter API key (for swaps), and optionally your xAI key (for AI features). Without a Helius key most features fall back to the public RPC which is heavily rate-limited.</Step>
            <Step n={2}><strong className="text-foreground">Create wallets</strong> — go to Wallets, click Generate Nodes, choose a count and a strong password. This generates BIP39 seed phrases encrypted with your password. The password is never stored.</Step>
            <Step n={3}><strong className="text-foreground">Derive accounts</strong> — on each wallet card click "Derive Sub-accounts". These are the actual Solana addresses you will use for trading. 10–50 accounts is a good starting point for volume/distribution work.</Step>
            <Step n={4}><strong className="text-foreground">Fund accounts</strong> — send SOL to the public keys shown in the Accounts page. Use the Distributor page to split SOL from one wallet to many at once.</Step>
            <Step n={5}><strong className="text-foreground">Start trading</strong> — use Trade for single swaps, Volume for wash trading, Arb Engine for automated arbitrage, or Sniper to auto-buy new tokens on launch.</Step>
          </div>
        </Card>
        <Tip>All private keys and seed phrases are encrypted at rest with AES-256. Your password is used to decrypt them only during signing — it is never saved to disk or sent to any server.</Tip>
      </div>
    ),
  },
  {
    id: "settings",
    icon: <Settings className="w-4 h-4" />,
    title: "Settings & API Keys",
    content: (
      <div className="space-y-4">
        <Card>
          <H3>Helius API Key (Required)</H3>
          <P>Used for the Solana RPC endpoint, token metadata lookups, and new token detection in Token Radar. Get a free key at <a href="https://helius.dev" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">helius.dev <ExternalLink className="w-3 h-3" /></a>. The free tier is sufficient for most personal use.</P>
        </Card>
        <Card>
          <H3>Jupiter API Key (Recommended)</H3>
          <P>Used for all token swaps via the Jupiter Aggregator. Without a key you use the public endpoint which may rate-limit you. Get one at <a href="https://portal.jup.ag" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">portal.jup.ag <ExternalLink className="w-3 h-3" /></a>.</P>
        </Card>
        <Card>
          <H3>xAI API Key (Optional)</H3>
          <P>Used for AI-assisted features. Get one at <a href="https://x.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">x.ai <ExternalLink className="w-3 h-3" /></a>.</P>
        </Card>
        <Card>
          <H3>Jito (Optional)</H3>
          <P>Enable Jito for MEV-protected transactions and priority landing. When enabled, a tip is added to each transaction to attract Jito block builders. Falls back to standard RPC if Jito is unavailable.</P>
        </Card>
        <Warn>Never share your Settings page or API keys. They are stored locally in your SQLite database file — keep it private.</Warn>
      </div>
    ),
  },
  {
    id: "wallets",
    icon: <Key className="w-4 h-4" />,
    title: "Wallets & Accounts",
    content: (
      <div className="space-y-4">
        <Card>
          <H3>HD Wallets (Master Nodes)</H3>
          <P>Each wallet is a BIP39 seed phrase (12 or 24 words). From one seed you can derive thousands of accounts — this is the same system used by Phantom, Solflare, and Ledger. The mnemonic is encrypted with your password before being saved.</P>
        </Card>
        <Card>
          <H3>Accounts (Derived Keypairs)</H3>
          <P>Accounts are child keypairs derived from a wallet using a derivation path (e.g. m/44'/501'/0'/0'). Each account has a unique Solana address and private key, both encrypted with the same password as the parent wallet. These are the addresses you fund and trade from.</P>
        </Card>
        <Card>
          <H3>Importing from CSV</H3>
          <P>Click <strong className="text-foreground">Import CSV</strong> to bulk-import existing keys. Two formats are supported:</P>
          <ul className="space-y-1 mt-2 ml-4 text-sm text-muted-foreground list-disc">
            <li><strong className="text-foreground">Wallets (Mnemonics)</strong> — CSV with columns <code className="bg-muted px-1 rounded text-xs">name, mnemonic</code>. Each row is one seed phrase that becomes a wallet node. You can then derive accounts from it.</li>
            <li><strong className="text-foreground">Accounts (Private Keys)</strong> — CSV with columns <code className="bg-muted px-1 rounded text-xs">name, private_key</code>. Each row is a base58-encoded 64-byte Solana keypair. These are stored under a wallet called "Imported Keys".</li>
          </ul>
          <P>Download the CSV template from the import dialog to get the exact column names.</P>
        </Card>
        <Warn>Use the same password for all wallets on this instance if you want to use the Export feature — Export tries the same password for every wallet.</Warn>
      </div>
    ),
  },
  {
    id: "distributor",
    icon: <Layers className="w-4 h-4" />,
    title: "Distributor",
    content: (
      <div className="space-y-4">
        <Card>
          <H3>What it does</H3>
          <P>The Distributor lets you send SOL or SPL tokens from one source wallet to many target accounts in a single operation. Useful for pre-funding trading accounts before a volume run or sniper session.</P>
        </Card>
        <Card>
          <H3>Workflow</H3>
          <div className="space-y-2">
            <Step n={1}>Set up a Distributor Wallet in Settings (or it's auto-created). Fund it with enough SOL to cover all distributions plus transaction fees (~0.000005 SOL per tx).</Step>
            <Step n={2}>Go to Distributor, select target accounts, enter the amount per account, and submit with your password.</Step>
            <Step n={3}>Transactions are sent sequentially. A summary shows which succeeded and which failed.</Step>
          </div>
        </Card>
        <Tip>Keep ~0.05–0.1 extra SOL in the distributor to cover fees. Each transfer costs ~5000 lamports in fees.</Tip>
      </div>
    ),
  },
  {
    id: "trade",
    icon: <ArrowRightLeft className="w-4 h-4" />,
    title: "Trade",
    content: (
      <div className="space-y-4">
        <Card>
          <H3>Manual Swaps</H3>
          <P>The Trade page lets you swap any Solana token pair via Jupiter Aggregator for one or multiple accounts at once. Enter the input token (SOL or a mint address), output token, amount, and slippage, then execute across selected accounts.</P>
        </Card>
        <Card>
          <H3>Tips</H3>
          <ul className="space-y-1 ml-4 text-sm text-muted-foreground list-disc">
            <li>Slippage of 1–3% works for most liquid tokens. Use 5–15% for low-liquidity meme coins.</li>
            <li>Enable Jito in Settings for faster landing and MEV protection on competitive tokens.</li>
            <li>Each account signs its own transaction — parallel execution across accounts is handled automatically.</li>
          </ul>
        </Card>
      </div>
    ),
  },
  {
    id: "volume",
    icon: <Activity className="w-4 h-4" />,
    title: "Volume Bot",
    content: (
      <div className="space-y-4">
        <Card>
          <H3>What it does</H3>
          <P>The Volume Bot automates buy/sell cycles across multiple accounts to generate trading volume for a token. It can run indefinitely with configurable delays between cycles.</P>
        </Card>
        <Card>
          <H3>Configuration</H3>
          <ul className="space-y-1 ml-4 text-sm text-muted-foreground list-disc">
            <li><strong className="text-foreground">Token</strong> — the mint address of the token to trade.</li>
            <li><strong className="text-foreground">Amount per cycle</strong> — SOL amount each account buys per cycle.</li>
            <li><strong className="text-foreground">Delay</strong> — seconds to wait between each account's action.</li>
            <li><strong className="text-foreground">Cycles</strong> — total number of buy+sell rounds to run.</li>
          </ul>
        </Card>
        <Warn>Volume bots can deplete account balances quickly through fees. Always monitor SOL balances in the Accounts page.</Warn>
      </div>
    ),
  },
  {
    id: "arb",
    icon: <Bot className="w-4 h-4" />,
    title: "Arb Engine",
    content: (
      <div className="space-y-4">
        <Card>
          <H3>What it does</H3>
          <P>The Arb Engine continuously scans for price discrepancies between AMMs (Raydium, Orca, Pump.fun) for a given token and executes buy/sell pairs when a profitable spread is found.</P>
        </Card>
        <Card>
          <H3>Configuration</H3>
          <ul className="space-y-1 ml-4 text-sm text-muted-foreground list-disc">
            <li><strong className="text-foreground">Min profit threshold</strong> — only trade when expected profit exceeds this percentage after fees.</li>
            <li><strong className="text-foreground">Max position size</strong> — SOL cap per arbitrage trade.</li>
            <li><strong className="text-foreground">Cooldown</strong> — minimum seconds between trades per account to avoid being flagged.</li>
          </ul>
        </Card>
        <Tip>Start with a low max position size to test the configuration before scaling up.</Tip>
      </div>
    ),
  },
  {
    id: "sniper",
    icon: <Crosshair className="w-4 h-4" />,
    title: "Sniper",
    content: (
      <div className="space-y-4">
        <Card>
          <H3>What it does</H3>
          <P>The Sniper watches for new Solana token launches (via Pump.fun pools or DexScreener Community Takeovers) and executes instant buys across all selected accounts the moment a trigger fires.</P>
        </Card>
        <Card>
          <H3>Trigger modes</H3>
          <ul className="space-y-1 ml-4 text-sm text-muted-foreground list-disc">
            <li><strong className="text-foreground">Pool Detection</strong> — fires when a new Raydium/Pump.fun liquidity pool is created (on-chain). Fastest trigger. You can filter by min/max liquidity and set a delay to let price stabilize.</li>
            <li><strong className="text-foreground">CTO Auto-Buy</strong> — fires when DexScreener officially marks a token as a Community Takeover. These tokens have gone through community vetting and may have more upside. Check the DexScreener page to see the current CTO list.</li>
          </ul>
        </Card>
        <Card>
          <H3>Key settings</H3>
          <ul className="space-y-1 ml-4 text-sm text-muted-foreground list-disc">
            <li><strong className="text-foreground">Buy amount</strong> — SOL amount each account spends per snipe.</li>
            <li><strong className="text-foreground">Slippage</strong> — use 10–25% for new launches which can be volatile.</li>
            <li><strong className="text-foreground">Accounts</strong> — select which accounts participate. Make sure they have enough SOL.</li>
            <li><strong className="text-foreground">Dedup window</strong> — prevents the same token from being sniped twice within N seconds.</li>
          </ul>
        </Card>
        <Warn>Sniping new launches carries high risk. New tokens can rug-pull within seconds of launch. Only use amounts you can afford to lose entirely.</Warn>
      </div>
    ),
  },
  {
    id: "radar",
    icon: <Radio className="w-4 h-4" />,
    title: "Token Radar",
    content: (
      <div className="space-y-4">
        <Card>
          <H3>What it does</H3>
          <P>Token Radar is a live feed of newly detected Solana tokens from multiple sources: Pump.fun launches, Raydium pool creations, and DexScreener profile updates/boosts/CTOs. Every token seen by the system is stored here.</P>
        </Card>
        <Card>
          <H3>Filter tabs</H3>
          <ul className="space-y-1 ml-4 text-sm text-muted-foreground list-disc">
            <li><strong className="text-foreground">All</strong> — everything detected in the last 24h.</li>
            <li><strong className="text-foreground">Graduated</strong> — tokens that migrated from Pump.fun to Raydium (passed the bonding curve).</li>
            <li><strong className="text-foreground">Pump.fun</strong> — tokens launched via Pump.fun.</li>
            <li><strong className="text-foreground">DexScreener (N)</strong> — tokens from DexScreener profile updates, boosts, and CTOs. The badge color tells you the source: orange = profile, yellow = boost, red = CTO.</li>
          </ul>
        </Card>
        <Tip>Click any mint address in the radar to copy it — then paste it directly into the Trade or Sniper page.</Tip>
      </div>
    ),
  },
  {
    id: "dexscreener",
    icon: <TrendingUp className="w-4 h-4" />,
    title: "DexScreener",
    content: (
      <div className="space-y-4">
        <Card>
          <H3>What it does</H3>
          <P>The DexScreener page shows live Solana token data directly from the DexScreener API, refreshed every 60 seconds. Four tabs are available:</P>
          <ul className="space-y-1 ml-4 mt-2 text-sm text-muted-foreground list-disc">
            <li><strong className="text-foreground">Community Takeovers</strong> — tokens officially designated as CTOs by DexScreener. The claim time shows how long ago the CTO was registered. The Sniper's CTO Auto-Buy mode watches this list.</li>
            <li><strong className="text-foreground">Latest Profiles</strong> — tokens that recently updated their DexScreener profile (social links, description, logo).</li>
            <li><strong className="text-foreground">Latest Boosts</strong> — tokens recently boosted on DexScreener.</li>
            <li><strong className="text-foreground">Top Boosts</strong> — tokens with the most accumulated boost points.</li>
          </ul>
        </Card>
        <Tip>CTO tokens often have active communities pushing the price. The earlier you enter after the CTO claim, the better the risk/reward — but always DYOR.</Tip>
      </div>
    ),
  },
  {
    id: "tokenlaunch",
    icon: <Rocket className="w-4 h-4" />,
    title: "Token Launch",
    content: (
      <div className="space-y-4">
        <Card>
          <H3>What it does</H3>
          <P>The Token Launch page guides you through deploying a new SPL token on Solana via Pump.fun. You can configure the name, symbol, description, image, and initial liquidity, then launch directly from a selected account.</P>
        </Card>
        <Card>
          <H3>After launching</H3>
          <P>Once launched, you can immediately use the Volume Bot and Sniper with the new token's mint address. The token will appear in Token Radar under Pump.fun within seconds of the pool being created.</P>
        </Card>
        <Warn>Pump.fun tokens require an initial SOL deposit to seed the bonding curve. Make sure the launching account has sufficient SOL (typically 0.02–1 SOL depending on desired initial liquidity).</Warn>
      </div>
    ),
  },
];

export default function HelpPage() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl">
      <div>
        <h1 className="text-3xl font-mono font-bold tracking-tight text-glow flex items-center gap-3">
          <HelpCircle className="w-8 h-8 text-primary" />
          Help & Documentation
        </h1>
        <p className="text-muted-foreground font-mono text-sm mt-1">
          Complete guide to using SOL_WAR_ROOM — a self-hosted Solana multi-wallet trading platform.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pb-2 border-b border-border/50">
        {SECTIONS.map(s => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-md border border-border/50 bg-card hover:border-primary/40 hover:text-primary transition-colors text-muted-foreground"
          >
            {s.icon}
            {s.title}
          </a>
        ))}
      </div>

      <div className="space-y-12">
        {SECTIONS.map(s => (
          <section key={s.id} id={s.id} className="scroll-mt-20 space-y-4">
            <h2 className="text-xl font-mono font-bold text-foreground flex items-center gap-2 border-b border-border/50 pb-3">
              <span className="text-primary">{s.icon}</span>
              {s.title}
            </h2>
            {s.content}
          </section>
        ))}
      </div>

      <div className="p-4 rounded-lg border border-border/50 bg-card/30 font-mono text-xs text-muted-foreground">
        SOL_WAR_ROOM is a self-hosted platform — your keys never leave your machine. All API calls to Helius, Jupiter, and xAI go directly from your server to those services.
      </div>
    </div>
  );
}
