import { z } from 'zod'
import { t } from '@/i18n'
import type { CommunicationsSettings } from '../api/mailboxes'

/**
 * Google's full topic name, as `set_communications_settings` checks it
 * (20261012185047_communications_gmail.sql): `projects/<project id>/topics/<topic>`, the project id
 * 6–30 lower-case letters, digits or hyphens, the topic 3–255 characters starting with a letter.
 * Empty clears it (the watch is then not started).
 */
export const TOPIC_PATTERN = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][A-Za-z0-9._~%+-]{2,254}$/

export const topicSchema = z.object({
  pubsub_topic: z
    .string()
    .trim()
    .refine((value) => value === '' || TOPIC_PATTERN.test(value), { message: t('modules.communications.settings.gmail.topic.invalid') })
    .transform((value) => (value === '' ? null : value)),
})

export function toTopicFormValues(settings: CommunicationsSettings) {
  return { pubsub_topic: settings.pubsub_topic ?? '' }
}
