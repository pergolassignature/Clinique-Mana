import type { EmailUiPorts } from '@pergolas-signature/email-ui'
import { useEmailUiModifyMany, useEmailUiModifyThread, useEmailUiT } from '../../hooks/use-email-ui'
import { AttachmentSlot } from './AttachmentSlot'
import { MessageBodySlot } from './MessageBodySlot'

/**
 * What « Courriels » hands `@pergolas-signature/email-ui` (PS Hub's mail list and thread kit, ADR-0467
 * there): its words, `gmail-modify` for a row, a thread and the selection, and its own body and file
 * slots. A module-level constant on purpose: the kit calls these hooks in every row, and the
 * provider's value must never change.
 *
 * Not given: `useDownloadAttachment` (the Attachment slot draws MANA's files), `hideRecipient` (no
 * relay alias), `slots.RowBadge` (a row shows no file today).
 */
export const EMAIL_UI_PORTS: EmailUiPorts = {
  useT: useEmailUiT,
  useModifyThread: useEmailUiModifyThread,
  useModifyMany: useEmailUiModifyMany,
  slots: {
    MessageHtml: MessageBodySlot,
    Attachment: AttachmentSlot,
  },
}
