import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { CopyButton } from "@/components/pages/admin/parties/CopyButton";
import {
  BoolFilterSelect,
  FilterSelect,
} from "@/components/pages/admin/parties/FilterSelect";
import { InfoStatusBadge } from "@/components/pages/admin/parties/InfoStatusBadge";
import {
  CIRCLE_OPTIONS,
  INFO_STATUS_OPTIONS,
  INVITATION_TYPE_OPTIONS,
  labelFor,
  RELATION_OPTIONS,
  SIDE_OPTIONS,
} from "@/components/pages/admin/parties/options";
import { PartyFormDialog } from "@/components/pages/admin/parties/PartyFormDialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateParty,
  useParties,
  useRequestInfo,
} from "@/hooks/queries/parties";
import { infoLinkForToken } from "@/libraries/clipboard";
import type {
  Circle,
  InfoCollectionStatus,
  InvitationType,
  Relation,
  Side,
} from "@/types/generated/models";
import type {
  CreatePartyPayload,
  ListPartiesQuery,
} from "@/types/generated/parties";

/**
 * Admin parties list: a filterable table of every party with its derived
 * info-collection status, per-row copy buttons for the info link (which also
 * triggers request-info) and RSVP code, and a create dialog. Each row links to
 * the party detail page.
 */
export default function AdminParties() {
  const [filters, setFilters] = useState<ListPartiesQuery>({});
  const [createOpen, setCreateOpen] = useState(false);

  const partiesQuery = useParties(filters);
  const createParty = useCreateParty();
  const requestInfo = useRequestInfo();

  const parties = partiesQuery.data?.items ?? [];

  const setFilter = <K extends keyof ListPartiesQuery>(
    key: K,
    value: ListPartiesQuery[K],
  ) => setFilters((prev) => ({ ...prev, [key]: value }));

  const handleCreate = async (payload: CreatePartyPayload) => {
    try {
      await createParty.mutateAsync(payload);
      toast.success(`Created "${payload.name}"`);
      setCreateOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create party",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Parties</h1>
          <p className="text-sm text-muted-foreground">
            {partiesQuery.data
              ? `${partiesQuery.data.total} part${partiesQuery.data.total === 1 ? "y" : "ies"}`
              : "Manage parties and their guests."}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Create party
        </Button>
      </div>

      <div className="flex flex-wrap gap-4">
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
        <FilterSelect<InvitationType>
          label="Invitation"
          onChange={(v) => setFilter("invitation_type", v)}
          options={INVITATION_TYPE_OPTIONS}
          value={filters.invitation_type as InvitationType | undefined}
        />
        <FilterSelect<InfoCollectionStatus>
          label="Info status"
          onChange={(v) => setFilter("info_collection_status", v)}
          options={INFO_STATUS_OPTIONS}
          value={filters.info_collection_status}
        />
        <BoolFilterSelect
          label="Info requested"
          onChange={(v) => setFilter("info_collection_requested", v)}
          value={filters.info_collection_requested}
        />
      </div>

      {partiesQuery.isLoading ? (
        <p className="text-muted-foreground">Loading parties...</p>
      ) : partiesQuery.isError ? (
        <p className="text-destructive">{partiesQuery.error.message}</p>
      ) : parties.length === 0 ? (
        <p className="text-muted-foreground">No parties match these filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Relation</TableHead>
              <TableHead>Invitation</TableHead>
              <TableHead>Guests</TableHead>
              <TableHead>Info status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parties.map((party) => (
              <TableRow key={party.id}>
                <TableCell className="font-medium">
                  <Link
                    className="hover:underline"
                    to={`/admin/parties/${party.id}`}
                  >
                    {party.name}
                  </Link>
                </TableCell>
                <TableCell>{labelFor(SIDE_OPTIONS, party.side)}</TableCell>
                <TableCell>
                  {labelFor(RELATION_OPTIONS, party.relation)}
                </TableCell>
                <TableCell>
                  {labelFor(INVITATION_TYPE_OPTIONS, party.invitation_type)}
                </TableCell>
                <TableCell>{party.guests?.length ?? 0}</TableCell>
                <TableCell>
                  <InfoStatusBadge
                    requested={party.info_collection_requested}
                    status={party.info_collection_status}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <CopyButton
                      label="Info link"
                      onCopy={async () => {
                        await requestInfo.mutateAsync({ partyId: party.id });
                      }}
                      successMessage="Info link copied; party marked as requested"
                      value={infoLinkForToken(party.info_token)}
                    />
                    {party.rsvp_code ? (
                      <CopyButton
                        label="RSVP"
                        successMessage="RSVP code copied"
                        value={party.rsvp_code}
                      />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <PartyFormDialog
        isPending={createParty.isPending}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        open={createOpen}
      />
    </div>
  );
}
