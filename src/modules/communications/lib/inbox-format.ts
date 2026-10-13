import { t } from '@/i18n'

/** Who wrote: the name, else the address, else « (expéditeur inconnu) ». */
export function senderLabel(name: string | null, address: string | null): string {
  return name?.trim() || address || t('modules.communications.inbox.list.unknownSender')
}

/** The thread in Gmail's web app, for what the app does not show (an attachment it did not copy). */
export function gmailThreadUrl(mailbox: string, gmailThreadId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#all/${encodeURIComponent(gmailThreadId)}`
}

/**
 * « CLI-000123 · Alice Exemple » (CM2b): the file's number as Clients writes it (its
 * `clientNumberLabel`; Communications does not import Clients' code, CM-12).
 */
export function fileLabel(clientNumber: number, name: string): string {
  return `CLI-${String(clientNumber).padStart(6, '0')} · ${name}`
}
