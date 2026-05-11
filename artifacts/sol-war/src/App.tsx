import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "./components/layout";
import { AuthProvider, useAuth } from "./contexts/auth-context";
import { useState, useEffect } from "react";

import WalletsPage from "./pages/wallets";
import AccountsPage from "./pages/accounts";
import DistributorPage from "./pages/distributor";
import TradePage from "./pages/trade";
import VolumePage from "./pages/volume";
import ArbPage from "./pages/arb";
import SniperPage from "./pages/sniper";
import RadarPage from "./pages/radar";
import DexScreenerPage from "./pages/dex-screener";
import TokenLaunchPage from "./pages/token-launch";
import HistoryPage from "./pages/history";
import SettingsPage from "./pages/settings";
import HelpPage from "./pages/help";
import TasksPage from "./pages/tasks";
import OperationsPage from "./pages/operations";
import LoginPage from "./pages/login";
import ActivatePage from "./pages/activate";
import NotFound from "@/pages/not-found";

// ─── Global fetch interceptor — attaches Bearer token to all /api calls ───────
// Replaces window.fetch so every /api/* request gets an Authorization header.
// Uses `new Headers(init.headers)` to clone existing headers (works for both
// plain objects AND `Headers` instances — spreading a Headers instance yields
// {} and silently drops Content-Type, which is why we must NOT use spread).
const _originalFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  if (url.includes("/api/")) {
    const token = localStorage.getItem("solwar_token");
    if (token) {
      const h = new Headers(init.headers as HeadersInit | undefined);
      h.set("Authorization", `Bearer ${token}`);
      init = { ...init, headers: h };
    }
  }
  return _originalFetch(input, init);
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e) => !(e instanceof Error && e.message.includes("401")) && n < 2 },
  },
});

// ─── License gate ─────────────────────────────────────────────────────────────
type LicenseStatus = "loading" | "unlicensed" | "valid" | "invalid" | "expired" | "unchecked";

function LicenseGate({ children }: { children: React.ReactNode }) {
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus>("loading");

  const check = async () => {
    try {
      const r = await fetch(`${BASE}/api/license/status`);
      const data = await r.json() as { status: string };
      setLicenseStatus(data.status as LicenseStatus);
    } catch {
      // If server unreachable, assume ok (dev mode)
      setLicenseStatus("valid");
    }
  };

  useEffect(() => { void check(); }, []);

  // In dev mode or if SKIP_LICENSE_CHECK=1 the status comes back as "valid"
  if (licenseStatus === "loading") return null;
  if (licenseStatus === "valid" || licenseStatus === "unchecked") return <>{children}</>;

  return (
    <ActivatePage
      status={licenseStatus}
      onActivated={() => setLicenseStatus("valid")}
    />
  );
}

// ─── Auth gate ────────────────────────────────────────────────────────────────
function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, configured, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="font-mono text-primary text-sm animate-pulse">Initializing…</div>
      </div>
    );
  }

  if (!configured || !token) return <LoginPage />;

  return <LicenseGate>{children}</LicenseGate>;
}

// ─── Router ───────────────────────────────────────────────────────────────────
function Router() {
  return (
    <AuthGate>
      <Layout>
        <Switch>
          <Route path="/" component={WalletsPage} />
          <Route path="/accounts" component={AccountsPage} />
          <Route path="/distributor" component={DistributorPage} />
          <Route path="/trade" component={TradePage} />
          <Route path="/volume" component={VolumePage} />
          <Route path="/arb" component={ArbPage} />
          <Route path="/sniper" component={SniperPage} />
          <Route path="/radar" component={RadarPage} />
          <Route path="/dex-screener" component={DexScreenerPage} />
          <Route path="/token-launch" component={TokenLaunchPage} />
          <Route path="/history" component={HistoryPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/tasks" component={TasksPage} />
          <Route path="/operations" component={OperationsPage} />
          <Route path="/help" component={HelpPage} />
          <Route component={NotFound} />
        </Switch>
      </Layout>
    </AuthGate>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
