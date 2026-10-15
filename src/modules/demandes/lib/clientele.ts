import { t } from '@/i18n'
import type { ClienteleFit, DemandeParticipant, MatchBasis } from '../api/demandes'

const C = 'modules.demandes.clientele'

const list = new Intl.ListFormat('fr-CA', {
  style: 'long',
  type: 'conjunction',
})

/** « participant principal, 9 ans », « dossier de la demande, 40 ans », « participant principal ». */
export function personSource(person: MatchBasis['person'], age: number | null): string | null {
  if (person === null) return null
  const who = t(`${C}.person.${person}`)
  return age === null ? who : t(`${C}.personAge`, { who, age: String(age) })
}

/**
 * What « Automatique » gives, in words, from the server's derivation (never a copy of the rule):
 * « Enfants (participant principal, 9 ans) », « Couples (un couple) », « à préciser (âge inconnu) ».
 */
export function autoClienteleText(fit: ClienteleFit, person: MatchBasis['person'], age: number | null): string {
  const names = list.format(fit.clienteles.map((c) => c.name))
  switch (fit.basis) {
    case 'couple':
    case 'family':
      return names ? t(`${C}.because.${fit.basis}`, { names }) : t(`${C}.toSpecify`, { why: t(`${C}.why.noneFits`) })
    case 'age': {
      const source = personSource(person, age) ?? ''
      return names ? t(`${C}.withSource`, { names, source }) : t(`${C}.toSpecify`, { why: t(`${C}.why.noneFits`) })
    }
    default:
      return t(`${C}.toSpecify`, {
        why: t(person === null ? `${C}.why.nobody` : `${C}.why.ageUnknown`),
      })
  }
}

/** The empty option of « Clientèle »: « Automatique : Enfants (participant principal, 9 ans) ». */
export function autoOptionLabel(basis: MatchBasis): string {
  return t(`${C}.auto`, {
    text: autoClienteleText(basis.clientele_auto, basis.person, basis.age),
  })
}

/**
 * A clientèle chosen by hand that the people contradict: one the rule can give (ages, couples,
 * families) but does not give here. « Parents » or « Athlètes » never contradict anything; nor does
 * a choice when the people give nothing.
 */
export function clienteleConflict(chosenId: string, basis: MatchBasis): string | null {
  if (!chosenId || !basis.derivable_ids.includes(chosenId)) return null
  const auto = basis.clientele_auto.clienteles
  if (auto.length === 0 || auto.some((c) => c.id === chosenId)) return null
  return t(`${C}.conflict`, { names: list.format(auto.map((c) => c.name)) })
}

/**
 * « Pour qui » says someone else and the participants do not say who (D-60): the people seen go in
 * « Participants » (the match reads the main participant). A child, a teen, someone else: until a
 * main participant other than the requester exists; a couple or a family: until someone besides the
 * requester is listed. Null when nothing is to add.
 */
export function participantsHint(
  beneficiary: string,
  participants: readonly Pick<DemandeParticipant, 'client_id' | 'relationship' | 'is_primary'>[],
  requesterClientId: string | null,
): string | null {
  if (!beneficiary || beneficiary === 'self') return null
  const isRequester = (p: Pick<DemandeParticipant, 'client_id' | 'relationship'>) =>
    p.relationship === 'self' || (requesterClientId !== null && p.client_id === requesterClientId)
  const others = participants.filter((p) => !isRequester(p))
  if (beneficiary === 'couple' || beneficiary === 'family') {
    return others.length > 0 ? null : t(`${C}.addPeople.${beneficiary}`)
  }
  if (others.some((p) => p.is_primary)) return null
  return t(`${C}.addPeople.${beneficiary === 'child' || beneficiary === 'teen' ? beneficiary : 'other'}`)
}
