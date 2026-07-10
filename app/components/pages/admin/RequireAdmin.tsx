import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "@/libraries/auth-context";

/**
 * Route guard for the admin area. Renders the nested admin routes when a token
 * is present, otherwise redirects to the admin login. Token validity is
 * ultimately enforced server-side: an expired or tampered token yields 401s
 * from the API, and admin-api clears the stored token and notifies the auth
 * provider on such a 401, which flips isAuthenticated to false here so this
 * guard redirects to the login page (see auth.tsx / admin-api.ts).
 */
export default function RequireAdmin() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate replace to="/admin/login" />;
  }

  return <Outlet />;
}
