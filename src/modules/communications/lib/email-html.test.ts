// @vitest-environment jsdom
// DOMPurify needs a DOM that parses as browsers do: under happy-dom it dropped the <p> and kept
// the <script>. The app runs it in the browser; this test runs it in jsdom.
import { describe, expect, it } from 'vitest'
import { htmlHasContent, prepareEmailHtml } from './email-html'

const none = { inlineImages: new Map<string, string>(), showRemoteImages: false }

describe('prepareEmailHtml', () => {
  it('drops scripts, styles, forms, frames and event handlers', () => {
    const { html } = prepareEmailHtml(
      '<style>body{display:none}</style><script>alert(1)</script><p onclick="x()">Bonjour</p><iframe src="https://x.test"></iframe><form><input name="a"></form><svg><a href="javascript:1">s</a></svg>',
      none,
    )
    expect(html).toContain('<p>Bonjour</p>')
    for (const bad of ['<style', '<script', 'onclick', '<iframe', '<form', '<input', '<svg', 'javascript:']) expect(html).not.toContain(bad)
  })

  it('opens links in a new tab without the opener, and drops other schemes', () => {
    const { html } = prepareEmailHtml('<a href="https://example.test/x">lien</a> <a href="javascript:alert(1)">non</a> <a href="mailto:a@b.test">courriel</a>', none)
    expect(html).toContain('href="https://example.test/x"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="mailto:a@b.test"')
  })

  it('holds remote images back until asked, and counts them', () => {
    const raw = '<p>Logo</p><img src="https://tracker.test/open.gif" alt="logo"><img src="http://x.test/b.png">'
    const held = prepareEmailHtml(raw, none)
    expect(held.blockedImages).toBe(2)
    expect(held.html).not.toContain('tracker.test')
    expect(held.html).toContain('data-blocked')
    const shown = prepareEmailHtml(raw, { ...none, showRemoteImages: true })
    expect(shown.blockedImages).toBe(0)
    expect(shown.html).toContain('src="https://tracker.test/open.gif"')
  })

  it('points cid images at their signed URL; an inline image without a copy is dropped', () => {
    const inlineImages = new Map([['logo@clinique', 'https://storage.test/signed/logo.png?token=1']])
    const { html } = prepareEmailHtml('<img src="cid:logo@clinique"><img src="cid:<missing@x>">', { inlineImages, showRemoteImages: false })
    expect(html).toContain('src="https://storage.test/signed/logo.png?token=1"')
    expect(html).not.toContain('missing')
    expect(html.match(/<img/g)).toHaveLength(1)
  })

  it('keeps harmless styles, drops overlays, huge fonts and fixed widths', () => {
    const { html } = prepareEmailHtml(
      '<div style="color: red; position: fixed; top: 0"><span style="font-size: 72px; font-weight: bold">x</span><table style="width: 1200px"><tr><td>y</td></tr></table><p style="background: url(https://t.test/p.gif)">z</p></div>',
      none,
    )
    expect(html).toContain('color: red')
    expect(html).not.toContain('position')
    expect(html).not.toContain('72px')
    expect(html).toContain('font-weight: bold')
    expect(html).not.toContain('1200px')
    expect(html).not.toContain('t.test')
  })

  it('no style can fetch a remote image: escapes, comments, image-set and image properties are dropped', () => {
    const { html } = prepareEmailHtml(
      [
        '<p style="background:\\75rl(https://t1.test/p.gif)">a</p>',
        '<p style="background-image:image-set(&quot;https://t2.test/p.gif&quot; 1x)">b</p>',
        '<p style="background:-webkit-image-set(&quot;https://t3.test/p.gif&quot; 1x)">c</p>',
        '<p style="background:ur/**/l(https://t4.test/p.gif)">d</p>',
        '<ul style="list-style-image: none"><li>e</li></ul>',
        '<p style="cursor: pointer; color: blue">f</p>',
      ].join(''),
      none,
    )
    for (const host of ['t1.test', 't2.test', 't3.test', 't4.test']) expect(html).not.toContain(host)
    expect(html).not.toContain('list-style-image')
    expect(html).not.toContain('cursor')
    expect(html).toContain('color: blue')
  })
})

describe('htmlHasContent', () => {
  it('tells an empty HTML shell from a message', () => {
    expect(htmlHasContent('<html><head></head><body> &nbsp; </body></html>')).toBe(false)
    expect(htmlHasContent(null)).toBe(false)
    expect(htmlHasContent('<p>Bonjour</p>')).toBe(true)
    expect(htmlHasContent('<img src="cid:x">')).toBe(true)
  })
})
