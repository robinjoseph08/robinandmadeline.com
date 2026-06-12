import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { adminRequest, ApiError } from "@/libraries/admin-api";
import type {
  CreateTemplatePayload,
  ListSendsResponse,
  ListTemplatesResponse,
  PreviewEmailPayload,
  PreviewEmailResponse,
  SendDetailResponse,
  SendEmailPayload,
  SendResponse,
  TemplateResponse,
  UpdateTemplatePayload,
} from "@/types/generated/emails";

/**
 * React Query hooks for the emails admin API: template CRUD, the compose
 * preview, dispatching a send, and the send history. Every fetch goes through
 * `adminRequest` (which carries the admin token); the hooks are typed end to
 * end with the tygo-generated request/response types. A send returns
 * immediately with every recipient queued and the background worker drains
 * the queue afterwards (ADR 0004), so delivery statuses keep changing with no
 * further mutations to invalidate on; consumers pass refetchInterval where
 * they want live stats.
 */

export enum QueryKey {
  ListEmailTemplates = "ListEmailTemplates",
  ListEmailSends = "ListEmailSends",
  RetrieveEmailSend = "RetrieveEmailSend",
}

export const useEmailTemplates = (
  options: Omit<
    UseQueryOptions<ListTemplatesResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListTemplatesResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.ListEmailTemplates],
    queryFn: () => adminRequest("/admin/emails/templates"),
  });
};

export const useCreateEmailTemplate = () => {
  const queryClient = useQueryClient();

  return useMutation<TemplateResponse, ApiError, CreateTemplatePayload>({
    mutationFn: (payload) =>
      adminRequest("/admin/emails/templates", {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.ListEmailTemplates],
      });
    },
  });
};

export const useUpdateEmailTemplate = () => {
  const queryClient = useQueryClient();

  return useMutation<
    TemplateResponse,
    ApiError,
    { templateId: string; payload: UpdateTemplatePayload }
  >({
    mutationFn: ({ templateId, payload }) =>
      adminRequest(`/admin/emails/templates/${templateId}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.ListEmailTemplates],
      });
    },
  });
};

export const useDeleteEmailTemplate = () => {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, { templateId: string }>({
    mutationFn: ({ templateId }) =>
      adminRequest(`/admin/emails/templates/${templateId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.ListEmailTemplates],
      });
    },
  });
};

// usePreviewEmail resolves the recipient filter and renders the merge fields
// for a sample recipient, without sending anything. A mutation rather than a
// query: it runs on demand (the Preview button), not on mount.
export const usePreviewEmail = () => {
  return useMutation<PreviewEmailResponse, ApiError, PreviewEmailPayload>({
    mutationFn: (payload) =>
      adminRequest("/admin/emails/preview", { method: "POST", body: payload }),
  });
};

// useSendEmail dispatches a send: the backend records it, enqueues one row per
// recipient, and returns immediately; delivery happens in the background.
export const useSendEmail = () => {
  const queryClient = useQueryClient();

  return useMutation<SendResponse, ApiError, SendEmailPayload>({
    mutationFn: (payload) =>
      adminRequest("/admin/emails/send", { method: "POST", body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListEmailSends] });
    },
  });
};

export const useEmailSends = (
  options: Omit<
    UseQueryOptions<ListSendsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListSendsResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.ListEmailSends],
    queryFn: () => adminRequest("/admin/emails/sends"),
  });
};

export const useEmailSend = (
  sendId?: string,
  options: Omit<
    UseQueryOptions<SendDetailResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<SendDetailResponse, ApiError>({
    ...options,
    enabled: options.enabled ?? Boolean(sendId),
    queryKey: [QueryKey.RetrieveEmailSend, sendId],
    queryFn: () => adminRequest(`/admin/emails/sends/${sendId}`),
  });
};
