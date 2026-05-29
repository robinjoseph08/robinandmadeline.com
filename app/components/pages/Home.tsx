import { Link } from "react-router-dom";

import PagePlaceholder from "@/components/library/PagePlaceholder";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <PagePlaceholder
      description="Welcome to our wedding website. We're so excited to celebrate with you."
      title="Robin & Madeline"
    >
      <Button asChild>
        <Link to="/rsvp">RSVP</Link>
      </Button>
    </PagePlaceholder>
  );
}
