import { Outlet } from "react-router-dom";

import NavBar from "@/components/library/NavBar";

/** App shell: the shared top nav bar plus the routed page content. */
export default function Root() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4">
        <Outlet />
      </main>
    </div>
  );
}
