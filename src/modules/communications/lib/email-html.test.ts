// @vitest-environment jsdom
// DOMPurify needs a DOM that parses as browsers do: under happy-dom (DOMPurify >= 3.4) it drops
// allowlisted tags and keeps <script>, so a sanitizer test there proves nothing. The app runs it in
// the browser; this test runs it in jsdom.
import { prepareEmailHtml } from '@pergolas-signature/email-render'
import { describe, expect, it } from 'vitest'
import { emailSanitizeOptions, htmlHasContent } from './email-html'

const held = emailSanitizeOptions(new Map(), false)
const prepare = (raw: string, options = held) => prepareEmailHtml(raw, options)

describe('emailSanitizeOptions', () => {
  it("maps the clinic's reading choices onto the package's options", () => {
    const options = emailSanitizeOptions(new Map([['logo@clinique', 'https://storage.test/signed/logo.png']]), false)
    expect(options).toEqual({
      inlineImages: { 'logo@clinique': 'https://storage.test/signed/logo.png' },
      remoteImages: 'hold',
      styleFetch: 'block',
      maxInlineWidthPx: 800,
    })
    expect(emailSanitizeOptions(new Map(), true).remoteImages).toBe('show')
    // Style fetches stay blocked once the person shows the images.
    expect(emailSanitizeOptions(new Map(), true).styleFetch).toBe('block')
  })

  it("resolves only the message's own content ids, never an Object property", () => {
    const { html } = prepare('<img src="cid:constructor"><img src="cid:toString"><img src="cid:__proto__">')
    expect(html).not.toContain('<img')
  })
})

describe('a message sanitized with the clinic options', () => {
  it('drops scripts, styles, forms, frames and event handlers', () => {
    const { html } = prepare(
      '<style>body{display:none}</style><script>alert(1)</script><p onclick="x()">Bonjour</p><iframe src="https://x.test"></iframe><form><input name="a"></form><svg><a href="javascript:1">s</a></svg>',
    )
    expect(html).toContain('<p>Bonjour</p>')
    for (const bad of ['<style', '<script', 'onclick', '<iframe', '<form', '<input', '<svg', 'javascript:']) expect(html).not.toContain(bad)
  })

  it('opens links in a new tab without the opener, and drops other schemes', () => {
    const { html } = prepare('<a href="https://example.test/x">lien</a> <a href="javascript:alert(1)">non</a> <a href="mailto:a@b.test">courriel</a>')
    expect(html).toContain('href="https://example.test/x"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="mailto:a@b.test"')
  })

  it('holds remote images back until asked, and counts them', () => {
    const raw = '<p>Logo</p><img src="https://images.test/logo.png" alt="logo"><img src="http://x.test/b.png">'
    const before = prepare(raw)
    expect(before.blockedImages).toBe(2)
    expect(before.html).not.toContain('images.test')
    expect(before.html.match(/<img[^>]*data-blocked/g)).toHaveLength(2)
    const shown = prepare(raw, emailSanitizeOptions(new Map(), true))
    expect(shown.blockedImages).toBe(0)
    expect(shown.html).toContain('src="https://images.test/logo.png"')
  })

  it('removes a known tracking pixel outright: it is neither counted nor shown', () => {
    const raw = '<p>x</p><img src="https://t.test/open.gif"><img src="https://t.test/p.png" width="1" height="1">'
    expect(prepare(raw).blockedImages).toBe(0)
    expect(prepare(raw, emailSanitizeOptions(new Map(), true)).html).not.toContain('t.test')
  })

  it('points cid images at their signed URL, never held; an inline image without a copy is dropped', () => {
    const inlineImages = new Map([['logo@clinique', 'https://storage.test/signed/logo.png?token=1']])
    const { html, blockedImages } = prepare('<img src="cid:logo@clinique"><img src="cid:<missing@x>">', emailSanitizeOptions(inlineImages, false))
    expect(html).toContain('src="https://storage.test/signed/logo.png?token=1"')
    expect(html).not.toContain('missing')
    expect(html.match(/<img/g)).toHaveLength(1)
    expect(blockedImages).toBe(0)
  })

  it('keeps the attributes of a table layout', () => {
    // DOMPurify URI-checks every attribute it does not know as URI-safe: with a narrow URL list,
    // the sanitizer this replaced silently dropped all of these.
    const { html } = prepare(
      '<table width="600" border="0" cellpadding="4" cellspacing="0" bgcolor="#eeeeee" align="center"><tr><td colspan="2" rowspan="1" valign="top" align="right"><font color="#333333" face="Arial" size="2">x</font></td></tr></table>',
    )
    for (const attr of ['width="600"', 'border="0"', 'cellpadding="4"', 'cellspacing="0"', 'bgcolor="#eeeeee"', 'align="center"', 'colspan="2"', 'rowspan="1"', 'valign="top"', 'align="right"', 'color="#333333"', 'face="Arial"', 'size="2"']) {
      expect(html).toContain(attr)
    }
  })

  it('keeps harmless styles and widths up to 800 px, drops overlays, huge fonts and wider widths', () => {
    const { html } = prepare(
      '<div style="color: red; position: fixed; top: 0"><span style="font-size: 72px; font-weight: bold">x</span><table style="width: 1200px"><tr><td>y</td></tr></table><table style="width: 700px"><tr><td>w</td></tr></table><p style="background: url(https://t.test/p.gif)">z</p></div>',
    )
    expect(html).toContain('color: red')
    expect(html).not.toContain('position')
    expect(html).not.toContain('72px')
    expect(html).toContain('font-weight: bold')
    expect(html).not.toContain('1200px')
    expect(html).toContain('width: 700px')
    expect(html).not.toContain('t.test')
  })

  it('no style can fetch a remote image, even once images are shown', () => {
    const raw = [
      '<p style="background:\\75rl(https://t1.test/p.gif)">a</p>',
      '<p style="background-image:image-set(&quot;https://t2.test/p.gif&quot; 1x)">b</p>',
      '<p style="background:-webkit-image-set(&quot;https://t3.test/p.gif&quot; 1x)">c</p>',
      '<p style="background:ur/**/l(https://t4.test/p.gif)">d</p>',
      '<ul style="list-style-image: none"><li>e</li></ul>',
      '<p style="cursor: pointer; color: blue">f</p>',
    ].join('')
    for (const options of [held, emailSanitizeOptions(new Map(), true)]) {
      const { html } = prepare(raw, options)
      for (const host of ['t1.test', 't2.test', 't3.test', 't4.test']) expect(html).not.toContain(host)
      expect(html).not.toContain('list-style-image')
      expect(html).not.toContain('cursor')
      expect(html).toContain('color: blue')
    }
  })
})

describe('htmlHasContent', () => {
  it('tells an empty HTML shell from a message', () => {
    expect(htmlHasContent('<html><head></head><body> &nbsp; </body></html>')).toBe(false)
    expect(htmlHasContent(null)).toBe(false)
    expect(htmlHasContent('<p>Bonjour</p>')).toBe(true)
    expect(htmlHasContent('<img src="cid:x">')).toBe(true)
  })

  it('counts a lone entity as content', () => {
    expect(htmlHasContent('<p>&eacute;</p>')).toBe(true)
  })
})
