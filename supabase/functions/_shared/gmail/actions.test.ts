import { assertEquals, assertFalse } from '@std/assert'
import {
  mailActionSchema,
  planAction,
  type ThreadForAction,
} from './actions.ts'

const thread: ThreadForAction = {
  gmail_thread_id: 't1',
  messages: [
    { gmail_message_id: 'm1', label_ids: ['INBOX', 'UNREAD', 'STARRED'] },
    { gmail_message_id: 'm2', label_ids: ['SENT'] },
    { gmail_message_id: 'm3', label_ids: ['INBOX', 'UNREAD', 'Label_7'] },
  ],
}

Deno.test('actions: read removes UNREAD from the unread messages only; a read thread asks nothing', () => {
  assertEquals(planAction({ kind: 'read' }, thread), {
    gmail: { type: 'messages', ids: ['m1', 'm3'], add: [], remove: ['UNREAD'] },
    mirror: [
      { gmail_message_id: 'm1', add: [], remove: ['UNREAD'] },
      { gmail_message_id: 'm3', add: [], remove: ['UNREAD'] },
    ],
  })
  const read: ThreadForAction = {
    gmail_thread_id: 't',
    messages: [{ gmail_message_id: 'a', label_ids: ['INBOX'] }],
  }
  assertEquals(planAction({ kind: 'read' }, read), { gmail: null, mirror: [] })
})

Deno.test('actions: unread and star touch the latest message; unstar every starred one', () => {
  const read: ThreadForAction = {
    gmail_thread_id: 't',
    messages: [
      { gmail_message_id: 'a', label_ids: ['INBOX'] },
      { gmail_message_id: 'b', label_ids: ['INBOX'] },
    ],
  }
  assertEquals(planAction({ kind: 'unread' }, read).gmail, {
    type: 'messages',
    ids: ['b'],
    add: ['UNREAD'],
    remove: [],
  })
  assertEquals(planAction({ kind: 'unread' }, thread).gmail, null)
  assertEquals(planAction({ kind: 'star' }, thread).gmail, {
    type: 'messages',
    ids: ['m3'],
    add: ['STARRED'],
    remove: [],
  })
  assertEquals(planAction({ kind: 'unstar' }, thread).gmail, {
    type: 'messages',
    ids: ['m1'],
    add: [],
    remove: ['STARRED'],
  })
})

Deno.test('actions: archive, back to the inbox and labels act on the thread; the mirror follows every message', () => {
  const archive = planAction({ kind: 'archive' }, thread)
  assertEquals(archive.gmail, { type: 'thread', add: [], remove: ['INBOX'] })
  assertEquals(archive.mirror.map((m) => m.gmail_message_id), [
    'm1',
    'm2',
    'm3',
  ])
  assertEquals(planAction({ kind: 'inbox' }, thread).gmail, {
    type: 'thread',
    add: ['INBOX'],
    remove: [],
  })
  assertEquals(
    planAction({ kind: 'unlabel', label_id: 'Label_7' }, thread).gmail,
    { type: 'thread', add: [], remove: ['Label_7'] },
  )
  assertEquals(
    planAction({ kind: 'label', label_id: 'Label_9' }, thread).gmail,
    { type: 'thread', add: ['Label_9'], remove: [] },
  )
  const archived: ThreadForAction = {
    gmail_thread_id: 't',
    messages: [{ gmail_message_id: 'a', label_ids: [] }],
  }
  assertEquals(planAction({ kind: 'archive' }, archived).gmail, null)
})

Deno.test('actions: only user labels are accepted as labels; system ones go through their actions', () => {
  assertFalse(
    mailActionSchema.safeParse({ kind: 'label', label_id: 'TRASH' }).success,
  )
  assertFalse(
    mailActionSchema.safeParse({ kind: 'label', label_id: 'INBOX' }).success,
  )
  assertFalse(mailActionSchema.safeParse({ kind: 'delete' }).success)
  assertFalse(
    mailActionSchema.safeParse({ kind: 'read', label_id: 'Label_1' }).success,
  )
  assertEquals(
    mailActionSchema.parse({ kind: 'label', label_id: 'Label_12' }),
    { kind: 'label', label_id: 'Label_12' },
  )
})
