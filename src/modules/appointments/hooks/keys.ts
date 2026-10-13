/**
 * The agenda's query keys. Every write invalidates `all` (the visible range, the editor's
 * appointment and the availability are refetched together: one clinic's week is small).
 */
export const appointmentsKeys = {
  all: ['appointments'] as const,
  agenda: (from: string, to: string, professionalIds: readonly string[] | null) => [...appointmentsKeys.all, 'agenda', from, to, professionalIds] as const,
  detail: (id: string) => [...appointmentsKeys.all, 'detail', id] as const,
  reference: () => [...appointmentsKeys.all, 'reference'] as const,
  availability: (professionalIds: readonly string[]) => [...appointmentsKeys.all, 'availability', professionalIds] as const,
}
