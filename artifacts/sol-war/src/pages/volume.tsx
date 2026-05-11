import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Play, StopCircle, RefreshCcw, Activity } from "lucide-react";
import { useStartVolumeJob, useListVolumeJobs, useStopVolumeJob } from "@/hooks/use-volume";
import { useAccountStore } from "@/store/use-account-store";
import { useToast } from "@/hooks/use-toast";
import { AccountSelector } from "@/components/account-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const volumeSchema = z.object({
  mintAddress: z.string().min(1, "Mint address is required"),
  minAmountSol: z.coerce.number().min(0.0001),
  maxAmountSol: z.coerce.number().min(0.0001),
  minDelayMs: z.coerce.number().min(100),
  maxDelayMs: z.coerce.number().min(100),
  totalDurationMinutes: z.coerce.number().min(1).max(1440),
  pattern: z.enum(["random", "wash", "ladder"]).default("random"),
  password: z.string().min(1, "Password required"),
});

export default function VolumePage() {
  const { data: jobs, isLoading: jobsLoading } = useListVolumeJobs();
  const startMutation = useStartVolumeJob();
  const stopMutation = useStopVolumeJob();
  const { selectedIds } = useAccountStore();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof volumeSchema>>({
    resolver: zodResolver(volumeSchema),
    defaultValues: {
      minAmountSol: 0.05,
      maxAmountSol: 0.2,
      minDelayMs: 2000,
      maxDelayMs: 8000,
      totalDurationMinutes: 60,
      pattern: "random",
      password: ""
    }
  });

  const onSubmit = (data: z.infer<typeof volumeSchema>) => {
    if (selectedIds.size === 0) return toast({ title: "Error", description: "Select accounts first", variant: "destructive" });
    
    startMutation.mutate({
      data: {
        ...data,
        accountIds: Array.from(selectedIds)
      }
    }, {
      onSuccess: () => {
        toast({ title: "Job Started", description: "Volume generation sequence initiated." });
        form.reset({ ...data, password: "" });
      },
      onError: (err) => toast({ title: "Failed to start", description: err.message, variant: "destructive" })
    });
  };

  const activeJobs = jobs?.filter(j => j.status === "running") || [];
  const pastJobs = jobs?.filter(j => j.status !== "running") || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <h1 className="text-3xl font-mono font-bold text-glow text-accent-foreground flex items-center gap-3">
        <Activity className="w-8 h-8" /> Volume Generator
      </h1>
      
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Config Panel */}
        <div className="space-y-6">
          <AccountSelector />
          
          <Card className="glass-panel border-accent/30">
            <CardHeader className="pb-4">
              <CardTitle className="font-mono text-accent flex items-center gap-2 text-lg">
                <RefreshCcw className="w-5 h-5" /> Job Parameters
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  <FormField control={form.control} name="mintAddress" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs">Target Mint Address</FormLabel>
                      <FormControl><Input className="font-mono bg-background" placeholder="Token contract..." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="minAmountSol" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Min SOL / Trade</FormLabel>
                        <FormControl><Input type="number" step="0.001" className="font-mono bg-background" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="maxAmountSol" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Max SOL / Trade</FormLabel>
                        <FormControl><Input type="number" step="0.001" className="font-mono bg-background" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="minDelayMs" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Min Delay (ms)</FormLabel>
                        <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="maxDelayMs" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Max Delay (ms)</FormLabel>
                        <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="totalDurationMinutes" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Duration (Mins)</FormLabel>
                        <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="pattern" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs text-muted-foreground">Trade Pattern</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="font-mono bg-background">
                              <SelectValue placeholder="Select pattern" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="random">Chaotic (Random)</SelectItem>
                            <SelectItem value="wash">Wash (Buy/Sell)</SelectItem>
                            <SelectItem value="ladder">Ladder Build</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs text-accent">Decryption Password</FormLabel>
                      <FormControl><Input type="password" placeholder="Master Key" className="font-mono bg-background border-accent/50" {...field} /></FormControl>
                    </FormItem>
                  )} />

                  <Button type="submit" className="w-full font-mono bg-accent text-accent-foreground hover:bg-accent/90" disabled={startMutation.isPending}>
                    {startMutation.isPending ? "INITIALIZING..." : <><Play className="w-4 h-4 mr-2" /> START SEQUENCE</>}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* Active Jobs */}
        <div className="space-y-6">
          <Card className="glass-panel border-primary/20">
            <CardHeader className="pb-4 border-b border-border/50">
              <CardTitle className="font-mono text-sm uppercase tracking-widest text-primary flex justify-between">
                <span>Active Sequences</span>
                <span className="animate-pulse flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {activeJobs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground font-mono text-xs">No active volume sequences running.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-background/50 hover:bg-background/50">
                      <TableHead className="font-mono text-[10px]">Token</TableHead>
                      <TableHead className="font-mono text-[10px]">Stats</TableHead>
                      <TableHead className="font-mono text-[10px] text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeJobs.map(job => (
                      <TableRow key={job.id}>
                        <TableCell className="font-mono text-xs">
                          {job.tokenSymbol || job.mintAddress.slice(0, 8)}...
                          <Badge variant="outline" className="ml-2 text-[8px] uppercase">{job.pattern}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground space-y-1">
                          <div>V: <span className="text-primary">{job.totalVolumeSol.toFixed(2)} SOL</span></div>
                          <div>T: <span className="text-foreground">{job.successfulTrades} / {job.totalTrades}</span></div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="destructive" 
                            size="sm" 
                            onClick={() => stopMutation.mutate({ jobId: job.id })}
                            disabled={stopMutation.isPending}
                            className="font-mono text-[10px] h-6 px-2"
                          >
                            <StopCircle className="w-3 h-3 mr-1" /> KILL
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          
          <Card className="glass-panel opacity-80">
            <CardHeader className="pb-4 border-b border-border/50">
              <CardTitle className="font-mono text-xs text-muted-foreground uppercase tracking-widest">Completed / Terminated</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[300px] overflow-y-auto">
                <Table>
                  <TableBody>
                    {pastJobs.map(job => (
                      <TableRow key={job.id} className="opacity-70">
                        <TableCell className="font-mono text-[10px]">{job.tokenSymbol || job.mintAddress.slice(0, 6)}</TableCell>
                        <TableCell className="font-mono text-[10px]">Vol: {job.totalVolumeSol.toFixed(2)}</TableCell>
                        <TableCell className="font-mono text-[10px] text-right">
                          <Badge variant="secondary" className="text-[8px] bg-background border-border">{job.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
