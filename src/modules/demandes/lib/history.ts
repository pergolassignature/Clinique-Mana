import { t } from '@/i18n'
import type { DemandeEvent } from '../api/demandes'
import { optionLabel, stateLabel } from './display'

const H = 'modules.demandes.history'

/** One event in plain words (the history is codes only: no free text, D-4). */
export function eventText(event: DemandeEvent): string {
  switch (event.kind) {
    case 'created':
      return t(`${H}.created`)
    case 'state_changed':
      if (event.to_state === 'closed' && event.closed_reason) {
        return t(`${H}.closed`, { reason: optionLabel('closedReason', event.closed_reason) })
      }
      if (event.to_state === 'matched' && event.professional_name) {
        return t(`${H}.matched`, { name: event.professional_name })
      }
      return t(`${H}.stateChanged`, { from: event.from_state ? stateLabel(event.from_state) : '', to: event.to_state ? stateLabel(event.to_state) : '' })
    case 'assigned':
      return event.assignee_name ? t(`${H}.assigned`, { name: event.assignee_name }) : t(`${H}.unassigned`)
    case 'contact':
      return t(`${H}.contact`, {
        channel: event.contact_channel ? optionLabel('contactChannel', event.contact_channel) : '',
        outcome: event.contact_outcome ? optionLabel('outcome', event.contact_outcome) : '',
      })
    case 'task_done':
      return t(`${H}.taskDone`)
    case 'urgent_set':
      return t(`${H}.urgentSet`)
    case 'urgent_cleared':
      return t(`${H}.urgentCleared`)
    default:
      return t(`${H}.other`)
  }
}

