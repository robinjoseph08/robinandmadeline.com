import { createContext, useContext } from "react";

/**
 * Admin auth context and hook, kept separate from the AuthProvider component so
 * the provider file only exports a component (required for React Fast Refresh).
 */

export interface AuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
  /** Authenticates against the admin login endpoint and stores the token. */
  login: (username: string, password: string) => Promise<void>;
  /** Clears the stored token. */
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Accesses the admin auth context. Throws if used outside an AuthProvider. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
