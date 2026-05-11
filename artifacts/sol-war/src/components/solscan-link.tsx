import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface SolscanLinkProps {
  address: string;
  type?: "account" | "tx" | "token";
  truncate?: boolean;
  className?: string;
  showIcon?: boolean;
}

export function SolscanLink({
  address,
  type = "account",
  truncate = true,
  className,
  showIcon = true,
}: SolscanLinkProps) {
  const href = `https://solscan.io/${type}/${address}`;
  const display = truncate
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs rounded px-2 py-0.5",
        "bg-background border border-border/50 text-muted-foreground",
        "hover:border-primary/50 hover:text-primary transition-colors cursor-pointer",
        className,
      )}
      title={address}
    >
      {display}
      {showIcon && <ExternalLink className="w-2.5 h-2.5 opacity-60" />}
    </a>
  );
}

/** Full-width address link — for table cells */
export function SolscanAddressCell({ address, className }: { address: string; className?: string }) {
  return (
    <SolscanLink
      address={address}
      truncate={false}
      showIcon={true}
      className={cn("text-[11px] max-w-[200px] truncate inline-block", className)}
    />
  );
}
