import { useState } from "react";
import { Link } from "react-router-dom";

import {
  BoolFilterSelect,
  FilterSelect,
} from "@/components/pages/admin/parties/FilterSelect";
import {
  CIRCLE_OPTIONS,
  RELATION_OPTIONS,
  SIDE_OPTIONS,
} from "@/components/pages/admin/parties/options";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useGuests } from "@/hooks/queries/guests";
import type { Circle, Relation, Side } from "@/types/generated/models";
import type { ListGuestsQuery } from "@/types/generated/parties";

/**
 * Admin flat guest list: every guest across all parties in a filterable table.
 * Filters cover the party-level attributes (side, relation, circle) and the
 * guest-level ones (roles contains, plus the drinking/child/placeholder flags).
 * Event- and RSVP-status filters are deferred to #6 (they need the event model).
 * Each guest links to its party's detail page, where it can be edited.
 */
export default function AdminGuests() {
  const [filters, setFilters] = useState<ListGuestsQuery>({});
  // Local text state for the roles "contains" filter, committed to the query.
  const [rolesInput, setRolesInput] = useState("");

  const guestsQuery = useGuests(filters);
  const guests = guestsQuery.data?.items ?? [];

  const setFilter = <K extends keyof ListGuestsQuery>(
    key: K,
    value: ListGuestsQuery[K],
  ) => setFilters((prev) => ({ ...prev, [key]: value }));

  const commitRoles = () => {
    const trimmed = rolesInput.trim();
    setFilter("roles", trimmed === "" ? undefined : trimmed);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Guests</h1>
        <p className="text-sm text-muted-foreground">
          {guestsQuery.data
            ? `${guestsQuery.data.total} guest${guestsQuery.data.total === 1 ? "" : "s"}`
            : "Every guest across all parties."}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <FilterSelect<Side>
          label="Side"
          onChange={(v) => setFilter("side", v)}
          options={SIDE_OPTIONS}
          value={filters.side as Side | undefined}
        />
        <FilterSelect<Relation>
          label="Relation"
          onChange={(v) => setFilter("relation", v)}
          options={RELATION_OPTIONS}
          value={filters.relation as Relation | undefined}
        />
        <FilterSelect<Circle>
          label="Circle"
          onChange={(v) => setFilter("circle", v)}
          options={CIRCLE_OPTIONS}
          value={filters.circle as Circle | undefined}
        />
        <BoolFilterSelect
          label="Drinking"
          onChange={(v) => setFilter("is_drinking", v)}
          value={filters.is_drinking}
        />
        <BoolFilterSelect
          label="Child"
          onChange={(v) => setFilter("is_child", v)}
          value={filters.is_child}
        />
        <BoolFilterSelect
          label="Placeholder"
          onChange={(v) => setFilter("is_placeholder", v)}
          value={filters.is_placeholder}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Role contains</span>
          <Input
            className="w-40"
            onBlur={commitRoles}
            onChange={(e) => setRolesInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRoles();
            }}
            placeholder="e.g. Bridesmaid"
            value={rolesInput}
          />
        </label>
      </div>

      {guestsQuery.isLoading ? (
        <p className="text-muted-foreground">Loading guests...</p>
      ) : guestsQuery.isError ? (
        <p className="text-destructive">{guestsQuery.error.message}</p>
      ) : guests.length === 0 ? (
        <p className="text-muted-foreground">No guests match these filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead>Party</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {guests.map((guest) => (
              <TableRow key={guest.id}>
                <TableCell className="font-medium">{guest.full_name}</TableCell>
                <TableCell>{guest.email ?? "--"}</TableCell>
                <TableCell>{guest.phone ?? "--"}</TableCell>
                <TableCell>
                  {guest.roles.length > 0 ? guest.roles.join(", ") : "--"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {guest.is_primary ? (
                      <Badge variant="default">Primary</Badge>
                    ) : null}
                    {guest.is_child ? (
                      <Badge variant="secondary">Child</Badge>
                    ) : null}
                    {guest.is_drinking ? (
                      <Badge variant="secondary">Drinking</Badge>
                    ) : null}
                    {guest.is_placeholder ? (
                      <Badge variant="outline">Placeholder</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Link
                    className="text-sm hover:underline"
                    to={`/admin/parties/${guest.party_id}`}
                  >
                    View party
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
