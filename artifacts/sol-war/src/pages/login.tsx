import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, User, Terminal, AlertTriangle, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const { login, setup, configured } = useAuth();
  const isSetup = !configured;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (isSetup) {
      if (password !== confirmPassword) { setError("Passwords do not match"); return; }
      if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    }

    setLoading(true);
    try {
      if (isSetup) {
        await setup(username, password);
      } else {
        await login(username, password);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Scan line effect */}
      <div className="fixed inset-0 pointer-events-none bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,255,0,0.01)_2px,rgba(0,255,0,0.01)_4px)]" />

      <div className="w-full max-w-sm space-y-8">
        {/* Logo / title */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 text-primary font-mono text-2xl font-bold tracking-widest">
            <Terminal className="w-7 h-7" />
            SOL_WAR_ROOM
          </div>
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
            {isSetup ? "First-run Setup" : "Secure Access Required"}
          </p>
        </div>

        {/* Card */}
        <div className="bg-card border border-primary/20 rounded-xl p-8 shadow-lg shadow-primary/5 space-y-6">
          {isSetup && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-950/30 border border-yellow-700/40 text-yellow-400 text-xs font-mono">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>No credentials set. Create your admin account to get started. This only appears once.</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  className="pl-9 font-mono bg-background border-border/60 focus:border-primary"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={isSetup ? "new-password" : "current-password"}
                  className="pl-9 pr-9 font-mono bg-background border-border/60 focus:border-primary"
                  required
                />
                <button type="button" onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {isSetup && <p className="text-xs font-mono text-muted-foreground">Minimum 8 characters</p>}
            </div>

            {isSetup && (
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="pl-9 font-mono bg-background border-border/60 focus:border-primary"
                    required
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs font-mono p-2 rounded bg-red-950/20 border border-red-800/30">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </div>
            )}

            <Button type="submit" className="w-full font-mono tracking-wider" disabled={loading}>
              {loading ? "Authenticating…" : isSetup ? "Create Account & Enter" : "Login"}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs font-mono text-muted-foreground/50">
          self-hosted · local access only
        </p>
      </div>
    </div>
  );
}
