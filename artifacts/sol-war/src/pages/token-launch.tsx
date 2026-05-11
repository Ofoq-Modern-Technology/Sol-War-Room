import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Rocket, Upload, X, ExternalLink, Loader2, Twitter, Globe, Send } from "lucide-react";
import { useListAllAccounts } from "@/hooks/use-accounts";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SolscanLink } from "@/components/solscan-link";

const schema = z.object({
  name:               z.string().min(1, "Required").max(32),
  symbol:             z.string().min(1, "Required").max(10).toUpperCase(),
  description:        z.string().max(500).optional(),
  twitter:            z.string().optional(),
  telegram:           z.string().optional(),
  website:            z.string().optional(),
  accountId:          z.coerce.number().int().positive("Select an account"),
  password:           z.string().min(1, "Required"),
  initialBuyAmountSol: z.coerce.number().min(0).max(10).default(0),
});

type FormValues = z.infer<typeof schema>;

interface LaunchResult {
  signature: string;
  mintAddress: string;
  metadataUri: string;
  message: string;
}

export default function TokenLaunchPage() {
  const { data: accounts } = useListAllAccounts();
  const { toast } = useToast();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", symbol: "", description: "", twitter: "", telegram: "", website: "", initialBuyAmountSol: 0 },
  });

  const handleImage = (file: File) => {
    if (!file.type.startsWith("image/")) { toast({ title: "Please upload an image file", variant: "destructive" }); return; }
    if (file.size > 5 * 1024 * 1024) { toast({ title: "Image must be under 5MB", variant: "destructive" }); return; }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = e => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const onSubmit = async (values: FormValues) => {
    setLaunching(true);
    setResult(null);
    try {
      let imageBase64: string | undefined;
      let imageMimeType: string | undefined;

      if (imageFile) {
        imageBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => {
            const data = e.target?.result as string;
            resolve(data.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(imageFile);
        });
        imageMimeType = imageFile.type;
      }

      const r = await fetch("/api/token-launch/pump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, imageBase64, imageMimeType }),
      });
      const data = await r.json() as LaunchResult & { error?: string };
      if (!r.ok) {
        toast({ title: `Launch failed: ${data.error ?? r.statusText}`, variant: "destructive" });
      } else {
        setResult(data);
        toast({ title: "Token launched!", description: `Mint: ${data.mintAddress.slice(0, 12)}...` });
        form.reset();
        setImageFile(null);
        setImagePreview(null);
      }
    } catch (err) {
      toast({ title: `Error: ${err instanceof Error ? err.message : String(err)}`, variant: "destructive" });
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Rocket className="w-6 h-6 text-primary" />
        <div>
          <h1 className="font-mono font-bold text-xl tracking-tight">Token Launch</h1>
          <p className="font-mono text-xs text-muted-foreground mt-0.5">Deploy a new token on Pump.fun in one click</p>
        </div>
      </div>

      {/* Result banner */}
      {result && (
        <div className="border border-green-700/50 rounded bg-green-950/20 p-4 space-y-2">
          <div className="font-mono font-bold text-sm text-green-400 flex items-center gap-2">
            <Rocket className="w-4 h-4" />
            Token Launched Successfully!
          </div>
          <div className="font-mono text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Mint:</span>
              <SolscanLink address={result.mintAddress} type="token" label={result.mintAddress} className="text-green-400 break-all" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Tx:</span>
              <SolscanLink address={result.signature} type="tx" label={result.signature.slice(0, 20) + "…"} className="text-primary" />
            </div>
            <a href={`https://pump.fun/${result.mintAddress}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-yellow-400 hover:underline">
              <ExternalLink className="w-3 h-3" /> View on Pump.fun
            </a>
          </div>
        </div>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* Image upload */}
        <div className="space-y-2">
          <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Token Image</Label>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImage(f); }}
            className="relative border-2 border-dashed border-border/50 rounded-lg cursor-pointer hover:border-primary/50 transition-colors flex items-center justify-center overflow-hidden"
            style={{ height: 140 }}
          >
            {imagePreview ? (
              <>
                <img src={imagePreview} alt="preview" className="h-full w-full object-cover" />
                <button type="button" onClick={e => { e.stopPropagation(); setImageFile(null); setImagePreview(null); }}
                  className="absolute top-2 right-2 bg-background/80 rounded-full p-0.5 hover:bg-destructive/20">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </>
            ) : (
              <div className="text-center space-y-1">
                <Upload className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                <p className="font-mono text-xs text-muted-foreground">Click or drag to upload (PNG/JPG, max 5MB)</p>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImage(f); }} />
        </div>

        {/* Name + Symbol */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Name *</Label>
            <Input {...form.register("name")} placeholder="My Meme Token" className="font-mono text-sm" />
            {form.formState.errors.name && <p className="font-mono text-[10px] text-red-400">{form.formState.errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Symbol *</Label>
            <Input {...form.register("symbol")} placeholder="MEME" className="font-mono text-sm" />
            {form.formState.errors.symbol && <p className="font-mono text-[10px] text-red-400">{form.formState.errors.symbol.message}</p>}
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Description</Label>
          <Textarea {...form.register("description")} placeholder="Tell the world about your token..." rows={3} className="font-mono text-sm resize-none" />
        </div>

        {/* Socials */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Twitter className="w-3 h-3" /> Twitter</Label>
            <Input {...form.register("twitter")} placeholder="@handle" className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Send className="w-3 h-3" /> Telegram</Label>
            <Input {...form.register("telegram")} placeholder="t.me/..." className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Globe className="w-3 h-3" /> Website</Label>
            <Input {...form.register("website")} placeholder="https://..." className="font-mono text-sm" />
          </div>
        </div>

        {/* Account + password */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Deploy From *</Label>
            <Select onValueChange={v => form.setValue("accountId", Number(v))}>
              <SelectTrigger className="font-mono text-sm">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {(accounts ?? []).map(a => (
                  <SelectItem key={a.id} value={String(a.id)} className="font-mono text-xs">
                    {a.name} — {a.publicKey.slice(0, 8)}...
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.accountId && <p className="font-mono text-[10px] text-red-400">{form.formState.errors.accountId.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Wallet Password *</Label>
            <Input type="password" {...form.register("password")} placeholder="Decrypt private key" className="font-mono text-sm" />
            {form.formState.errors.password && <p className="font-mono text-[10px] text-red-400">{form.formState.errors.password.message}</p>}
          </div>
        </div>

        {/* Initial buy */}
        <div className="space-y-1.5">
          <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Initial Buy (SOL) <span className="text-muted-foreground/50 normal-case">— optional, buys your own token right after launch</span></Label>
          <Input type="number" step="0.01" min="0" max="10" {...form.register("initialBuyAmountSol")} className="font-mono text-sm w-40" />
        </div>

        {/* Info box */}
        <div className="border border-primary/20 rounded p-3 bg-primary/5 font-mono text-xs text-muted-foreground space-y-1">
          <div className="text-primary font-semibold">How it works</div>
          <div>• Token metadata is uploaded to pump.fun IPFS — name, image, description, socials</div>
          <div>• A new mint keypair is generated and the token is created on the Pump.fun bonding curve</div>
          <div>• Transaction is signed with your selected account (pays ~0.005 SOL creation fee)</div>
          <div>• Optionally buy your own token immediately after launch (set initial buy above)</div>
        </div>

        <Button type="submit" disabled={launching} className="w-full font-mono font-bold">
          {launching
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Launching...</>
            : <><Rocket className="w-4 h-4 mr-2" />Launch Token on Pump.fun</>
          }
        </Button>
      </form>
    </div>
  );
}
