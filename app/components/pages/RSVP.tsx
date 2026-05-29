import { Link } from "react-router-dom";

import PagePlaceholder from "@/components/library/PagePlaceholder";
import { Button } from "@/components/ui/button";

export default function RSVP() {
  return (
    <PagePlaceholder
      description="Enter the code from your invitation to RSVP. (Coming soon.)"
      title="RSVP"
    >
      <div className="flex gap-3">
        <Button asChild>
          <Link to="/rsvp/form">Continue to RSVP form</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/rsvp/confirmation">View confirmation</Link>
        </Button>
      </div>
    </PagePlaceholder>
  );
}
