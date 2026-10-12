import { z } from 'zod'
import { t } from '@/i18n'
import type { CommunicationsSettings } from '../api/mailboxes'

/**
 * Google's full topic name, as `set_communications_settings` checks it
 * (20261012204037_communications_gmail.sql): `projects/<project id>/topics/<topic>`, the project id
 * 6–30 lower-case letters, digits or hyphens, the topic 3–255 characters starting with a letter.
 * Empty clears it (the watch is then not started).
 */
export const TOPIC_PATTERN = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][A-Za-z0-9._~%+-]{2,254}$/

/** The push subscription's service account, as the RPC checks it (lower case). Empty clears it. */
export const SERVICE_ACCOUNT_PATTERN = /^[a-z0-9-]{6,30}@[a-z0-9-]{6,30}\.iam\.gserviceaccount\.com$/

const G = 'modules.communications.settings.gmail'

/** « Notifications de Google »: the topic and the service account, saved together. */
export const pushSettingsSchema = z.object({
  pubsub_topic: z
    .string()
    .trim()
    .refine((value) => value === '' || TOPIC_PATTERN.test(value), { message: t(`${G}.topic.invalid`) })
    .transform((value) => (value === '' ? null : value)),
  pubsub_service_account: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => value === '' || SERVICE_ACCOUNT_PATTERN.test(value), { message: t(`${G}.push.accountInvalid`) })
    .transform((value) => (value === '' ? null : value)),
})

export function toPushSettingsFormValues(settings: CommunicationsSettings) {
  return { pubsub_topic: settings.pubsub_topic ?? '', pubsub_service_account: settings.pubsub_service_account ?? '' }
}
