import { useCallback, useMemo, useState, type ReactNode } from "react";

import { apiRequest } from "@/libraries/api";
import { AuthContext, type AuthContextValue } from "@/libraries/auth-context";

/**
 * Client-side admin authentication provider.
 *
 * The JWT returned by POST /api/auth/admin/login is stored in localStorage so a
 * refresh keeps the session, and exposed via context so any component can read
 * the token, check auth state, log in, or log out. This is intentionally a thin
 * layer: there is no client state library, and token freshness is enforced by
 * the server rejecting expired tokens on each request.
 *
 * The context and useAuth hook live in auth-context.ts so this module exports
 * only a component (a React Fast Refresh requirement).
 */

const TOKEN_STORAGE_KEY = "admin_token";

interface LoginResponse {
  token: string;
}

/** Reads the persisted token once at startup. */
function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

/** Provides admin auth state and actions to the tree below it. */
export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setToken] = useState<string | null>(readStoredToken);

  const login = useCallback(async (username: string, password: string) => {
    const { token: newToken } = await apiRequest<LoginResponse>(
      "/auth/admin/login",
      { method: "POST", body: { username, password } },
    );
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    } catch {
      // Ignore storage failures (e.g. private mode); the in-memory token still
      // works for the current session.
    }
    setToken(newToken);
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Ignore storage failures; clearing in-memory state is what matters.
    }
    setToken(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ token, isAuthenticated: token !== null, login, logout }),
    [token, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
