// src/contracts/hooks.ts
// DEPRECATED: Contract hooks have been consolidated into document-templates module.
// Use useServiceContractStatus and useGenerateDocument from '@/document-templates/hooks' instead.
//
// This file is kept for backwards compatibility but all hooks are deprecated.
// The service_contracts table is no longer used - data is now stored in document_instances.

/**
 * @deprecated Use documentInstanceKeys from '@/document-templates/hooks' instead.
 */
export const contractKeys = {
  all: ['contracts'] as const,
  byProfessional: (professionalId: string) =>
    [...contractKeys.all, 'professional', professionalId] as const,
  latest: (professionalId: string) =>
    [...contractKeys.all, 'latest', professionalId] as const,
  byId: (contractId: string) => [...contractKeys.all, 'id', contractId] as const,
  docusealStatus: (submissionId: number) =>
    [...contractKeys.all, 'docuseal', submissionId] as const,
}
