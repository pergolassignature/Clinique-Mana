import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { FunctionError } from './errors.ts'
import { notify, type NotifyInput } from './notifications.ts'
import { fakeSupabase } from './testing/fake-supabase.ts'

const FULL: NotifyInput = {
  orgId: 'o1',
  moduleKey: 'professionals',
  kind: 'professionals.insurance_expiring',
  importance: 'important',
  title: 'Assurance de Sophie Lavoie',
  body: "L'assurance responsabilité expire le 19 octobre.",
  linkPath: '/professionnels/p1',
  subject: { type: 'professional', id: 'p1' },
  recipientPermission: 'professionals.review',
  recipientUserId: 'u1',
  dedupeKey: 'insurance:d1:7',
  expiresAt: new Date('2026-10-19T04:00:00Z'),
}

Deno.test('notify: passes every argument and returns the id', async () => {
  const { client, calls } = fakeSupabase({
    rpc: { create_notification: { data: 'n1' } },
  })
  assertEquals(await notify(client, FULL), 'n1')
  assertEquals(calls, [{
    fn: 'create_notification',
    args: {
      p_org_id: 'o1',
      p_module_key: 'professionals',
      p_kind: 'professionals.insurance_expiring',
      p_importance: 'important',
      p_title: 'Assurance de Sophie Lavoie',
      p_body: "L'assurance responsabilité expire le 19 octobre.",
      p_link_path: '/professionnels/p1',
      p_subject_type: 'professional',
      p_subject_id: 'p1',
      p_recipient_permission: 'professionals.review',
      p_recipient_user_id: 'u1',
      p_dedupe_key: 'insurance:d1:7',
      p_expires_at: '2026-10-19T04:00:00.000Z',
    },
  }])
})

Deno.test('notify: the optional fields default to null and the importance to normal', async () => {
  const { client, calls } = fakeSupabase({
    rpc: { create_notification: { data: 'n2' } },
  })
  await notify(client, {
    orgId: 'o1',
    moduleKey: 'core',
    kind: 'core.test',
    title: 'Bonjour',
    recipientPermission: 'users.view',
  })
  assertEquals(calls[0]?.args, {
    p_org_id: 'o1',
    p_module_key: 'core',
    p_kind: 'core.test',
    p_importance: 'normal',
    p_title: 'Bonjour',
    p_body: null,
    p_link_path: null,
    p_subject_type: null,
    p_subject_id: null,
    p_recipient_permission: 'users.view',
    p_recipient_user_id: null,
    p_dedupe_key: null,
    p_expires_at: null,
  })
})

Deno.test('notify: a repeated dedupe key returns the existing id', async () => {
  const { client } = fakeSupabase({
    rpc: { create_notification: { data: 'existing' } },
  })
  assertEquals(await notify(client, FULL), 'existing')
  assertEquals(await notify(client, FULL), 'existing')
})

Deno.test('notify: an RPC error throws internal with the SQLSTATE only', async () => {
  const { client } = fakeSupabase({
    rpc: {
      create_notification: {
        error: {
          code: '22023',
          message: 'Permission de destinataire invalide pour ce module',
        },
      },
    },
  })
  const error = await assertRejects(
    () => notify(client, FULL),
    FunctionError,
  )
  assertEquals(error.code, 'internal')
  assertStringIncludes(error.message, 'create_notification failed (22023)')
  // Never a value of the notice.
  assertEquals(error.message.includes('Sophie'), false)
  assertEquals(error.message.includes('Permission'), false)
})

Deno.test('notify: a result that is not an id throws internal', async () => {
  const { client } = fakeSupabase({
    rpc: { create_notification: { data: null } },
  })
  const error = await assertRejects(
    () => notify(client, FULL),
    FunctionError,
  )
  assertEquals(error.code, 'internal')
})

Deno.test('notify: an invalid expiresAt throws invalid_request before any call', async () => {
  const { client, calls } = fakeSupabase({
    rpc: { create_notification: { data: 'n1' } },
  })
  const error = await assertRejects(
    () => notify(client, { ...FULL, expiresAt: new Date('pas une date') }),
    FunctionError,
  )
  assertEquals(error.code, 'invalid_request')
  assertStringIncludes(error.message, 'expiresAt')
  assertEquals(calls, [])
})

Deno.test('notify: a null expiresAt never expires, and is not checked', async () => {
  const { client, calls } = fakeSupabase({
    rpc: { create_notification: { data: 'n1' } },
  })
  assertEquals(await notify(client, { ...FULL, expiresAt: null }), 'n1')
  assertEquals(calls[0]?.args.p_expires_at, null)
})

Deno.test('notify: the link and the subject id are passed as given', async () => {
  const { client, calls } = fakeSupabase({
    rpc: { create_notification: { data: 'n1' } },
  })
  const id = 'b0000000-0000-0000-0000-000000000001'
  await notify(client, {
    ...FULL,
    linkPath: `/professionnels/${encodeURIComponent(id)}?onglet=documents`,
    subject: { type: 'professional', id },
  })
  assertEquals(
    calls[0]?.args.p_link_path,
    `/professionnels/${id}?onglet=documents`,
  )
  assertEquals(calls[0]?.args.p_subject_id, id)
})
