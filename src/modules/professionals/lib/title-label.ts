import type { ProfessionTitle } from '../api/parse'
import type { Gender } from './constants'

/**
 * A title as shown for one professional (P4-340, P4-342): « Travailleuse sociale » for a woman,
 * « Travailleur social » for a man, as on the clinic's website. « Autre / non précisé », no gender
 * recorded, or a form left empty read the title's name, which the seed writes in full
 * (« Travailleuse sociale ou travailleur social », P4-341), never as a dotted form.
 *
 * Settings, filters and the title pickers keep the name: they name the title, not a person. The
 * SQL twin is `private.profession_title_label` (20261008133511_professionals_reference_data.sql),
 * which the retention review, the directory and the public profile read.
 */
export function titleLabel(title: Pick<ProfessionTitle, 'name' | 'nameFeminine' | 'nameMasculine'>, gender: Gender | null): string {
  if (gender === 'female') return title.nameFeminine ?? title.name
  if (gender === 'male') return title.nameMasculine ?? title.name
  return title.name
}
