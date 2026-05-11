import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, Key, ChevronRight, Lock, Download, Upload, FileText, AlertTriangle } from "lucide-react";
import { useListWallets, useCreateWallets, useDeleteWallet } from "@/hooks/use-wallets";
import { useDeriveAccounts } from "@/hooks/use-accounts";
import { useExportWallets } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const createWalletSchema = z.object({
  count: z.coerce.number().min(1).max(50),
  password: z.string().min(4, "Password required to encrypt mnemonics"),
});

const deriveSchema = z.object({
  count: z.coerce.number().min(1).max(100),
  password: z.string().min(1, "Password required to decrypt mnemonic"),
});

const exportSchema = z.object({
  password: z.string().min(1, "Password required"),
});

const importSchema = z.object({
  password: z.string().min(1, "Password required"),
});

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportToCSV(wallets: Array<{
  walletId: number;
  walletName: string;
  mnemonic: string;
  accounts: Array<{
    accountId: number;
    name: string;
    publicKey: string;
    privateKeyBase58: string;
    hdPath: string;
    hdIndex: number;
  }>;
}>): string {
  const rows: string[] = [
    "wallet_id,wallet_name,mnemonic,account_id,account_name,public_key,private_key_base58,hd_path,hd_index",
  ];
  for (const w of wallets) {
    if (w.accounts.length === 0) {
      rows.push(`${w.walletId},"${w.walletName}","${w.mnemonic}",,,,,`);
    } else {
      for (const a of w.accounts) {
        rows.push(
          `${w.walletId},"${w.walletName}","${w.mnemonic}",${a.accountId},"${a.name}","${a.publicKey}","${a.privateKeyBase58}","${a.hdPath}",${a.hdIndex}`
        );
      }
    }
  }
  return rows.join("\n");
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): string[][] {
  // Strip UTF-8 BOM (\uFEFF) that Excel / Windows editors often add
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  return clean
    .split("\n")
    .map(l => l.replace(/\r$/, "").trim())
    .filter(l => l.length > 0)
    .map(parseCSVLine);
}

const WALLETS_TEMPLATE =
  `name,mnemonic\n"My Wallet","abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"`;

const ACCOUNTS_TEMPLATE =
  `name,private_key\n"Account A","<paste 88-char base58 Solana private key here>"`;

export default function WalletsPage() {
  const { data: wallets, isLoading } = useListWallets();
  const createMutation = useCreateWallets();
  const deleteMutation = useDeleteWallet();
  const deriveMutation = useDeriveAccounts();
  const exportMutation = useExportWallets();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [deriveOpen, setDeriveOpen] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<"mnemonics" | "privatekeys">("mnemonics");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createForm = useForm<z.infer<typeof createWalletSchema>>({
    resolver: zodResolver(createWalletSchema),
    defaultValues: { count: 1, password: "" },
  });

  const deriveForm = useForm<z.infer<typeof deriveSchema>>({
    resolver: zodResolver(deriveSchema),
    defaultValues: { count: 5, password: "" },
  });

  const exportForm = useForm<z.infer<typeof exportSchema>>({
    resolver: zodResolver(exportSchema),
    defaultValues: { password: "" },
  });

  const importForm = useForm<z.infer<typeof importSchema>>({
    resolver: zodResolver(importSchema),
    defaultValues: { password: "" },
  });

  const onCreateSubmit = (data: z.infer<typeof createWalletSchema>) => {
    createMutation.mutate({ data }, {
      onSuccess: () => {
        setCreateOpen(false);
        createForm.reset();
        toast({ title: "Success", description: `Generated ${data.count} wallets` });
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    });
  };

  const onDeriveSubmit = (data: z.infer<typeof deriveSchema>) => {
    if (!deriveOpen) return;
    deriveMutation.mutate({ walletId: deriveOpen, data }, {
      onSuccess: () => {
        setDeriveOpen(null);
        deriveForm.reset();
        toast({ title: "Success", description: `Derived ${data.count} accounts` });
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    });
  };

  const onExportSubmit = (data: z.infer<typeof exportSchema>) => {
    exportMutation.mutate({ data: { password: data.password } }, {
      onSuccess: (exported) => {
        setExportOpen(false);
        exportForm.reset();
        const csv = exportToCSV(exported);
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        downloadFile(csv, `sol_war_room_export_${ts}.csv`, "text/csv;charset=utf-8;");
        const totalAccounts = exported.reduce((s, w) => s + w.accounts.length, 0);
        toast({ title: "Export complete", description: `${exported.length} wallets, ${totalAccounts} accounts saved to CSV.` });
      },
      onError: (err) => {
        toast({ title: "Export failed", description: err.message, variant: "destructive" });
      },
    });
  };

  const onImportSubmit = async (data: z.infer<typeof importSchema>) => {
    if (!importFile) {
      toast({ title: "No file selected", description: "Please choose a CSV file to import.", variant: "destructive" });
      return;
    }
    setImportLoading(true);
    try {
      const text = await importFile.text();
      const rows = parseCSV(text);
      if (rows.length < 2) throw new Error("CSV must have a header row and at least one data row.");

      const header = rows[0].map(h => h.toLowerCase().replace(/\s+/g, "_"));
      const dataRows = rows.slice(1);

      if (importTab === "mnemonics") {
        const nameIdx = header.indexOf("name");
        const mnemonicIdx = header.findIndex(h => h === "mnemonic");
        if (nameIdx === -1 || mnemonicIdx === -1) {
          throw new Error('CSV must have "name" and "mnemonic" columns.');
        }
        const body = {
          password: data.password,
          rows: dataRows.map(r => ({ name: r[nameIdx] ?? "", mnemonic: r[mnemonicIdx] ?? "" })).filter(r => r.name && r.mnemonic),
        };
        const res = await fetch(`${BASE}/api/wallets/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json() as { error: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const imported = await res.json() as unknown[];
        await queryClient.invalidateQueries({ queryKey: ["wallets"] });
        setImportOpen(false);
        importForm.reset();
        setImportFile(null);
        toast({ title: "Import complete", description: `${imported.length} wallet(s) imported successfully.` });
      } else {
        const nameIdx = header.indexOf("name");
        const pkIdx = header.findIndex(h => h === "private_key" || h === "privatekey" || h === "private_key_base58");
        if (nameIdx === -1 || pkIdx === -1) {
          throw new Error('CSV must have "name" and "private_key" columns.');
        }
        const body = {
          password: data.password,
          rows: dataRows.map(r => ({ name: r[nameIdx] ?? "", privateKey: r[pkIdx] ?? "" })).filter(r => r.name && r.privateKey),
        };
        const res = await fetch(`${BASE}/api/accounts/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json() as { error: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const result = await res.json() as { added: number; skipped: number };
        await queryClient.invalidateQueries({ queryKey: ["wallets"] });
        await queryClient.invalidateQueries({ queryKey: ["accounts"] });
        setImportOpen(false);
        importForm.reset();
        setImportFile(null);
        toast({
          title: "Import complete",
          description: `${result.added} account(s) imported${result.skipped > 0 ? `, ${result.skipped} skipped (duplicate)` : ""}.`,
        });
      }
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-mono font-bold tracking-tight text-glow">Identity Matrix</h1>
          <p className="text-muted-foreground font-mono text-sm mt-1">Manage HD master nodes and derived keypairs.</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Dialog open={exportOpen} onOpenChange={setExportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="font-mono border-primary/20 hover:border-primary/40 hover:bg-primary/5">
                <Download className="w-4 h-4 mr-2" /> Export
              </Button>
            </DialogTrigger>
            <DialogContent className="border-primary/20 bg-card/95 backdrop-blur-lg">
              <DialogHeader>
                <DialogTitle className="font-mono text-primary flex items-center gap-2">
                  <Download className="w-5 h-5" /> Export All Wallets
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  Decrypts and exports all wallet mnemonics and private keys as a CSV file. Store the file securely — it contains all your keys in plain text.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 font-mono text-xs text-destructive">
                WARNING: The exported CSV contains your unencrypted seed phrases and private keys. Never share this file.
              </div>
              <Form {...exportForm}>
                <form onSubmit={exportForm.handleSubmit(onExportSubmit)} className="space-y-4 mt-2">
                  <FormField control={exportForm.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono">Decryption Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input type="password" placeholder="••••••••" className="font-mono pl-9 bg-background" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" variant="destructive" className="w-full font-mono mt-4" disabled={exportMutation.isPending}>
                    {exportMutation.isPending ? "Decrypting..." : "Export to CSV"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) { importForm.reset(); setImportFile(null); } }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="font-mono border-primary/20 hover:border-primary/40 hover:bg-primary/5">
                <Upload className="w-4 h-4 mr-2" /> Import CSV
              </Button>
            </DialogTrigger>
            <DialogContent className="border-primary/20 bg-card/95 backdrop-blur-lg max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-mono text-primary flex items-center gap-2">
                  <Upload className="w-5 h-5" /> Import from CSV
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  Import wallets (seed phrases) or accounts (private keys) from a CSV file.
                </DialogDescription>
              </DialogHeader>

              <div className="flex gap-1 border-b border-border/50 mt-2">
                {(["mnemonics", "privatekeys"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => { setImportTab(tab); setImportFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className={`px-4 py-2 text-xs font-mono border-b-2 transition-colors ${importTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {tab === "mnemonics" ? "Wallets (Mnemonics)" : "Accounts (Private Keys)"}
                  </button>
                ))}
              </div>

              <div className="space-y-4 mt-2">
                <div className="p-3 rounded-md bg-muted/30 border border-border/50 space-y-2">
                  <p className="font-mono text-xs text-muted-foreground">
                    {importTab === "mnemonics"
                      ? 'CSV must have columns: name, mnemonic — one wallet per row. Each mnemonic must be a valid 12 or 24-word BIP39 seed phrase.'
                      : 'CSV must have columns: name, private_key — one account per row. Each private_key must be a base58-encoded 64-byte Solana secret key.'}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="font-mono text-xs h-7 px-2 text-primary hover:bg-primary/10"
                    onClick={() => downloadFile(
                      importTab === "mnemonics" ? WALLETS_TEMPLATE : ACCOUNTS_TEMPLATE,
                      importTab === "mnemonics" ? "wallets_import_template.csv" : "accounts_import_template.csv",
                      "text/csv;charset=utf-8;"
                    )}
                  >
                    <FileText className="w-3 h-3 mr-1" /> Download CSV Template
                  </Button>
                </div>

                <div
                  className="border-2 border-dashed border-border/50 rounded-lg p-6 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                  />
                  {importFile ? (
                    <div className="flex items-center justify-center gap-2 text-primary font-mono text-sm">
                      <FileText className="w-4 h-4" />
                      {importFile.name}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="w-6 h-6 text-muted-foreground mx-auto" />
                      <p className="font-mono text-xs text-muted-foreground">Click to select CSV file</p>
                    </div>
                  )}
                </div>

                {importTab === "privatekeys" && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/30 font-mono text-xs text-yellow-400">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    <span>Private keys will be stored under a wallet named "Imported Keys" and encrypted with the password below.</span>
                  </div>
                )}

                <Form {...importForm}>
                  <form onSubmit={importForm.handleSubmit(onImportSubmit)} className="space-y-4">
                    <FormField control={importForm.control} name="password" render={({ field }) => (
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
                    <Button type="submit" className="w-full font-mono" disabled={importLoading || !importFile}>
                      {importLoading ? "Importing..." : `Import ${importTab === "mnemonics" ? "Wallets" : "Accounts"}`}
                    </Button>
                  </form>
                </Form>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="font-mono border-glow bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" /> Generate Nodes
              </Button>
            </DialogTrigger>
            <DialogContent className="border-primary/20 bg-card/95 backdrop-blur-lg">
              <DialogHeader>
                <DialogTitle className="font-mono text-primary flex items-center gap-2">
                  <Key className="w-5 h-5" /> Initialize HD Wallets
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  Mnemonics will be generated securely and encrypted with your password before database storage.
                </DialogDescription>
              </DialogHeader>
              <Form {...createForm}>
                <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4 mt-4">
                  <FormField control={createForm.control} name="count" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono">Node Count</FormLabel>
                      <FormControl>
                        <Input type="number" className="font-mono bg-background" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={createForm.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono">Encryption Key</FormLabel>
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
                    {createMutation.isPending ? "Generating..." : "Execute Generation"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-xl bg-card/50" />)}
        </div>
      ) : !wallets?.length ? (
        <div className="flex flex-col items-center justify-center p-12 border border-dashed border-border/50 rounded-xl bg-card/30">
          <Key className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="font-mono text-lg font-medium text-foreground">No nodes found</h3>
          <p className="font-mono text-sm text-muted-foreground mt-2 text-center max-w-sm">
            Generate your first HD wallet or import an existing one using the buttons above.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {wallets.map(wallet => (
            <Card key={wallet.id} className="glass-panel overflow-hidden group">
              <div className="h-1 w-full bg-gradient-to-r from-primary/50 to-transparent"></div>
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="font-mono text-lg">{wallet.name}</CardTitle>
                    <CardDescription className="font-mono text-xs mt-1">
                      ID: {wallet.id.toString().padStart(4, '0')}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mr-2 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => {
                      if (confirm("Delete this node and all derived accounts? This cannot be undone.")) {
                        deleteMutation.mutate({ walletId: wallet.id });
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-md bg-background/50 border border-border/50">
                  <span className="font-mono text-xs text-muted-foreground">Derived Keys</span>
                  <span className="font-mono font-bold text-primary">{wallet.accountCount}</span>
                </div>

                <Dialog open={deriveOpen === wallet.id} onOpenChange={(open) => setDeriveOpen(open ? wallet.id : null)}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="w-full font-mono text-xs border-primary/20 hover:border-primary/50 hover:bg-primary/5">
                      Derive Sub-accounts <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="border-primary/20 bg-card/95 backdrop-blur-lg">
                    <DialogHeader>
                      <DialogTitle className="font-mono text-primary">Derive from {wallet.name}</DialogTitle>
                      <DialogDescription className="font-mono text-xs">
                        Enter your decryption password to access the master seed and derive new child keypairs.
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...deriveForm}>
                      <form onSubmit={deriveForm.handleSubmit(onDeriveSubmit)} className="space-y-4 mt-4">
                        <FormField control={deriveForm.control} name="count" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-mono">Amount to derive</FormLabel>
                            <FormControl>
                              <Input type="number" className="font-mono bg-background" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={deriveForm.control} name="password" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-mono">Master Decryption Key</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input type="password" placeholder="••••••••" className="font-mono pl-9 bg-background" {...field} />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <Button type="submit" className="w-full font-mono mt-4" disabled={deriveMutation.isPending}>
                          {deriveMutation.isPending ? "Deriving..." : "Execute Derivation"}
                        </Button>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
