import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "@/libraries/auth-context";

/**
 * Route guard for the individual game pages. The games aren't ready for guests
 * yet, so a play route renders only for an admin session and otherwise sends
 * the visitor back to the games landing, where they get the "coming soon" note.
 * This keeps a direct link or bookmark from reaching a game the menu hides.
 */
export default function RequireGamesAccess() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate replace to="/games" />;
  }

  return <Outlet />;
}
