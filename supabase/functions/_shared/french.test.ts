import { assertEquals } from '@std/assert'
import { frenchSpacing, NNBSP } from './french.ts'

const n = NNBSP

Deno.test('frenchSpacing: a narrow no-break space before ? ! ; :', () => {
  assertEquals(frenchSpacing('Supprimer ?'), `Supprimer${n}?`)
  assertEquals(frenchSpacing('Attention !'), `Attention${n}!`)
  assertEquals(
    frenchSpacing('une ligne vide ; du gras'),
    `une ligne vide${n}; du gras`,
  )
  assertEquals(
    frenchSpacing('Courriel : {{ email }}'),
    `Courriel${n}: {{ email }}`,
  )
})

Deno.test('frenchSpacing: inside guillemets, with or without a space', () => {
  assertEquals(
    frenchSpacing('Cliquez sur « Continuer ».'),
    `Cliquez sur «${n}Continuer${n}».`,
  )
  assertEquals(
    frenchSpacing('Cliquez sur «Continuer».'),
    `Cliquez sur «${n}Continuer${n}».`,
  )
  assertEquals(frenchSpacing('«\u00A0Continuer\u00A0»'), `«${n}Continuer${n}»`)
})

Deno.test('frenchSpacing: times, URLs, addresses and placeholders untouched', () => {
  for (
    const text of [
      'à 14:30',
      'https://cliniquemana.com/?page=1&a=b',
      'Merci!',
      'ecrire@cliniquemana.com',
      '{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&type=email',
      '{{invitee.first_name}}',
      'Montant\u00A0: 12 $',
    ]
  ) assertEquals(frenchSpacing(text), text)
})

Deno.test('frenchSpacing: idempotent', () => {
  const once = frenchSpacing('Exécuter « {{label}} » maintenant ?')
  assertEquals(frenchSpacing(once), once)
})
