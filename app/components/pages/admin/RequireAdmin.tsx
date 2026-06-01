import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "@/libraries/auth-context";

/**
 * Route guard for the admin area. Renders the nested admin routes when a token
 * is present, otherwise redirects to the admin login. Token validity is
 * ultimately enforced server-side: an expired or tampered token simply yields
 * 401s from the API, and logging out clears it here.
 */
export default function RequireAdmin() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate replace to="/admin/login" />;
  }

  return <Outlet />;
}
