import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import {
  Wallet,
  Send,
  Download,
  Plus,
  RefreshCw,
  Lock,
  CheckSquare,
  Square,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Layers,
  ExternalLink,
} from "lucide-react";
import {
  useGetDistributorWallet,
  useCreateDistributorWallet,
  useRefreshDistributorBalance,
  useDistributorSend,
  useDistributorCollect,
} from "@/hooks/use-distributor";
import { useListAllAccounts } from "@/hooks/use-accounts";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DistributorOpResult } from "@workspace/api-client-react";
import { SolscanLink } from "@/components/solscan-link";

const createSchema = z.object({
  password: z.string().min(4, "Min 4 chars"),
});

const sendSchema = z.object({
  password: z.string().min(1, "Password required"),
  amountSol: z.coerce.number().positive("Must be positive"),
});

const collectSchema = z.object({
  password: z.string().min(1, "Password required"),
  leaveRentSol: z.coerce.number().min(0).default(0.002),
});

const withdrawSchema = z.object({
  password: z.string().min(1, "Password required"),
  toAddress: z.string().min(32, "Invalid Solana address"),
  amountSol: z.coerce.number().positive("Must be positive"),
});

function ResultRow({ r }: { r: DistributorOpResult }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-md border text-xs font-mono ${r.success ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
      {r.success
        ? <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
        : <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <SolscanLink address={r.fromAddress} />
          <span className="text-muted-foreground">→</span>
          <SolscanLink address={r.toAddress} />
          <span className="text-primary font-bold">{r.amountSol.toFixed(4)} SOL</span>
        </div>
        {r.signature && (
          <SolscanLink address={r.signature} type="tx" />
        )}
        {r.error && <div className="text-red-400">{r.error}</div>}
      </div>
    </div>
  );
}

export default function DistributorPage() {
  const { data: distWallet, isLoading: walletLoading, refetch: refetchWallet } = useGetDistributorWallet();
  const { data: accounts, isLoading: accountsLoading } = useListAllAccounts();
  const createMutation = useCreateDistributorWallet();
  const refreshMutation = useRefreshDistributorBalance();
  const sendMutation = useDistributorSend();
  const collectMutation = useDistributorCollect();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<{ signature: string; amountSol: number; toAddress: string } | null>(null);
  const [results, setResults] = useState<DistributorOpResult[] | null>(null);
  const [walletFilter, setWalletFilter] = useState<string>("all");

  const withdrawMutation = useMutation({
    mutationFn: async (data: z.infer<typeof withdrawSchema>) => {
      const r = await fetch("/api/distributor/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("solwar_token")}` },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      return r.json() as Promise<{ signature: string; amountSol: number; toAddress: string }>;
    },
  });

  const wallets = useMemo(() => {
    if (!accounts) return [];
    const map = new Map<number, string>();
    for (const acc of accounts) {
      if (!map.has(acc.walletId)) map.set(acc.walletId, acc.walletName ?? `Wallet ${acc.walletId}`);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];
    if (walletFilter === "all") return accounts;
    return accounts.filter((a) => String(a.walletId) === walletFilter);
  }, [accounts, walletFilter]);

  const createForm = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { password: "" },
  });

  const sendForm = useForm<z.infer<typeof sendSchema>>({
    resolver: zodResolver(sendSchema),
    defaultValues: { password: "", amountSol: 0.01 },
  });

  const collectForm = useForm<z.infer<typeof collectSchema>>({
    resolver: zodResolver(collectSchema),
    defaultValues: { password: "", leaveRentSol: 0.002 },
  });

  const withdrawForm = useForm<z.infer<typeof withdrawSchema>>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: { password: "", toAddress: "", amountSol: 0.1 },
  });

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (filteredAccounts.length === 0) return;
    const allFilteredSelected = filteredAccounts.every((a) => selectedIds.has(a.id));
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredAccounts.forEach((a) => next.delete(a.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredAccounts.forEach((a) => next.add(a.id));
        return next;
      });
    }
  };

  const onCreateSubmit = (data: z.infer<typeof createSchema>) => {
    createMutation.mutate({ data }, {
      onSuccess: () => {
        setCreateOpen(false);
        createForm.reset();
        refetchWallet();
        toast({ title: "Distributor wallet created", description: "Funded your master distribution node." });
      },
      onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    });
  };

  const onSendSubmit = (data: z.infer<typeof sendSchema>) => {
    if (selectedIds.size === 0) {
      toast({ title: "No accounts selected", description: "Select at least one target account.", variant: "destructive" });
      return;
    }
    sendMutation.mutate(
      { data: { password: data.password, accountIds: Array.from(selectedIds), amountSol: data.amountSol } },
      {
        onSuccess: (res) => {
          setSendOpen(false);
          sendForm.reset();
          setResults(res);
          const ok = res.filter((r) => r.success).length;
          toast({ title: `Sent to ${ok}/${res.length} accounts`, description: `${data.amountSol} SOL each` });
          refetchWallet();
        },
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  const onCollectSubmit = (data: z.infer<typeof collectSchema>) => {
    if (selectedIds.size === 0) {
      toast({ title: "No accounts selected", description: "Select accounts to collect from.", variant: "destructive" });
      return;
    }
    collectMutation.mutate(
      { data: { password: data.password, accountIds: Array.from(selectedIds), leaveRentSol: data.leaveRentSol } },
      {
        onSuccess: (res) => {
          setCollectOpen(false);
          collectForm.reset();
          setResults(res);
          const ok = res.filter((r) => r.success).length;
          toast({ title: `Collected from ${ok}/${res.length} accounts` });
          refetchWallet();
        },
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  const onWithdrawSubmit = (data: z.infer<typeof withdrawSchema>) => {
    withdrawMutation.mutate(data, {
      onSuccess: (res) => {
        setWithdrawOpen(false);
        withdrawForm.reset();
        setWithdrawResult(res);
        toast({ title: "Withdrawal successful", description: `${res.amountSol} SOL sent to ${res.toAddress.slice(0, 8)}...` });
        refetchWallet();
      },
      onError: (err) => toast({ title: "Withdrawal failed", description: err.message, variant: "destructive" }),
    });
  };

  const hasWallet = !walletLoading && !!distWallet;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-mono font-bold tracking-tight text-glow">Distributor</h1>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            Fund accounts from a master node. Collect balances back when done.
          </p>
        </div>
        {!hasWallet && !walletLoading && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="font-mono border-glow bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" /> Initialize Node
              </Button>
            </DialogTrigger>
            <DialogContent className="border-primary/20 bg-card/95 backdrop-blur-lg">
              <DialogHeader>
                <DialogTitle className="font-mono text-primary flex items-center gap-2">
                  <Wallet className="w-5 h-5" /> Create Distributor Wallet
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  Generates a new HD wallet used exclusively for distributing SOL to your trading accounts.
                </DialogDescription>
              </DialogHeader>
              <Form {...createForm}>
                <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4 mt-4">
                  <FormField control={createForm.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono">Encryption Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input type="password" placeholder="••••••••" className="font-mono pl-9 bg-background" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full font-mono mt-4" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Generating..." : "Generate Node"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {walletLoading ? (
        <Skeleton className="h-32 rounded-xl bg-card/50" />
      ) : !distWallet ? (
        <div className="flex flex-col items-center justify-center p-12 border border-dashed border-border/50 rounded-xl bg-card/30">
          <Wallet className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="font-mono text-lg font-medium">No distributor node</h3>
          <p className="font-mono text-sm text-muted-foreground mt-2 text-center max-w-sm">
            Initialize a distributor wallet to fund and collect from your accounts.
          </p>
        </div>
      ) : (
        <Card className="glass-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-primary/50 to-transparent" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-mono text-base flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-primary" />
                  Master Distribution Node
                </CardTitle>
                <CardDescription className="font-mono text-xs mt-1">
                  <SolscanLink address={distWallet.publicKey} truncate={false} />
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-primary"
                onClick={() => refreshMutation.mutate({}, { onSuccess: () => refetchWallet() })}
                disabled={refreshMutation.isPending}
              >
                <RefreshCw className={`w-4 h-4 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-3 rounded-md bg-background/50 border border-border/50">
              <span className="font-mono text-xs text-muted-foreground">SOL Balance</span>
              <span className="font-mono font-bold text-primary text-lg">
                {distWallet.solBalance != null ? `${distWallet.solBalance.toFixed(4)} SOL` : "—"}
              </span>
            </div>
            <p className="font-mono text-xs text-muted-foreground mt-3">
              HD Path: <span className="text-foreground">{distWallet.hdPath}</span>
            </p>
          </CardContent>
        </Card>
      )}

      {hasWallet && (
        <>
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-mono text-sm font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
                Target Accounts
              </h2>
              <div className="flex items-center gap-2 ml-auto">
                {wallets.length > 1 && (
                  <Select value={walletFilter} onValueChange={setWalletFilter}>
                    <SelectTrigger className="h-8 w-[150px] font-mono text-xs bg-background border-border/50">
                      <Layers className="w-3 h-3 mr-1 text-muted-foreground" />
                      <SelectValue placeholder="All Wallets" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="font-mono text-xs">All Wallets</SelectItem>
                      {wallets.map((w) => (
                        <SelectItem key={w.id} value={String(w.id)} className="font-mono text-xs">{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Badge variant="outline" className="font-mono text-xs">
                  {selectedIds.size} / {accounts?.length ?? 0} selected
                </Badge>
                <Button variant="ghost" size="sm" className="font-mono text-xs" onClick={toggleAll}>
                  {filteredAccounts.every((a) => selectedIds.has(a.id)) && filteredAccounts.length > 0 ? "Deselect All" : "Select All"}
                </Button>
              </div>
            </div>

            {accountsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-lg bg-card/50" />)}
              </div>
            ) : !accounts?.length ? (
              <div className="text-center p-8 border border-dashed border-border/50 rounded-xl text-muted-foreground font-mono text-sm">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No accounts found. Derive accounts from your wallets first.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {filteredAccounts.map((acc) => {
                  const sel = selectedIds.has(acc.id);
                  return (
                    <button
                      key={acc.id}
                      onClick={() => toggle(acc.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all font-mono text-xs
                        ${sel ? "border-primary/50 bg-primary/5 text-foreground" : "border-border/30 bg-card/30 text-muted-foreground hover:border-border/60 hover:bg-card/50"}`}
                    >
                      {sel ? <CheckSquare className="w-4 h-4 text-primary shrink-0" /> : <Square className="w-4 h-4 shrink-0" />}
                      <span className="font-semibold text-foreground">{acc.name}</span>
                      <span className="text-muted-foreground">{acc.walletName}</span>
                      <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
                        <SolscanLink address={acc.publicKey} />
                      </span>
                      <span className="text-primary">{acc.solBalance != null ? `${acc.solBalance.toFixed(3)} SOL` : "—"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex gap-3 flex-col sm:flex-row">
            <Dialog open={sendOpen} onOpenChange={setSendOpen}>
              <DialogTrigger asChild>
                <Button
                  className="flex-1 font-mono bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={selectedIds.size === 0}
                >
                  <Send className="w-4 h-4 mr-2" /> Send SOL to Selected ({selectedIds.size})
                </Button>
              </DialogTrigger>
              <DialogContent className="border-primary/20 bg-card/95 backdrop-blur-lg">
                <DialogHeader>
                  <DialogTitle className="font-mono text-primary">Send SOL from Distributor</DialogTitle>
                  <DialogDescription className="font-mono text-xs">
                    Sends the specified amount from the distributor to each of the {selectedIds.size} selected accounts.
                  </DialogDescription>
                </DialogHeader>
                <Form {...sendForm}>
                  <form onSubmit={sendForm.handleSubmit(onSendSubmit)} className="space-y-4 mt-4">
                    <FormField control={sendForm.control} name="amountSol" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono">SOL per Account</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.001" className="font-mono bg-background" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={sendForm.control} name="password" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono">Distributor Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input type="password" placeholder="••••••••" className="font-mono pl-9 bg-background" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="p-3 rounded-md bg-background/50 border border-border/50 font-mono text-xs text-muted-foreground">
                      Total: <span className="text-primary font-bold">{((sendForm.watch("amountSol") || 0) * selectedIds.size).toFixed(4)} SOL</span> across {selectedIds.size} accounts
                    </div>
                    <Button type="submit" className="w-full font-mono" disabled={sendMutation.isPending}>
                      {sendMutation.isPending ? "Sending..." : "Execute Send"}
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>

            <Dialog open={collectOpen} onOpenChange={setCollectOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="flex-1 font-mono border-primary/20 hover:border-primary/50 hover:bg-primary/5"
                  disabled={selectedIds.size === 0}
                >
                  <Download className="w-4 h-4 mr-2" /> Collect from Selected ({selectedIds.size})
                </Button>
              </DialogTrigger>
              <DialogContent className="border-primary/20 bg-card/95 backdrop-blur-lg">
                <DialogHeader>
                  <DialogTitle className="font-mono text-primary">Collect SOL to Distributor</DialogTitle>
                  <DialogDescription className="font-mono text-xs">
                    Sweeps SOL from {selectedIds.size} accounts back to the distributor, leaving a small rent reserve.
                  </DialogDescription>
                </DialogHeader>
                <Form {...collectForm}>
                  <form onSubmit={collectForm.handleSubmit(onCollectSubmit)} className="space-y-4 mt-4">
                    <FormField control={collectForm.control} name="password" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono">Account Decryption Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input type="password" placeholder="Same password used when deriving accounts" className="font-mono pl-9 bg-background text-xs" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={collectForm.control} name="leaveRentSol" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono">
                          Leave for Rent (SOL){" "}
                          <span className="text-muted-foreground font-normal text-xs">— set 0 to drain completely</span>
                        </FormLabel>
                        <FormControl>
                          <Input type="number" step="0.0001" min="0" className="font-mono bg-background" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" className="w-full font-mono" disabled={collectMutation.isPending}>
                      {collectMutation.isPending ? "Collecting..." : "Execute Collect"}
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {results && (
            <div className="space-y-3">
              <h3 className="font-mono text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Operation Results
              </h3>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {results.map((r, i) => <ResultRow key={i} r={r} />)}
              </div>
              <Button variant="ghost" size="sm" className="font-mono text-xs text-muted-foreground" onClick={() => setResults(null)}>
                Clear results
              </Button>
            </div>
          )}

          <div className="border-t border-border/30 pt-6">
            <h2 className="font-mono text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              Withdraw to External Address
            </h2>
            <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="font-mono border-primary/20 hover:border-primary/50 hover:bg-primary/5">
                  <ExternalLink className="w-4 h-4 mr-2" /> Withdraw SOL to External Wallet
                </Button>
              </DialogTrigger>
              <DialogContent className="border-primary/20 bg-card/95 backdrop-blur-lg">
                <DialogHeader>
                  <DialogTitle className="font-mono text-primary flex items-center gap-2">
                    <ExternalLink className="w-5 h-5" /> Withdraw from Distributor
                  </DialogTitle>
                  <DialogDescription className="font-mono text-xs">
                    Send SOL from the distributor wallet to any external Solana address.
                  </DialogDescription>
                </DialogHeader>
                <Form {...withdrawForm}>
                  <form onSubmit={withdrawForm.handleSubmit(onWithdrawSubmit)} className="space-y-4 mt-4">
                    <FormField control={withdrawForm.control} name="toAddress" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono">Destination Address</FormLabel>
                        <FormControl>
                          <Input placeholder="Solana wallet address" className="font-mono bg-background text-xs" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={withdrawForm.control} name="amountSol" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono">Amount (SOL)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.001" min="0.000001" className="font-mono bg-background" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={withdrawForm.control} name="password" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono">Distributor Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input type="password" placeholder="••••••••" className="font-mono pl-9 bg-background" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" className="w-full font-mono" disabled={withdrawMutation.isPending}>
                      {withdrawMutation.isPending ? "Sending..." : "Execute Withdrawal"}
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>

            {withdrawResult && (
              <div className="mt-4 flex items-start gap-3 p-3 rounded-md border border-green-500/30 bg-green-500/5 text-xs font-mono">
                <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-primary font-bold">{withdrawResult.amountSol} SOL</span>
                    <span className="text-muted-foreground">→</span>
                    <SolscanLink address={withdrawResult.toAddress} />
                  </div>
                  <SolscanLink address={withdrawResult.signature} type="tx" />
                </div>
                <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground" onClick={() => setWithdrawResult(null)}>
                  <XCircle className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
