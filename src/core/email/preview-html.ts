/**
 * The email's HTML with `<base target="_blank">` first in its head. In the `sandbox=""` frame a
 * link would otherwise load its page inside the preview; a new window is refused there (no
 * `allow-popups`), so a click on a link does nothing. The first `<base>` wins.
 */
export function withInertLinks(html: string): string {
  const base = '<base target="_blank">'
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + base + html.slice(head.index + head[0].length)
  return base + html
}
