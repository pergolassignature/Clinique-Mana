import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { uploadFile } from '@/core/storage/api'
import type { UploadStep } from '@/shared/lib/files'
import { toast } from '@/shared/ui/sonner'
import { fetchOrganization, setOrgAsset, updateOrganization, type Organization, type OrganizationUpdate, type OrgAssetKind } from './api'

export const organizationKeys = {
  all: ['organization'] as const,
  current: () => [...organizationKeys.all, 'current'] as const,
}

/**
 * Whether timestamp `a` is a later instant than `b`. Parsed, so differing UTC offsets compare by
 * instant (millisecond precision); the strings are compared only when either does not parse.
 */
function newer(a: string, b: string): boolean {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return Number.isNaN(ta) || Number.isNaN(tb) ? a > b : ta > tb
}

export function useOrganization() {
  // Fresh for a minute: a background refetch (window focus, another card mounting) must not
  // re-sync the cards' `values` while someone is typing.
  return useQuery({ queryKey: organizationKeys.current(), queryFn: fetchOrganization, staleTime: 60_000 })
}

/**
 * Saves one settings card and resolves with the saved organization.
 *
 * Invalidates the organization and, when the patch touches `name` or `timezone`, the access
 * payload too: the shell shows the name and the clinic timezone comes from `get_my_access`.
 * The toasts live in the mutation options so the outcome shows even if the page unmounts first.
 */
export function useUpdateOrganization(successMessage: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: OrganizationUpdate }) => updateOrganization(id, patch),
    onSuccess: async (saved, { patch }) => {
      // The saved row is the truth: cache it at once, unless a later save already answered (two
      // cards saved in turn, the first answering last). The organization queries are only marked
      // stale (no second request); the access payload derived from name/timezone is refetched.
      queryClient.setQueryData<Organization>(organizationKeys.current(), (cached) =>
        cached && newer(cached.updated_at, saved.updated_at) ? cached : saved,
      )
      const invalidations = [queryClient.invalidateQueries({ queryKey: organizationKeys.all, refetchType: 'none' })]
      if (patch.name !== undefined || patch.timezone !== undefined) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: accessKeys.all }))
      }
      // Awaited: the mutation stays pending until the fresh values are in the cache. A failed
      // refetch does not reject (invalidateQueries swallows it), so the save is still confirmed.
      await Promise.all(invalidations)
      toast.success(successMessage)
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
    },
  })
}

/** The organization column that holds each image's file. */
export const ORG_ASSET_COLUMN = { logo: 'logo_file_id', signature: 'signature_file_id' } as const satisfies Record<OrgAssetKind, keyof Organization>

/**
 * Puts the asset's new file (or null) in the cached organization, then marks the organization
 * stale without fetching it again: the preview follows the new id at once.
 */
async function cacheOrgAsset(queryClient: QueryClient, kind: OrgAssetKind, fileId: string | null) {
  queryClient.setQueryData<Organization>(organizationKeys.current(), (cached) => cached && { ...cached, [ORG_ASSET_COLUMN[kind]]: fileId })
  await queryClient.invalidateQueries({ queryKey: organizationKeys.all, refetchType: 'none' })
}

export interface OrgAssetUpload {
  organizationId: string
  file: File
  mimeType: string
  onStep: (step: UploadStep) => void
}

/**
 * Uploads a new logo or signature image (purpose `org_logo` / `org_signature`, subject the
 * organization), then makes it the clinic's (`set_org_asset`, which soft-deletes the previous one),
 * and confirms with `successMessage`. Errors are not toasted: the upload widget shows them where
 * the file was chosen. A file uploaded but never set stays staged and is purged after a day.
 */
export function useUploadOrgAsset(kind: OrgAssetKind, successMessage: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, file, mimeType, onStep }: OrgAssetUpload) => {
      const { fileId } = await uploadFile({ purpose: `org_${kind}`, subjectType: 'organization', subjectId: organizationId, file, mimeType, onStep })
      await setOrgAsset(kind, fileId)
      return fileId
    },
    onSuccess: async (fileId) => {
      await cacheOrgAsset(queryClient, kind, fileId)
      toast.success(successMessage)
    },
  })
}

/** « Retirer »: the clinic has no logo (or signature image) any more; toasts the outcome. */
export function useRemoveOrgAsset(kind: OrgAssetKind, successMessage: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => setOrgAsset(kind, null),
    onSuccess: async () => {
      await cacheOrgAsset(queryClient, kind, null)
      toast.success(successMessage)
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
    },
  })
}
