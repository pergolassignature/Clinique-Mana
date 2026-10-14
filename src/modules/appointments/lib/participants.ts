import { t } from '@/i18n'

/**
 * The clients one appointment holds at most (R-79, an appointment for a family): the database's
 * `private.appointments_max_clients()`. A couple service holds exactly two.
 */
export const MAX_CLIENTS = 6

/** How many clients a booking of this service may hold. */
export const maxClientsFor = (service: { forTwo: boolean } | undefined): number => (service?.forTwo ? 2 : MAX_CLIENTS)

const LIST = new Intl.ListFormat('fr-CA', { style: 'long', type: 'conjunction' })

/** « Alice », « Alice et Bruno », « Alice, Bruno et Chloé ». */
export function joinNames(names: readonly string[]): string {
  return LIST.format(names.filter(Boolean))
}

/**
 * What a client is in an appointment, after her name: the first is the person seen; with two, the
 * other is the « deuxième personne » (a couple); with more, each other one is an « autre personne ».
 */
export function participantRole(index: number, count: number): string {
  const E = 'modules.appointments.editor'
  if (index === 0) return t(`${E}.personSeen`)
  return t(count <= 2 ? `${E}.secondPerson` : `${E}.otherPerson`)
}
