import { assertEquals, assertStringIncludes } from '@std/assert'
import { escapeHtml, toHtml, toText } from './markup.ts'

/** The markup without its inline styles, so assertions read the structure. */
const bare = (html: string) => html.replace(/ style="[^"]*"/g, '')

Deno.test('escapeHtml: escapes the five HTML-significant characters', () => {
  assertEquals(
    escapeHtml(`<a href="x" title='y'>&</a>`),
    '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
  )
})

Deno.test('toHtml: paragraphs are separated by a blank line', () => {
  assertEquals(
    bare(toHtml('Bonjour,\n\nBienvenue à la clinique.')),
    '<p>Bonjour,</p><p>Bienvenue à la clinique.</p>',
  )
})

Deno.test('toHtml: a single line break stays inside the paragraph', () => {
  assertEquals(
    bare(toHtml('Ligne un\nLigne deux')),
    '<p>Ligne un<br>Ligne deux</p>',
  )
})

Deno.test('toHtml: Windows line breaks and extra blank lines are normalised', () => {
  assertEquals(
    bare(toHtml('Un\r\n\r\n\r\n  \r\nDeux\r\n')),
    '<p>Un</p><p>Deux</p>',
  )
})

Deno.test('toHtml: lines starting with "- " form a bullet list', () => {
  assertEquals(
    bare(toHtml('À préparer :\n- une pièce d’identité\n- votre CV')),
    '<p>À préparer :</p><ul><li>une pièce d’identité</li><li>votre CV</li></ul>',
  )
})

Deno.test('toHtml: a list between paragraphs', () => {
  assertEquals(
    bare(toHtml('Avant\n\n- a\n- b\n\nAprès')),
    '<p>Avant</p><ul><li>a</li><li>b</li></ul><p>Après</p>',
  )
})

Deno.test('toHtml: "-" without a space is plain text', () => {
  assertEquals(bare(toHtml('-5 degrés')), '<p>-5 degrés</p>')
})

Deno.test('toHtml: **bold**, also inside a bullet', () => {
  assertEquals(
    bare(toHtml('Un **mot** fort\n- **a** b')),
    '<p>Un <strong>mot</strong> fort</p><ul><li><strong>a</strong> b</li></ul>',
  )
})

Deno.test('toHtml: bold never spans lines, and a lone ** stays as is', () => {
  assertEquals(bare(toHtml('a **b\nc** d')), '<p>a **b<br>c** d</p>')
})

Deno.test('toHtml: no injection through **<b>**', () => {
  const html = toHtml('**<b>**')
  assertEquals(bare(html), '<p><strong>&lt;b&gt;</strong></p>')
})

Deno.test('toHtml: <, > and & are always escaped; nothing else is interpreted', () => {
  const html = bare(
    toHtml('<script>alert(1)</script> & [lien](https://x.test) <a href="x">'),
  )
  assertEquals(
    html,
    '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; [lien](https://x.test) &lt;a href=&quot;x&quot;&gt;</p>',
  )
})

Deno.test('toHtml: placeholders pass through untouched', () => {
  assertEquals(
    bare(toHtml('Bonjour {{ invitee.display_name }}')),
    '<p>Bonjour {{ invitee.display_name }}</p>',
  )
})

Deno.test('toHtml: empty or blank text gives no markup', () => {
  assertEquals(toHtml(''), '')
  assertEquals(toHtml(' \n\n '), '')
})

Deno.test('toHtml: elements carry inline styles (email clients drop <style>)', () => {
  const html = toHtml('a\n\n- b')
  assertStringIncludes(html, '<p style="')
  assertStringIncludes(html, '<ul style="')
  assertStringIncludes(html, '<li style="')
})

Deno.test('toText: paragraphs, bullets and bold markers removed', () => {
  assertEquals(
    toText('Bonjour,\r\n\r\nUn **mot** fort\nsuite\n\n- **a**\n- b <c> & d'),
    'Bonjour,\n\nUn mot fort\nsuite\n\n- a\n- b <c> & d',
  )
})

Deno.test('toText: blank text gives an empty string', () => {
  assertEquals(toText('\n \n'), '')
})
