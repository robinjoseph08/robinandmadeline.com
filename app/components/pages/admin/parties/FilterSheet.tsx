import { ListFilter } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface FilterSheetProps {
  /** Number of active filters, shown as a badge and gating "Clear all". */
  activeCount: number;
  onClearAll: () => void;
  /** The filter controls (FilterSelect / BoolFilterSelect). */
  children: ReactNode;
}

/**
 * Tucks the list filters behind a "Filters" button so the top of a list page
 * stays uncluttered. Clicking it slides out a sheet holding the filter controls,
 * with a count badge and a "Clear all". The filters themselves live in the URL,
 * so this is purely presentational.
 */
export function FilterSheet({
  activeCount,
  onClearAll,
  children,
}: FilterSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="cursor-pointer" variant="outline">
          <ListFilter />
          Filters
          {activeCount > 0 ? (
            <Badge className="ml-1" variant="secondary">
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Narrow the list. Active filters are saved in the URL, so the view
            can be shared.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4">{children}</div>
        <SheetFooter>
          <Button
            className="cursor-pointer"
            disabled={activeCount === 0}
            onClick={onClearAll}
            variant="ghost"
          >
            Clear all
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
