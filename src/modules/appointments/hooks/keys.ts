/**
 * The agenda's query keys. Every write invalidates `all` (the visible range, the editor's
 * appointment and the availability are refetched together: one clinic's week is small).
 */
export const appointmentsKeys = {
  all: ['appointments'] as const,
  agenda: (from: string, to: string, professionalIds: readonly string[] | null) => [...appointmentsKeys.all, 'agenda', from, to, professionalIds] as const,
  detail: (id: string) => [...appointmentsKeys.all, 'detail', id] as const,
  reference: () => [...appointmentsKeys.all, 'reference'] as const,
  availability: (professionalIds: readonly string[], since: string) => [...appointmentsKeys.all, 'availability', professionalIds, since] as const,
  seriesPreview: (rule: object) => [...appointmentsKeys.all, 'series-preview', rule] as const,
  withoutReminder: (from: string) => [...appointmentsKeys.all, 'without-reminder', from] as const,
  clientVisits: (clientId: string) => [...appointmentsKeys.all, 'client-visits', clientId] as const,
  myReference: () => [...appointmentsKeys.all, 'my-reference'] as const,
  /** The consents an appointment requires (AP-32). */
  consents: (appointmentId: string) => [...appointmentsKeys.all, 'consents', appointmentId] as const,
  /** The consents a booking would require: the service and the clients chosen (AP-32). */
  bookingConsents: (serviceId: string, clientIds: readonly string[]) => [...appointmentsKeys.all, 'booking-consents', serviceId, clientIds] as const,
  /** An appointment's « Historique » (AP-33). */
  history: (appointmentId: string) => [...appointmentsKeys.all, 'history', appointmentId] as const,
  /** Paramètres → Agenda (AP-31). */
  settings: () => [...appointmentsKeys.all, 'settings'] as const,
}
