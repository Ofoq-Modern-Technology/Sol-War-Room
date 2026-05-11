import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Wallet, Users, ArrowRightLeft, Activity, History, Settings, Terminal, Layers, Bot, Crosshair, Rocket, Radio, TrendingUp, HelpCircle, ListTodo, LayoutDashboard, LogOut } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { title: "Wallets", url: "/", icon: Wallet },
  { title: "Accounts", url: "/accounts", icon: Users },
  { title: "Distributor", url: "/distributor", icon: Layers },
  { title: "Trade", url: "/trade", icon: ArrowRightLeft },
  { title: "Volume", url: "/volume", icon: Activity },
  { title: "Arb Engine", url: "/arb", icon: Bot },
  { title: "Sniper", url: "/sniper", icon: Crosshair },
  { title: "Token Radar", url: "/radar", icon: Radio },
  { title: "DexScreener", url: "/dex-screener", icon: TrendingUp },
  { title: "Token Launch", url: "/token-launch", icon: Rocket },
  { title: "Task Queue", url: "/tasks", icon: ListTodo },
  { title: "Operations", url: "/operations", icon: LayoutDashboard },
  { title: "History", url: "/history", icon: History },
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Help", url: "/help", icon: HelpCircle },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { username, logout } = useAuth();

  return (
    <Sidebar variant="inset" className="border-r border-border/50">
      <SidebarHeader className="p-4 flex items-center gap-2 border-b border-border/50">
        <Terminal className="w-6 h-6 text-primary text-glow" />
        <span className="font-mono font-bold text-lg text-primary tracking-tight">SOL_WAR_ROOM</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-xs uppercase text-muted-foreground tracking-wider mb-2">Systems</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className={isActive ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-accent"}
                    >
                      <Link href={item.url} className="flex items-center gap-3 font-mono">
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-border/50 p-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-mono text-xs text-muted-foreground truncate">Logged in as</p>
            <p className="font-mono text-xs font-semibold text-foreground truncate">{username}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
            title="Logout"
            onClick={logout}
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full bg-background text-foreground overflow-hidden selection:bg-primary/30">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="h-14 flex items-center px-4 border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
            <SidebarTrigger className="hover:bg-accent text-muted-foreground hover:text-foreground" />
            <div className="ml-auto flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_hsl(var(--primary))]"></div>
              <span className="text-xs font-mono text-primary">SYSTEM ONLINE</span>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 scroll-smooth">
            <div className="max-w-7xl mx-auto space-y-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
