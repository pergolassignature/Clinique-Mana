import { describe, expect, it } from 'vitest'
import { diffLines, hasChanges } from './diff'
import { htmlToMarkup } from './paste'

describe('htmlToMarkup (paste from Word, Google Docs, a page)', () => {
  it('paragraphs, headings, bold and lists', () => {
    const html = '<h1>Consentement</h1><p>Je soussigné <b>Camille</b>, accepte :</p><ul><li>le suivi</li><li>les <strong>rappels</strong></li></ul><ol><li>Un</li><li>Deux</li></ol><h4>Petit</h4>'
    expect(htmlToMarkup(html)).toBe('# Consentement\n\nJe soussigné **Camille**, accepte :\n\n- le suivi\n- les **rappels**\n\n1. Un\n2. Deux\n\n### Petit')
  })

  it("Word's list paragraphs: its bullet and number dropped, bullets and numbers told apart; its comments and o:p ignored", () => {
    const html = `<!--StartFragment--><p class=MsoNormal>Avant<o:p></o:p></p>
      <p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>·<span>&nbsp;&nbsp;</span></span>Premier<o:p></o:p></p>
      <p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>·<span>&nbsp;</span></span>Second</p>
      <p class=MsoListParagraph style='mso-list:l1 level1 lfo2'><span style='mso-list:Ignore'>1.<span>&nbsp;</span></span>Étape</p>
      <p class=MsoNormal><span style='font-weight:bold'>Fin</span></p><!--EndFragment-->`
    expect(htmlToMarkup(html)).toBe('Avant\n\n- Premier\n- Second\n\n1. Étape\n\n**Fin**')
  })

  it("Google Docs' bold wrapper with font-weight:normal is not bold; a span of weight 700 is", () => {
    const html = '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-weight:400">Texte </span><span style="font-weight:700">important</span></p><p><span>Suite</span></p></b>'
    expect(htmlToMarkup(html)).toBe('Texte **important**\n\nSuite')
  })

  it('a table: its rows as | a | b | lines; a paragraph that would read as markup is escaped', () => {
    const html = '<table><tr><th>Clause</th><th>Réponse</th></tr><tr><td>Rappels</td><td>Oui</td></tr></table><p>- pas une liste</p>'
    expect(htmlToMarkup(html)).toBe('| Clause | Réponse |\n| Rappels | Oui |\n\n\\- pas une liste')
  })

  it('scripts and styles are never text; nothing to paste is null', () => {
    expect(htmlToMarkup('<style>p{color:red}</style><script>alert(1)</script><p>  </p>')).toBeNull()
    expect(htmlToMarkup('<p>Bonjour<br>tout le monde</p>')).toBe('Bonjour tout le monde')
  })
})

describe('diffLines', () => {
  it('kept, removed and added lines in order', () => {
    expect(diffLines('a\n\nb\n\nc', 'a\n\nB\n\nc\n\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: '' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: '' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: '' },
      { kind: 'added', text: 'd' },
    ])
  })

  it('hasChanges ignores blank lines only', () => {
    expect(hasChanges(diffLines('a\n\nb', 'a\nb'))).toBe(false)
    expect(hasChanges(diffLines('a', 'a b'))).toBe(true)
  })
})
