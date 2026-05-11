import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Search, Rocket, TrendingDown, Target, Zap, ShieldAlert, Lock, RefreshCw, TrendingUp, Minus, Shuffle } from "lucide-react";
import { useGetTokenInfo } from "@/hooks/use-tokens";
import { useExecuteBuy, useExecuteSell, fetchPositions } from "@/hooks/use-trades";
import type { AccountPosition } from "@workspace/api-client-react";
import { useAccountStore } from "@/store/use-account-store";
import { useToast } from "@/hooks/use-toast";
import { AccountSelector } from "@/components/account-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

const buySchema = z.object({
  randomMode: z.boolean().default(false),
  amountSol: z.coerce.number().min(0.0001, "Min 0.0001 SOL").optional(),
  minAmountSol: z.coerce.number().min(0.0001, "Min 0.0001 SOL").optional(),
  maxAmountSol: z.coerce.number().min(0.0001, "Min 0.0001 SOL").optional(),
  slippageBps: z.coerce.number().min(1).default(500),
  useJito: z.boolean().default(true),
  jitoTipLamports: z.coerce.number().min(0).default(10000),
  delayMs: z.coerce.number().min(0).default(0),
  password: z.string().min(1, "Password required")
}).refine((d) => {
  if (d.randomMode) return d.minAmountSol !== undefined && d.maxAmountSol !== undefined && d.maxAmountSol > d.minAmountSol!;
  return d.amountSol !== undefined && d.amountSol > 0;
}, { message: "Set a valid amount or range", path: ["amountSol"] });

const sellSchema = z.object({
  percentToSell: z.coerce.number().min(1).max(100).default(100),
  slippageBps: z.coerce.number().min(1).default(500),
  useJito: z.boolean().default(true),
  jitoTipLamports: z.coerce.number().min(0).default(10000),
  delayMs: z.coerce.number().min(0).default(0),
  password: z.string().min(1, "Password required")
});

function PnlBadge({ pct }: { pct: number }) {
  if (pct > 0) return <span className="text-green-400 font-mono text-xs">+{pct.toFixed(1)}%</span>;
  if (pct < 0) return <span className="text-red-400 font-mono text-xs">{pct.toFixed(1)}%</span>;
  return <span className="text-muted-foreground font-mono text-xs">0.0%</span>;
}

function PositionRow({ pos }: { pos: AccountPosition }) {
  const isProfit = pos.pnlSol >= 0;
  return (
    <div className={`p-3 rounded-md border text-xs font-mono space-y-1.5 ${isProfit ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground truncate max-w-[120px]">{pos.accountName}</span>
        <div className="flex items-center gap-1.5">
          {isProfit ? <TrendingUp className="w-3 h-3 text-green-400" /> : <TrendingDown className="w-3 h-3 text-red-400" />}
          <PnlBadge pct={pos.pnlPct} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
        <span className="text-muted-foreground">Invested:</span>
        <span>{pos.totalSolIn.toFixed(4)} SOL</span>
        <span className="text-muted-foreground">Holding:</span>
        <span>{pos.tokenBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
        <span className="text-muted-foreground">Now worth:</span>
        <span>{pos.currentValueSol.toFixed(4)} SOL</span>
        <span className="text-muted-foreground">P&L:</span>
        <span className={isProfit ? "text-green-400" : "text-red-400"}>
          {isProfit ? "+" : ""}{pos.pnlSol.toFixed(4)} SOL
        </span>
        {pos.buyCount === 0 && (
          <>
            <span className="text-muted-foreground col-span-2 text-center mt-1 opacity-60">No buys recorded</span>
          </>
        )}
      </div>
    </div>
  );
}

export default function TradePage() {
  const [mintAddress, setMintAddress] = useState("");
  const { data: tokenInfo, mutate: fetchToken, isPending: isFetchingToken } = useGetTokenInfo();
  const buyMutation = useExecuteBuy();
  const sellMutation = useExecuteSell();
  const { selectedIds } = useAccountStore();
  const { toast } = useToast();

  const [positions, setPositions] = useState<AccountPosition[] | null>(null);
  const [loadingPositions, setLoadingPositions] = useState(false);

  // Pick up mint address passed from Token Radar "Use in Trade" button
  useEffect(() => {
    const prefilledMint = sessionStorage.getItem("tradeInputMint");
    if (prefilledMint) {
      setMintAddress(prefilledMint);
      sessionStorage.removeItem("tradeInputMint");
    }
  }, []);
  const [tradeResults, setTradeResults] = useState<Array<{ accountName: string; status: string; error?: string | null; amountIn?: number | null; txSignature?: string | null }> | null>(null);

  const buyForm = useForm<z.infer<typeof buySchema>>({
    resolver: zodResolver(buySchema),
    defaultValues: { randomMode: false, amountSol: 0.1, minAmountSol: 0.01, maxAmountSol: 0.02, slippageBps: 500, useJito: true, jitoTipLamports: 10000, delayMs: 0, password: "" }
  });

  const sellForm = useForm<z.infer<typeof sellSchema>>({
    resolver: zodResolver(sellSchema),
    defaultValues: { percentToSell: 100, slippageBps: 500, useJito: true, jitoTipLamports: 10000, delayMs: 0, password: "" }
  });

  const randomMode = buyForm.watch("randomMode");

  const handleFetchToken = () => {
    if (!mintAddress) return;
    fetchToken({ data: { mintAddress } });
    setPositions(null);
    setTradeResults(null);
  };

  const handleRefreshPnl = async () => {
    if (!tokenInfo?.mintAddress || selectedIds.size === 0) return;
    setLoadingPositions(true);
    try {
      const data = await fetchPositions(tokenInfo.mintAddress, Array.from(selectedIds));
      setPositions(data);
    } catch (err) {
      toast({ title: "P&L Error", description: err instanceof Error ? err.message : "Failed to load positions", variant: "destructive" });
    } finally {
      setLoadingPositions(false);
    }
  };

  const onBuySubmit = (data: z.infer<typeof buySchema>) => {
    if (!tokenInfo?.mintAddress) return toast({ title: "Error", description: "Fetch token first", variant: "destructive" });
    if (selectedIds.size === 0) return toast({ title: "Error", description: "Select accounts first", variant: "destructive" });

    const payload: Record<string, unknown> = {
      mintAddress: tokenInfo.mintAddress,
      accountIds: Array.from(selectedIds),
      slippageBps: data.slippageBps,
      useJito: data.useJito,
      jitoTipLamports: data.jitoTipLamports,
      delayMs: data.delayMs,
      password: data.password,
    };

    if (data.randomMode) {
      payload.minAmountSol = data.minAmountSol;
      payload.maxAmountSol = data.maxAmountSol;
    } else {
      payload.amountSol = data.amountSol;
    }

    buyMutation.mutate({ data: payload as Parameters<typeof buyMutation.mutate>[0]["data"] }, {
      onSuccess: (results) => {
        toast({ title: "Executed", description: `${results.filter(r => r.status === "success").length}/${results.length} buys succeeded` });
        setTradeResults(results);
        buyForm.setValue("password", "");
      },
      onError: (err) => toast({ title: "Execution Failed", description: err.message, variant: "destructive" })
    });
  };

  const onSellSubmit = (data: z.infer<typeof sellSchema>) => {
    if (!tokenInfo?.mintAddress) return toast({ title: "Error", description: "Fetch token first", variant: "destructive" });
    if (selectedIds.size === 0) return toast({ title: "Error", description: "Select accounts first", variant: "destructive" });

    sellMutation.mutate({
      data: {
        ...data,
        mintAddress: tokenInfo.mintAddress,
        accountIds: Array.from(selectedIds)
      }
    }, {
      onSuccess: (results) => {
        toast({ title: "Executed", description: `${results.filter(r => r.status === "success").length}/${results.length} sells succeeded` });
        setTradeResults(results);
        sellForm.setValue("password", "");
      },
      onError: (err) => toast({ title: "Execution Failed", description: err.message, variant: "destructive" })
    });
  };

  const totalPnl = positions ? positions.reduce((s, p) => s + p.pnlSol, 0) : 0;
  const totalIn = positions ? positions.reduce((s, p) => s + p.totalSolIn, 0) : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <h1 className="text-3xl font-mono font-bold text-glow">Tactical Execution</h1>
      
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Side: Execution Panel */}
        <div className="xl:col-span-2 space-y-6">
          
          <Card className="glass-panel">
            <CardContent className="p-4 space-y-4">
              <div className="flex gap-2">
                <Input 
                  placeholder="Target Mint Address..." 
                  className="font-mono bg-background"
                  value={mintAddress}
                  onChange={(e) => setMintAddress(e.target.value)}
                />
                <Button onClick={handleFetchToken} disabled={isFetchingToken} className="font-mono border-glow">
                  <Search className="w-4 h-4 mr-2" /> Target
                </Button>
              </div>

              {tokenInfo && (
                <div className="flex items-center gap-4 p-3 bg-primary/10 border border-primary/20 rounded-md">
                  {tokenInfo.logoUri && <img src={tokenInfo.logoUri} alt="logo" className="w-10 h-10 rounded-full" />}
                  <div>
                    <h3 className="font-bold text-primary font-mono">{tokenInfo.name} ({tokenInfo.symbol})</h3>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px] font-mono border-primary/50 text-primary">{tokenInfo.dex}</Badge>
                      {tokenInfo.graduated && <Badge variant="outline" className="text-[10px] font-mono border-accent text-accent">GRADUATED</Badge>}
                    </div>
                  </div>
                  <div className="ml-auto text-right font-mono text-sm space-y-1">
                    <p><span className="text-muted-foreground">PRICE:</span> ${tokenInfo.price?.toFixed(6) || '---'}</p>
                    <p><span className="text-muted-foreground">MCAP:</span> ${tokenInfo.marketCap?.toLocaleString() || '---'}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <AccountSelector />

          <Tabs defaultValue="buy" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-card/80 border border-border/50 h-12">
              <TabsTrigger value="buy" className="font-mono data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <Rocket className="w-4 h-4 mr-2" /> STRIKE (BUY)
              </TabsTrigger>
              <TabsTrigger value="sell" className="font-mono data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">
                <TrendingDown className="w-4 h-4 mr-2" /> DUMP (SELL)
              </TabsTrigger>
            </TabsList>
            
            {/* BUY TAB */}
            <TabsContent value="buy">
              <Card className="glass-panel border-primary/30">
                <CardContent className="p-6">
                  <Form {...buyForm}>
                    <form onSubmit={buyForm.handleSubmit(onBuySubmit)} className="space-y-6">

                      {/* Random Mode Toggle */}
                      <div className="flex items-center justify-between border border-border/50 p-3 rounded-md bg-background/50">
                        <FormField control={buyForm.control} name="randomMode" render={({ field }) => (
                          <FormItem className="flex items-center gap-2 space-y-0">
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <FormLabel className="font-mono text-xs flex items-center">
                              <Shuffle className="w-3 h-3 text-primary mr-1" /> Random Amount Mode
                            </FormLabel>
                          </FormItem>
                        )} />
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {randomMode ? "Each wallet gets a random amount in the range" : "All wallets buy the same fixed amount"}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Amount fields — toggle between fixed and random */}
                        {randomMode ? (
                          <>
                            <FormField control={buyForm.control} name="minAmountSol" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="font-mono text-xs text-muted-foreground">Min Amount (SOL)</FormLabel>
                                <FormControl><Input type="number" step="0.001" className="font-mono bg-background border-primary/50" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={buyForm.control} name="maxAmountSol" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="font-mono text-xs text-muted-foreground">Max Amount (SOL)</FormLabel>
                                <FormControl><Input type="number" step="0.001" className="font-mono bg-background border-primary/50" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                          </>
                        ) : (
                          <FormField control={buyForm.control} name="amountSol" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="font-mono text-xs text-muted-foreground">Amount per Wallet (SOL)</FormLabel>
                              <FormControl><Input type="number" step="0.0001" className="font-mono bg-background" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        )}
                        <FormField control={buyForm.control} name="slippageBps" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-mono text-xs text-muted-foreground">Slippage (BPS)</FormLabel>
                            <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                          </FormItem>
                        )} />
                        <FormField control={buyForm.control} name="delayMs" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-mono text-xs text-muted-foreground">Stagger Delay (ms)</FormLabel>
                            <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                          </FormItem>
                        )} />
                        <FormField control={buyForm.control} name="jitoTipLamports" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-mono text-xs text-muted-foreground">Jito Tip (Lamports)</FormLabel>
                            <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                          </FormItem>
                        )} />
                      </div>
                      
                      <div className="flex items-center space-x-2 border border-border/50 p-3 rounded-md bg-background/50">
                        <FormField control={buyForm.control} name="useJito" render={({ field }) => (
                          <FormItem className="flex items-center gap-2 space-y-0">
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <FormLabel className="font-mono text-xs flex items-center">
                              <Zap className="w-3 h-3 text-yellow-500 mr-1" /> Use Jito MEV Bundler
                            </FormLabel>
                          </FormItem>
                        )} />
                      </div>

                      <FormField control={buyForm.control} name="password" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs flex items-center text-primary">
                            <Lock className="w-3 h-3 mr-1" /> Decrypt Key
                          </FormLabel>
                          <FormControl><Input type="password" placeholder="Master Password" className="font-mono bg-background border-primary/50" {...field} /></FormControl>
                        </FormItem>
                      )} />

                      <Button type="submit" className="w-full h-12 font-mono font-bold text-lg border-glow" disabled={buyMutation.isPending || !tokenInfo}>
                        {buyMutation.isPending ? "EXECUTING..." : "LAUNCH BUY STRIKE"}
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            </TabsContent>

            {/* SELL TAB */}
            <TabsContent value="sell">
              <Card className="glass-panel border-destructive/30">
                <CardContent className="p-6">
                  <Form {...sellForm}>
                    <form onSubmit={sellForm.handleSubmit(onSellSubmit)} className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField control={sellForm.control} name="percentToSell" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-mono text-xs text-muted-foreground">Percent to Dump (%)</FormLabel>
                            <FormControl><Input type="number" min="1" max="100" className="font-mono bg-background border-destructive/50 focus-visible:ring-destructive" {...field} /></FormControl>
                          </FormItem>
                        )} />
                        <FormField control={sellForm.control} name="slippageBps" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-mono text-xs text-muted-foreground">Slippage (BPS)</FormLabel>
                            <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                          </FormItem>
                        )} />
                         <FormField control={sellForm.control} name="delayMs" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-mono text-xs text-muted-foreground">Stagger Delay (ms)</FormLabel>
                            <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                          </FormItem>
                        )} />
                        <FormField control={sellForm.control} name="jitoTipLamports" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-mono text-xs text-muted-foreground">Jito Tip (Lamports)</FormLabel>
                            <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                          </FormItem>
                        )} />
                      </div>
                      
                      <div className="flex items-center space-x-2 border border-border/50 p-3 rounded-md bg-background/50">
                        <FormField control={sellForm.control} name="useJito" render={({ field }) => (
                          <FormItem className="flex items-center gap-2 space-y-0">
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <FormLabel className="font-mono text-xs flex items-center">
                              <Zap className="w-3 h-3 text-yellow-500 mr-1" /> Use Jito MEV Bundler
                            </FormLabel>
                          </FormItem>
                        )} />
                      </div>

                      <FormField control={sellForm.control} name="password" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs flex items-center text-destructive">
                            <Lock className="w-3 h-3 mr-1" /> Decrypt Key
                          </FormLabel>
                          <FormControl><Input type="password" placeholder="Master Password" className="font-mono bg-background border-destructive/50" {...field} /></FormControl>
                        </FormItem>
                      )} />

                      <Button type="submit" variant="destructive" className="w-full h-12 font-mono font-bold text-lg" disabled={sellMutation.isPending || !tokenInfo}>
                        {sellMutation.isPending ? "EXECUTING..." : "EXECUTE FULL DUMP"}
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Side: P&L + Trade Results */}
        <div className="xl:col-span-1 space-y-4">
          
          {/* P&L Panel */}
          <Card className="glass-panel">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <h3 className="font-mono text-sm text-muted-foreground flex items-center gap-2">
                  <Target className="w-4 h-4" /> Position P&L
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs h-7 px-2"
                  disabled={!tokenInfo || selectedIds.size === 0 || loadingPositions}
                  onClick={handleRefreshPnl}
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${loadingPositions ? "animate-spin" : ""}`} />
                  {loadingPositions ? "Loading..." : "Refresh"}
                </Button>
              </div>

              {!tokenInfo && (
                <div className="flex items-center justify-center h-24 opacity-40">
                  <p className="font-mono text-xs text-center">Fetch a token first,<br />then refresh P&L</p>
                </div>
              )}

              {tokenInfo && !positions && !loadingPositions && (
                <div className="flex items-center justify-center h-24 opacity-40">
                  <div className="text-center">
                    <ShieldAlert className="w-8 h-8 mx-auto text-primary mb-2" />
                    <p className="font-mono text-xs">Select wallets &amp; click Refresh</p>
                  </div>
                </div>
              )}

              {positions && positions.length > 0 && (
                <div className="space-y-2">
                  {positions.map((pos) => <PositionRow key={pos.accountId} pos={pos} />)}

                  {/* Total row */}
                  <div className={`p-3 rounded-md border font-mono text-xs space-y-1 ${totalPnl >= 0 ? "border-green-500/50 bg-green-500/10" : "border-red-500/50 bg-red-500/10"}`}>
                    <div className="flex items-center justify-between font-bold">
                      <span className="text-muted-foreground">TOTAL</span>
                      <div className="flex items-center gap-1">
                        {totalPnl >= 0 ? <TrendingUp className="w-3 h-3 text-green-400" /> : <TrendingDown className="w-3 h-3 text-red-400" />}
                        <span className={totalPnl >= 0 ? "text-green-400" : "text-red-400"}>
                          {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(4)} SOL
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Total in: {totalIn.toFixed(4)} SOL</span>
                      <span>{totalIn > 0 ? ((totalPnl / totalIn) * 100).toFixed(1) : "0.0"}% overall</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Trade Results Panel */}
          {tradeResults && (
            <Card className="glass-panel">
              <CardContent className="p-4 space-y-2">
                <h3 className="font-mono text-sm text-muted-foreground border-b border-border/50 pb-2">Last Execution</h3>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {tradeResults.map((r, i) => (
                    <div key={i} className={`flex items-center justify-between text-xs font-mono p-1.5 rounded ${r.status === "success" ? "bg-green-500/10" : "bg-red-500/10"}`}>
                      <span className="truncate max-w-[120px] text-muted-foreground">{r.accountName}</span>
                      {r.status === "success" ? (
                        <span className="text-green-400">{r.amountIn?.toFixed(4)} SOL ✓</span>
                      ) : (
                        <span className="text-red-400 truncate max-w-[100px]">{r.error}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/30">
                  {tradeResults.filter(r => r.status === "success").length}/{tradeResults.length} succeeded
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
