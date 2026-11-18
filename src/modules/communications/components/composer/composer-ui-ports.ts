import type { ComposerUiPorts } from '@pergolas-signature/email-ui/composer'
import { composerText } from '../../lib/email-ui'

/**
 * What the composer hands `@pergolas-signature/email-ui/composer` (PS Hub's composer kit, ADR-0467
 * there): its words, under `modules.communications.emailUi`. A module-level constant: the kit calls
 * `useT` in each render, and the provider's value must never change.
 *
 * Not given: `lazy` (the composer imports the editor directly: it is already its own chunk) and
 * `sanitizeOptions` (MANA's quoted message lives in the body, not in the kit's fold).
 */
export const COMPOSER_UI_PORTS: ComposerUiPorts = {
  useT: () => composerText,
}
