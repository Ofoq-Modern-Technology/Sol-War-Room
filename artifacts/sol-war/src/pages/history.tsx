import { useListTransactions } from "@/hooks/use-transactions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ExternalLink, Database } from "lucide-react";

export default function HistoryPage() {
  const { data: transactions, isLoading } = useListTransactions();

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <h1 className="text-3xl font-mono font-bold text-glow flex items-center gap-3">
        <Database className="w-8 h-8" /> On-Chain Log
      </h1>
      <p className="text-muted-foreground font-mono text-sm">Review historical execution data across all nodes.</p>

      <div className="glass-panel rounded-xl overflow-hidden border border-border/50">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full bg-accent/20" />)}
          </div>
        ) : !transactions?.length ? (
          <div className="p-12 text-center text-muted-foreground font-mono">No transaction data available.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-background/80 sticky top-0">
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="font-mono text-xs">Timestamp</TableHead>
                  <TableHead className="font-mono text-xs">Unit</TableHead>
                  <TableHead className="font-mono text-xs">Type</TableHead>
                  <TableHead className="font-mono text-xs">Token</TableHead>
                  <TableHead className="font-mono text-xs text-right">Amount (SOL)</TableHead>
                  <TableHead className="font-mono text-xs text-center">Status</TableHead>
                  <TableHead className="font-mono text-xs text-right">Signature</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map(tx => (
                  <TableRow key={tx.id} className="border-border/30 hover:bg-accent/10">
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {format(new Date(tx.createdAt), "MM-dd HH:mm:ss")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>{tx.accountName}</div>
                      <div className="text-[10px] text-muted-foreground">{tx.walletName}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase
                        ${tx.type === 'buy' ? 'border-primary text-primary' : 
                          tx.type === 'sell' ? 'border-destructive text-destructive' : 
                          'border-accent text-accent'}`}
                      >
                        {tx.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tx.tokenSymbol || tx.mintAddress.slice(0, 6) + '...'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-right text-muted-foreground">
                      {tx.amountIn ? <span className="text-primary">+{tx.amountIn.toFixed(4)}</span> : null}
                      {tx.amountOut ? <span className="text-destructive">-{tx.amountOut.toFixed(4)}</span> : null}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <div className={`w-2 h-2 rounded-full 
                          ${tx.status === 'success' ? 'bg-primary shadow-[0_0_5px_hsl(var(--primary))]' : 
                            tx.status === 'failed' ? 'bg-destructive shadow-[0_0_5px_hsl(var(--destructive))]' : 
                            'bg-yellow-500 animate-pulse'}`} 
                          title={tx.status}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {tx.txSignature ? (
                        <a 
                          href={`https://solscan.io/tx/${tx.txSignature}`} 
                          target="_blank" 
                          rel="noreferrer"
                          className="inline-flex items-center text-primary/70 hover:text-primary transition-colors"
                        >
                          <span className="font-mono text-[10px] mr-1">{tx.txSignature.slice(0, 8)}...</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="font-mono text-[10px] text-destructive">Failed</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
