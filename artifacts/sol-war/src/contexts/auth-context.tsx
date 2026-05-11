import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { getToken, getUsername, setSession, clearSession, authHeaders } from "@/lib/auth";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AuthState {
  token: string | null;
  username: string | null;
  configured: boolean | null; // null = loading
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (current: string, next: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: getToken(),
    username: getUsername(),
    configured: null,
    loading: true,
  });

  // Check if credentials have been configured yet
  const checkSetup = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/auth/check-setup`);
      const data = await r.json() as { configured: boolean };
      setState(s => ({ ...s, configured: data.configured, loading: false }));
    } catch {
      setState(s => ({ ...s, configured: false, loading: false }));
    }
  }, []);

  useEffect(() => { void checkSetup(); }, [checkSetup]);

  const login = useCallback(async (username: string, password: string) => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) {
      const e = await r.json() as { error?: string };
      throw new Error(e.error ?? "Login failed");
    }
    const data = await r.json() as { token: string; username: string };
    setSession(data.token, data.username);
    setState(s => ({ ...s, token: data.token, username: data.username, configured: true }));
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const r = await fetch(`${BASE}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) {
      const e = await r.json() as { error?: string };
      throw new Error(e.error ?? "Setup failed");
    }
    const data = await r.json() as { token: string; username: string };
    setSession(data.token, data.username);
    setState(s => ({ ...s, token: data.token, username: data.username, configured: true }));
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setState(s => ({ ...s, token: null, username: null }));
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const r = await fetch(`${BASE}/api/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!r.ok) {
      const e = await r.json() as { error?: string };
      throw new Error(e.error ?? "Change password failed");
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, setup, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
