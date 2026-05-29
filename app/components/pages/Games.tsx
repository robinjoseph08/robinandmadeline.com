import { Link } from "react-router-dom";

import PagePlaceholder from "@/components/library/PagePlaceholder";
import { Button } from "@/components/ui/button";

export default function Games() {
  return (
    <PagePlaceholder
      description="Fun games to play while you wait. (Coming soon.)"
      title="Games"
    >
      <Button asChild variant="secondary">
        <Link to="/games/crossword">Play the Crossword</Link>
      </Button>
    </PagePlaceholder>
  );
}
