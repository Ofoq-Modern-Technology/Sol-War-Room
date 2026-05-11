import { useState, useMemo } from "react";
import { useListAllAccounts } from "@/hooks/use-accounts";
import { useAccountStore } from "@/store/use-account-store";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Layers } from "lucide-react";
import { SolscanLink } from "@/components/solscan-link";

export function AccountSelector() {
  const { data: accounts, isLoading } = useListAllAccounts();
  const { selectedIds, toggle, toggleAll } = useAccountStore();
  const [walletFilter, setWalletFilter] = useState<string>("all");

  const wallets = useMemo(() => {
    if (!accounts) return [];
    const map = new Map<number, string>();
    for (const acc of accounts) {
      if (!map.has(acc.walletId)) map.set(acc.walletId, acc.walletName ?? `Wallet ${acc.walletId}`);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [accounts]);

  const filtered = useMemo(() => {
    if (!accounts) return [];
    if (walletFilter === "all") return accounts;
    return accounts.filter((a) => String(a.walletId) === walletFilter);
  }, [accounts, walletFilter]);

  if (isLoading) {
    return <Skeleton className="w-full h-[300px] rounded-md bg-card/50" />;
  }

  if (!accounts || accounts.length === 0) {
    return (
      <div className="p-8 text-center border border-dashed rounded-md bg-card/30">
        <p className="text-muted-foreground font-mono text-sm">No accounts found. Create a wallet first.</p>
      </div>
    );
  }

  const allSelected = filtered.length > 0 && filtered.every(a => selectedIds.has(a.id));
  const someSelected = filtered.some(a => selectedIds.has(a.id)) && !allSelected;

  const handleSelectAll = () => {
    toggleAll(filtered.map(a => a.id), !allSelected);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 justify-between">
        <h3 className="text-sm font-mono font-bold text-foreground shrink-0">Select Target Accounts</h3>
        <div className="flex items-center gap-2 ml-auto">
          {wallets.length > 1 && (
            <Select value={walletFilter} onValueChange={setWalletFilter}>
              <SelectTrigger className="h-8 w-[160px] font-mono text-xs bg-background border-border/50">
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
          <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
            {selectedIds.size} / {accounts.length} selected
          </span>
        </div>
      </div>
      <div className="border border-border/50 rounded-md overflow-hidden bg-card/50">
        <div className="max-h-[300px] overflow-y-auto">
          <Table>
            <TableHeader className="bg-card sticky top-0 z-10 shadow-sm">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[50px] text-center">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={handleSelectAll}
                    className="border-muted-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                </TableHead>
                <TableHead className="font-mono text-xs">Wallet</TableHead>
                <TableHead className="font-mono text-xs">Account</TableHead>
                <TableHead className="font-mono text-xs">Address</TableHead>
                <TableHead className="font-mono text-xs text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center font-mono text-xs text-muted-foreground py-8">
                    No accounts in this wallet.
                  </TableCell>
                </TableRow>
              ) : filtered.map((acc) => (
                <TableRow
                  key={acc.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => toggle(acc.id)}
                >
                  <TableCell className="text-center">
                    <Checkbox
                      checked={selectedIds.has(acc.id)}
                      onCheckedChange={() => toggle(acc.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="border-muted-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{acc.walletName}</TableCell>
                  <TableCell className="font-mono text-xs font-medium text-foreground">{acc.name}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <SolscanLink address={acc.publicKey} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right text-primary">
                    {acc.solBalance != null ? `${acc.solBalance.toFixed(4)} SOL` : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
