import { describe, expect, it } from 'vitest'
import { bodyJson } from '../test/fixtures-contract'
import {
  ANNEXE_PLACEHOLDER,
  asBody,
  bodyToMarkup,
  hasAnnexePlaceholder,
  hasValidationBanner,
  markupToBody,
  parseRuns,
  previewHtml,
  unknownPlaceholders,
  VALIDATION_BANNER,
  type PdfBody,
  type PreviewText,
} from './contract-markup'

const body = (options?: Parameters<typeof bodyJson>[0]) => asBody(bodyJson(options)) as PdfBody
const TEXT: PreviewText = {
  annexeSample: { caption: 'Exemple', columns: ['Séances', '50 min'], rows: [['0 à 50', '100 $']] },
  initials: 'Initiales',
  signature: 'Signature',
  date: 'Date',
  page: 'Page 1 de 1',
}

describe('asBody', () => {
  it('accepts the renderer’s model, refuses anything else', () => {
    expect(asBody(bodyJson())).not.toBeNull()
    expect(asBody({ title: 'x', blocks: [] })).toBeNull()
    expect(asBody({})).toBeNull()
  })
})

describe('parseRuns', () => {
  it('reads **bold** runs and merges neighbours', () => {
    expect(parseRuns('a **b** c')).toEqual([{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }])
    expect(parseRuns('**tout**')).toEqual([{ text: 'tout', bold: true }])
  })

  it('keeps an unclosed marker as text; an empty paragraph is one empty run', () => {
    expect(parseRuns('a **b')).toEqual([{ text: 'a **b' }])
    expect(parseRuns('')).toEqual([{ text: '' }])
  })
})

describe('markup ⇄ body', () => {
  it('writes every block but the signature page, and reads it back unchanged', () => {
    const base = body()
    const markup = bodyToMarkup(base)
    expect(markup).toBe(
      [`**${VALIDATION_BANNER}**`, '# Convention', 'Entre **{{clinic.name}}** et {{professional.full_name}}.', '## Annexe A', ANNEXE_PLACEHOLDER].join('\n\n'),
    )
    expect(markupToBody(markup, base)).toEqual(base)
  })

  it('reads lists, tables, images, page breaks and escaped paragraphs', () => {
    const markup = ['- un\n- **deux**', '1. premier\n2. second', '| A | B |\n| 1 |\n| 2 | 3 | 4 |', '[[image logo 120]]', '---', '\\# pas un titre', '### Titre\nsuivi d’un\nparagraphe'].join('\n\n')
    const blocks = markupToBody(markup, body()).blocks
    expect(blocks).toEqual([
      { type: 'list', ordered: false, items: [[{ text: 'un' }], [{ text: 'deux', bold: true }]] },
      { type: 'list', ordered: true, items: [[{ text: 'premier' }], [{ text: 'second' }]] },
      // One cell per column (the renderer refuses otherwise): missing ones empty, extra ones dropped.
      { type: 'table', columns: [{ label: 'A', width: 50 }, { label: 'B', width: 50 }], rows: [['1', ''], ['2', '3']] },
      { type: 'image', assetKey: 'logo', width: 120 },
      { type: 'pageBreak' },
      { type: 'paragraph', runs: [{ text: '# pas un titre' }] },
      { type: 'heading', level: 3, text: 'Titre' },
      { type: 'paragraph', runs: [{ text: 'suivi d’un paragraphe' }] },
      body().blocks.at(-1),
    ])
    // Written back, the paragraph that looks like a heading keeps its escape.
    expect(bodyToMarkup({ ...body(), blocks })).toContain('\\# pas un titre')
  })

  it('keeps the signature page last, whatever the markup', () => {
    const blocks = markupToBody('Un seul paragraphe.', body()).blocks
    expect(blocks.at(-1)?.type).toBe('signaturePage')
    expect(blocks).toHaveLength(2)
  })

  it('normalises Windows line ends and trailing spaces', () => {
    expect(markupToBody('a  \r\nb\r\n\r\nc', body()).blocks.slice(0, 2)).toEqual([
      { type: 'paragraph', runs: [{ text: 'a b' }] },
      { type: 'paragraph', runs: [{ text: 'c' }] },
    ])
  })
})

describe('checks before publishing', () => {
  it('sees the validation line', () => {
    expect(hasValidationBanner(bodyToMarkup(body()))).toBe(true)
    expect(hasValidationBanner(bodyToMarkup(body({ banner: false })))).toBe(false)
  })

  it('sees Annexe A only alone in its paragraph', () => {
    expect(hasAnnexePlaceholder(bodyToMarkup(body()))).toBe(true)
    expect(hasAnnexePlaceholder(bodyToMarkup(body({ annexe: false })))).toBe(false)
    expect(hasAnnexePlaceholder(`Voir ${ANNEXE_PLACEHOLDER} ici`)).toBe(false)
  })

  it('lists the undeclared placeholders once each', () => {
    expect(unknownPlaceholders(['{{clinic.name}} {{ inconnu }}', '{{inconnu}} {{autre}}'], ['clinic.name'])).toEqual(['inconnu', 'autre'])
    expect(unknownPlaceholders(['rien'], [])).toEqual([])
  })
})

describe('previewHtml', () => {
  const samples = { 'clinic.name': 'Clinique <Exemple>', 'professional.full_name': 'Camille Exemple' }

  it('fills the samples, escaped, and marks an unknown placeholder', () => {
    const base = body()
    const html = previewHtml({ ...base, blocks: [{ type: 'paragraph', runs: [{ text: '{{clinic.name}} <b>{{nope}}</b>' }] }] }, samples, TEXT)
    expect(html).toContain('<span class="v">Clinique &lt;Exemple&gt;</span>')
    expect(html).toContain('&lt;b&gt;<mark>{{nope}}</mark>&lt;/b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('shows the sample Annexe A in place of its placeholder, the initials box and the signature page', () => {
    const html = previewHtml(body(), samples, TEXT)
    expect(html).toContain('<th>Séances</th><th>50 min</th>')
    expect(html).not.toContain(ANNEXE_PLACEHOLDER)
    expect(html).toContain('<span class="box small">Initiales</span>')
    expect(html).toContain('<strong>Le Professionnel</strong>')
    expect(previewHtml(body({ initials: false }), samples, TEXT)).not.toContain('box small')
  })

  it('has no script', () => {
    expect(previewHtml(body(), { 'clinic.name': '<script>alert(1)</script>' }, TEXT)).not.toMatch(/<script/i)
  })
})
