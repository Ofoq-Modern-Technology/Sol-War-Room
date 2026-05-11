import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Settings2, Save, KeyRound, ShieldCheck, ShieldAlert, ShieldX, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useGetSettings, useUpdateSettings } from "@/hooks/use-settings";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api${path}`, init);
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? `HTTP ${r.status}`); }
  return r.json() as Promise<T>;
}

interface LicenseInfo {
  status: string;
  licenseKey?: string;
  expiresAt?: string | null;
  checkedAt?: string | null;
}

function LicenseCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState("");
  const [activating, setActivating] = useState(false);

  const { data: lic, isLoading } = useQuery<LicenseInfo>({
    queryKey: ["license-status"],
    queryFn: () => apiFetch<LicenseInfo>("/license/status"),
    refetchInterval: 60_000,
  });

  const deactivateMutation = useMutation({
    mutationFn: () => apiFetch("/license/deactivate", { method: "POST" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["license-status"] }); toast({ title: "License removed" }); },
    onError: (e) => toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    setActivating(true);
    try {
      await apiFetch("/license/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseKey: newKey.trim() }),
      });
      await qc.invalidateQueries({ queryKey: ["license-status"] });
      setNewKey("");
      toast({ title: "License activated", description: "Your installation is now licensed." });
    } catch (err) {
      toast({ title: "Activation failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setActivating(false);
    }
  }

  const statusConfig = {
    valid:      { icon: <ShieldCheck className="w-4 h-4 text-green-400" />,  label: "Valid",      color: "text-green-400" },
    expired:    { icon: <ShieldAlert className="w-4 h-4 text-red-400" />,    label: "Expired",    color: "text-red-400" },
    invalid:    { icon: <ShieldX className="w-4 h-4 text-red-400" />,        label: "Invalid",    color: "text-red-400" },
    unchecked:  { icon: <Clock className="w-4 h-4 text-yellow-400" />,       label: "Unchecked",  color: "text-yellow-400" },
    unlicensed: { icon: <ShieldX className="w-4 h-4 text-muted-foreground" />,label: "No License", color: "text-muted-foreground" },
  };
  const cfg = statusConfig[lic?.status as keyof typeof statusConfig] ?? statusConfig.unlicensed;

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader>
        <CardTitle className="font-mono text-base flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" /> License
        </CardTitle>
        <CardDescription className="font-mono text-xs">Lemon Squeezy subscription key for this installation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="h-8 rounded bg-muted animate-pulse w-40" />
        ) : (
          <div className="flex items-center gap-3">
            {cfg.icon}
            <div>
              <span className={`font-mono text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
              {lic?.licenseKey && <p className="font-mono text-xs text-muted-foreground mt-0.5">{lic.licenseKey}</p>}
              {lic?.expiresAt && <p className="font-mono text-xs text-muted-foreground">Expires: {new Date(lic.expiresAt).toLocaleDateString()}</p>}
            </div>
            {lic?.status === "valid" && (
              <Button variant="ghost" size="sm" className="ml-auto font-mono text-xs text-muted-foreground hover:text-destructive"
                onClick={() => deactivateMutation.mutate()} disabled={deactivateMutation.isPending}>
                Deactivate
              </Button>
            )}
          </div>
        )}

        {lic?.status !== "valid" && (
          <form onSubmit={handleActivate} className="flex gap-2 max-w-md">
            <Input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Paste your license key…"
              className="font-mono text-sm bg-background flex-1" required />
            <Button type="submit" variant="outline" className="font-mono" disabled={activating}>
              {activating ? "Activating…" : "Activate"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

const settingsSchema = z.object({
  rpcEndpoint: z.string().url("Must be a valid URL"),
  heliusApiKey: z.string().optional().nullable(),
  jupiterApiKey: z.string().optional().nullable(),
  jitoEndpoint: z.string().url("Must be a valid URL"),
  defaultSlippageBps: z.coerce.number().min(1),
  defaultJitoTipLamports: z.coerce.number().min(0),
  defaultDelayMs: z.coerce.number().min(0),
  xaiApiKey: z.string().optional().nullable(),
  socialGateAccounts: z.string().optional(),
});

export default function SettingsPage() {
  const { data: settings, isLoading } = useGetSettings();
  const updateMutation = useUpdateSettings();
  const { toast } = useToast();
  const { changePassword } = useAuth();

  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwNew !== pwConfirm) { toast({ title: "Passwords don't match", variant: "destructive" }); return; }
    if (pwNew.length < 8) { toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return; }
    setPwLoading(true);
    try {
      await changePassword(pwCurrent, pwNew);
      toast({ title: "Password changed", description: "Your new password is active." });
      setPwCurrent(""); setPwNew(""); setPwConfirm("");
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setPwLoading(false);
    }
  }

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
  });

  useEffect(() => {
    if (settings) {
      const s = settings as typeof settings & { xaiApiKey?: string | null; socialGateAccounts?: string };
      let accountsDisplay = "";
      try { accountsDisplay = (JSON.parse(s.socialGateAccounts ?? "[]") as string[]).join(", "); } catch { /* */ }
      form.reset({
        rpcEndpoint: settings.rpcEndpoint,
        heliusApiKey: settings.heliusApiKey || "",
        jupiterApiKey: settings.jupiterApiKey || "",
        jitoEndpoint: settings.jitoEndpoint,
        defaultSlippageBps: settings.defaultSlippageBps,
        defaultJitoTipLamports: settings.defaultJitoTipLamports,
        defaultDelayMs: settings.defaultDelayMs,
        xaiApiKey: s.xaiApiKey || "",
        socialGateAccounts: accountsDisplay,
      });
    }
  }, [settings, form]);

  const onSubmit = (data: z.infer<typeof settingsSchema>) => {
    const accounts = (data.socialGateAccounts ?? "").split(/[,\s]+/).map(a => a.trim().replace(/^@/, "")).filter(Boolean);
    updateMutation.mutate({
      data: {
        ...data,
        heliusApiKey: data.heliusApiKey || null,
        jupiterApiKey: data.jupiterApiKey || null,
        xaiApiKey: data.xaiApiKey || null,
        socialGateAccounts: JSON.stringify(accounts),
      } as Parameters<typeof updateMutation.mutate>[0]["data"]
    }, {
      onSuccess: () => toast({ title: "Saved", description: "Global config updated." }),
      onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" })
    });
  };

  if (isLoading) {
    return <Skeleton className="w-full h-[500px] rounded-xl bg-card/50" />;
  }

  return (
    <div className="max-w-3xl space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-mono font-bold text-glow flex items-center gap-3">
          <Settings2 className="w-8 h-8" /> Config
        </h1>
        <p className="text-muted-foreground font-mono text-sm mt-1">Configure networking and default tactical parameters.</p>
      </div>

      <Card className="glass-panel border-primary/20">
        <CardHeader>
          <CardTitle className="font-mono text-primary">Core Systems</CardTitle>
          <CardDescription className="font-mono text-xs">These values will be applied globally across all executed payloads.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <div className="space-y-4 p-4 border border-border/50 rounded-lg bg-background/50">
                <h3 className="font-mono text-sm text-muted-foreground border-b border-border/50 pb-2">Network Architecture</h3>
                <FormField control={form.control} name="rpcEndpoint" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs">Solana RPC Endpoint</FormLabel>
                    <FormControl><Input className="font-mono bg-background" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="heliusApiKey" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs">Helius API Key (Optional — upgrades RPC)</FormLabel>
                    <FormControl><Input type="password" placeholder="Key..." className="font-mono bg-background" {...field} value={field.value || ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="jupiterApiKey" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs">
                      Jupiter API Key{" "}
                      <span className="text-destructive font-bold">(Required for swaps — free key at dev.jup.ag)</span>
                    </FormLabel>
                    <FormControl><Input type="password" placeholder="Key..." className="font-mono bg-background" {...field} value={field.value || ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="jitoEndpoint" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs">Jito Block Engine URL</FormLabel>
                    <FormControl><Input className="font-mono bg-background" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="space-y-4 p-4 border border-border/50 rounded-lg bg-background/50">
                <h3 className="font-mono text-sm text-muted-foreground border-b border-border/50 pb-2">Default Trading Parameters</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField control={form.control} name="defaultSlippageBps" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs">Slippage (BPS)</FormLabel>
                      <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="defaultJitoTipLamports" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs">Jito Tip (Lamports)</FormLabel>
                      <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="defaultDelayMs" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs">Stagger Delay (ms)</FormLabel>
                      <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              <div className="space-y-4 p-4 border border-border/50 rounded-lg bg-background/50">
                <h3 className="font-mono text-sm text-muted-foreground border-b border-border/50 pb-2">xAI / Social Gate</h3>
                <p className="font-mono text-[10px] text-muted-foreground">Used by the sniper's social gate — checks X for token mentions before buying on Raydium.</p>
                <FormField control={form.control} name="xaiApiKey" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs">xAI API Key (api.x.ai)</FormLabel>
                    <FormControl><Input type="password" placeholder="xai-..." className="font-mono bg-background" {...field} value={field.value || ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="socialGateAccounts" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs">Monitored X Accounts <span className="text-muted-foreground/60 normal-case">(comma separated, without @)</span></FormLabel>
                    <FormControl>
                      <Input
                        placeholder="WatcherGuru, elonmusk, realDonaldTrump, ..."
                        className="font-mono bg-background text-xs"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="flex justify-end">
                <Button type="submit" className="font-mono border-glow" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "SAVING..." : <><Save className="w-4 h-4 mr-2" /> COMMIT CHANGES</>}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* License */}
      <LicenseCard />

      {/* Change Password */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="font-mono text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" /> Change Password
          </CardTitle>
          <CardDescription className="font-mono text-xs">Update your panel login password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">Current Password</label>
              <Input type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} className="font-mono bg-background" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">New Password</label>
              <Input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} className="font-mono bg-background" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">Confirm New Password</label>
              <Input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} className="font-mono bg-background" required />
            </div>
            <Button type="submit" variant="outline" className="font-mono" disabled={pwLoading}>
              {pwLoading ? "Updating…" : "Update Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
