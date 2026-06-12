import { createBrowserRouter, Navigate } from "react-router-dom";

import AdminDashboard from "@/components/pages/admin/AdminDashboard";
import AdminEmailCompose from "@/components/pages/admin/AdminEmailCompose";
import AdminEmails from "@/components/pages/admin/AdminEmails";
import AdminEmailSendDetail from "@/components/pages/admin/AdminEmailSendDetail";
import AdminEmailTemplates from "@/components/pages/admin/AdminEmailTemplates";
import AdminEventDetail from "@/components/pages/admin/AdminEventDetail";
import AdminEvents from "@/components/pages/admin/AdminEvents";
import AdminGuests from "@/components/pages/admin/AdminGuests";
import AdminLayout from "@/components/pages/admin/AdminLayout";
import AdminLogin from "@/components/pages/admin/AdminLogin";
import AdminParties from "@/components/pages/admin/AdminParties";
import AdminPartyDetail from "@/components/pages/admin/AdminPartyDetail";
import AdminPhotoGroups from "@/components/pages/admin/AdminPhotoGroups";
import RequireAdmin from "@/components/pages/admin/RequireAdmin";
import Crossword from "@/components/pages/Crossword";
import FAQ from "@/components/pages/FAQ";
import Games from "@/components/pages/Games";
import Home from "@/components/pages/Home";
import InfoCollection from "@/components/pages/InfoCollection";
import Photos from "@/components/pages/Photos";
import Root from "@/components/pages/Root";
import RSVP from "@/components/pages/RSVP";
import RSVPConfirmation from "@/components/pages/RSVPConfirmation";
import RSVPForm from "@/components/pages/RSVPForm";
import Schedule from "@/components/pages/Schedule";
import Story from "@/components/pages/Story";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Home },
      { path: "story", Component: Story },
      { path: "schedule", Component: Schedule },
      { path: "games", Component: Games },
      // The puzzle slug resolves against the crossword puzzle registry; the
      // bare path predates the registry, so send it back to the landing.
      { path: "games/crossword", element: <Navigate replace to="/games" /> },
      { path: "games/crossword/:puzzleSlug", Component: Crossword },
      { path: "photos", Component: Photos },
      { path: "faq", Component: FAQ },
      { path: "rsvp", Component: RSVP },
      { path: "rsvp/form", Component: RSVPForm },
      { path: "rsvp/confirmation", Component: RSVPConfirmation },
      { path: "i/:token", Component: InfoCollection },
    ],
  },
  // The admin login sits outside the guard so unauthenticated users can reach it.
  { path: "/admin/login", Component: AdminLogin },
  // Everything else under /admin is gated by RequireAdmin and wrapped in the
  // admin shell, redirecting to /admin/login when there is no token.
  {
    path: "/admin",
    Component: RequireAdmin,
    children: [
      {
        Component: AdminLayout,
        children: [
          { index: true, Component: AdminDashboard },
          { path: "parties", Component: AdminParties },
          { path: "parties/:id", Component: AdminPartyDetail },
          { path: "guests", Component: AdminGuests },
          { path: "events", Component: AdminEvents },
          { path: "events/:id", Component: AdminEventDetail },
          { path: "photo-groups", Component: AdminPhotoGroups },
          { path: "emails", Component: AdminEmails },
          { path: "emails/compose", Component: AdminEmailCompose },
          { path: "emails/templates", Component: AdminEmailTemplates },
          { path: "emails/sends/:id", Component: AdminEmailSendDetail },
        ],
      },
    ],
  },
]);
