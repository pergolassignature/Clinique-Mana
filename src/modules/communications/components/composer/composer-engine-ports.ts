import type { ComposerEnginePorts } from '@pergolas-signature/email-ui/composer'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { toast } from '@/shared/ui/sonner'
import { communicationsErrorMessage } from '../../api/errors'
import { COMPOSER_UI_PORTS } from './composer-ui-ports'

const C = 'modules.communications.composer'

/**
 * What PS Hub's compose engine (email-ui 0.7.0, CM-27) asks of MANA: the kit's words, its notices as
 * MANA's toasts (« Envoi dans 5 s · Annuler », « Courriel envoyé. », « L'envoi a échoué. · Rouvrir »,
 * « Brouillon supprimé. · Annuler », « Brouillon enregistré. »), and why a send failed, in MANA's
 * words: Gmail refused it, Gmail did not confirm it (look in « Envoyés »), or the server's reason.
 */
export const COMPOSER_ENGINE_PORTS: ComposerEnginePorts = {
  useT: COMPOSER_UI_PORTS.useT,
  notify: {
    show: (id, { kind, title, description, duration, action }) => {
      // `action` always goes along, undefined included: a notice replacing the countdown loses its
      // « Annuler » (sonner merges an update onto the toast it replaces).
      const options = { id, action, ...(description !== undefined && { description }), ...(duration !== undefined && { duration }) }
      if (kind === 'loading') toast.loading(title, options)
      else if (kind === 'success') toast.success(title, options)
      else if (kind === 'error') toast.error(title, options)
      else toast(title, options)
    },
    dismiss: (id) => {
      toast.dismiss(id)
    },
  },
  describeSendError: (error) =>
    error instanceof FunctionCallError && error.code === 'provider_error'
      ? error.extra.outcome === 'refused'
        ? t(`${C}.errors.refused`)
        : t(`${C}.errors.notConfirmed`)
      : communicationsErrorMessage(error, t(`${C}.errors.sendFailed`)),
}
