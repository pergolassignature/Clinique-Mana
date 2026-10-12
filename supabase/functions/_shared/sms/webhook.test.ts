import { assert, assertEquals, assertFalse } from '@std/assert'
import {
  isMessageEvent,
  normalizeMessageEvent,
  parseYeastarEnvelope,
  signYeastarBody,
  verifyYeastarSignature,
} from './webhook.ts'
import { fakeYeastar } from '../testing/fake-yeastar.ts'

const SECRET = 'local-test-webhook-secret'

Deno.test('verifyYeastarSignature accepts the PBX base64 form, sha256= and hex, refuses the rest', async () => {
  const body = JSON.stringify({ type: 30031, sn: 'x', msg: {} })
  const mac = await signYeastarBody(body, SECRET)
  assert(await verifyYeastarSignature(body, mac, SECRET))
  assert(await verifyYeastarSignature(body, `sha256=${mac}`, SECRET))
  assert(await verifyYeastarSignature(body, ` ${mac} `, SECRET))
  const hex = Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(SECRET),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        ),
        new TextEncoder().encode(body),
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  assert(await verifyYeastarSignature(body, hex, SECRET))
  assertFalse(await verifyYeastarSignature(body, mac, 'another-secret'))
  assertFalse(await verifyYeastarSignature(body + ' ', mac, SECRET))
  assertFalse(await verifyYeastarSignature(body, null, SECRET))
  assertFalse(await verifyYeastarSignature(body, '', SECRET))
  assertFalse(await verifyYeastarSignature(body, 'not base64 at all!!', SECRET))
  assertFalse(await verifyYeastarSignature(body, mac, ''))
})

Deno.test('parseYeastarEnvelope reads msg as an object or a JSON string', () => {
  const object = parseYeastarEnvelope(
    JSON.stringify({ type: 30031, sn: 'SN1', msg: { msg_id: 1 } }),
  )
  assertEquals(object?.type, 30031)
  assertEquals(object?.sn, 'SN1')
  assertEquals(object?.msg, { msg_id: 1 })
  const text = parseYeastarEnvelope(
    JSON.stringify({ type: '30032', msg: JSON.stringify({ msg_id: 2 }) }),
  )
  assertEquals(text?.type, 30032)
  assertEquals(text?.msg, { msg_id: 2 })
  const test = parseYeastarEnvelope(
    JSON.stringify({ event: 'test', sn: 'SN1' }),
  )
  assertEquals(test?.event, 'test')
  assertEquals(test?.type, null)
  assertEquals(parseYeastarEnvelope('not json'), null)
  assertEquals(parseYeastarEnvelope('[1]'), null)
  assertEquals(
    parseYeastarEnvelope(JSON.stringify({ type: 30031, msg: 'oops' }))?.msg,
    null,
  )
})

Deno.test('isMessageEvent names the three message events', () => {
  assert(isMessageEvent(30030))
  assert(isMessageEvent(30031))
  assert(isMessageEvent(30032))
  assertFalse(isMessageEvent(30012))
  assertFalse(isMessageEvent(null))
})

Deno.test('normalizeMessageEvent: an inbound text from a client', () => {
  const fake = fakeYeastar()
  const envelope = parseYeastarEnvelope(JSON.stringify(
    fake.inboundEvent({
      from: '+15145551212',
      body: 'Oui',
      msgId: 10325,
      sessionId: 3089,
      at: new Date('2027-03-10T15:00:00Z'),
    }),
  ))!
  const event = normalizeMessageEvent(envelope)!
  assertEquals(event.type, 30031)
  assertEquals(event.direction, 'in')
  assertEquals(event.from, '+15145551212')
  assertEquals(event.msgId, 10325)
  assertEquals(event.sessionId, 3089)
  assertEquals(event.body, 'Oui')
  assertEquals(event.media, [])
  assertEquals(event.at?.toISOString(), '2027-03-10T15:00:00.000Z')
})

Deno.test('normalizeMessageEvent: our own echo keeps no number; MMS keeps names, types and sizes only', () => {
  const echo = normalizeMessageEvent({
    type: 30031,
    sn: null,
    event: null,
    msg: {
      msg_id: 7,
      session_id: 1,
      sender: { user_no: 'api', user_type: 9 },
      msg_body: 'hi',
    },
  })!
  assertEquals(echo.direction, 'out')
  assertEquals(echo.from, null)
  const extension = normalizeMessageEvent({
    type: 30031,
    sn: null,
    event: null,
    msg: { msg_id: 8, sender: { user_no: '3200', user_type: 1 } },
  })!
  assertEquals(extension.direction, 'out')
  const mms = normalizeMessageEvent({
    type: 30031,
    sn: null,
    event: null,
    msg: {
      msg_id: 9,
      session_id: 2,
      sender: { user_no: '+15145551212', user_type: 2 },
      msg_body: '',
      msg_files: JSON.stringify([
        {
          id: 'da20',
          name: 'demo.jpg',
          uri: '20250728/da20',
          type: 'image/jpeg',
          size: 95896,
        },
      ]),
    },
  })!
  assertEquals(mms.body, null)
  assertEquals(mms.media, [{
    name: 'demo.jpg',
    type: 'image/jpeg',
    size: 95896,
  }])
  assertFalse(JSON.stringify(mms).includes('uri'))
})

Deno.test('normalizeMessageEvent: a delivery report, its error as a safe code', () => {
  const fake = fakeYeastar()
  const failed = normalizeMessageEvent(
    parseYeastarEnvelope(JSON.stringify(
      fake.deliveryEvent({
        msgId: 10325,
        status: 2,
        error: 'Invalid Phone-Number',
      }),
    ))!,
  )!
  assertEquals(failed.type, 30032)
  assertEquals(failed.direction, 'out')
  assertEquals(failed.deliveryStatus, 2)
  assertEquals(failed.sendError, 'invalid_phone_number')
  assertEquals(failed.from, null)
  const sent = normalizeMessageEvent(
    parseYeastarEnvelope(
      JSON.stringify(fake.deliveryEvent({ msgId: 10326, status: 1 })),
    )!,
  )!
  assertEquals(sent.deliveryStatus, 1)
  assertEquals(sent.sendError, null)
  assertEquals(
    normalizeMessageEvent({ type: 30012, sn: null, event: null, msg: {} }),
    null,
  )
})
