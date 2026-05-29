import { createBrowserRouter } from "react-router-dom";

import Admin from "@/components/pages/Admin";
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
      { path: "games/crossword", Component: Crossword },
      { path: "photos", Component: Photos },
      { path: "faq", Component: FAQ },
      { path: "rsvp", Component: RSVP },
      { path: "rsvp/form", Component: RSVPForm },
      { path: "rsvp/confirmation", Component: RSVPConfirmation },
      { path: "i/:token", Component: InfoCollection },
      { path: "admin", Component: Admin },
    ],
  },
]);
