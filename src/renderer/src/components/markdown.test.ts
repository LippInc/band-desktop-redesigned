import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { anchorTarget, guideSections } from '@/lib/guide'
import { SafeMarkdown } from './markdown'

const render = (text: string) => renderToStaticMarkup(createElement(SafeMarkdown, { text }))

/** A source that gives the renderer anchors, which only text with sections of its own may have. */
const passesAnchors = (source: string): boolean => /\banchors=\{/.test(source)

describe('SafeMarkdown (untrusted text from the daemon)', () => {
  it("renders GitHub's Markdown: headings, lists, code and tables", () => {
    const html = render('# Plan\n\n- one\n- `two`\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    expect(html).toContain('>Plan</h3>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('two</code>')
    expect(html).toContain('<table')
  })

  it.each([
    ['a script tag', '<script>alert(1)</script>', /<script/i],
    ['an inline handler', '<img src=x onerror=alert(1)>', /<img|onerror/i],
    ['an iframe', '<iframe src="https://example.com"></iframe>', /<iframe/i],
    ['a style tag', '<style>body{display:none}</style>', /<style/i],
  ])('drops raw HTML: %s', (_label, text, forbidden) => {
    expect(render(text)).not.toMatch(forbidden)
  })

  it('leaves raw HTML out rather than showing its tags as text', () => {
    const html = render('before <b>bold</b> after\n\n<div>block</div>')
    expect(html).not.toContain('&lt;')
    expect(html).toContain('before')
    expect(html).toContain('after')
  })

  it('never loads an image: its text stands in', () => {
    const html = render('![the wireframe](https://example.com/w.png)')
    expect(html).not.toMatch(/<img/i)
    expect(html).toContain('the wireframe')
  })

  it.each([
    ['javascript:', '[x](javascript:alert(1))'],
    ['data:', '[x](data:text/html,hi)'],
    ['file:', '[x](file:///etc/passwd)'],
    ['http:', '[x](http://example.com)'],
    ['a relative path', '[x](../settings)'],
  ])('keeps a %s link as plain text', (_label, text) => {
    const html = render(text)
    expect(html).not.toMatch(/<a /)
    expect(html).not.toMatch(/href=/)
    expect(html).toContain('x')
  })

  it('makes https and mailto links into links', () => {
    expect(render('[guide](https://example.com/guide)')).toContain('href="https://example.com/guide"')
    expect(render('[mail](mailto:team@example.com)')).toContain('href="mailto:team@example.com"')
  })
})

describe('SafeMarkdown for the guide: a link within the same document', () => {
  // Only the guide has sections of its own to jump to, so only the guide is given anchors. The three kinds
  // of link are told apart by the guide's own classifier, not by a stub of this test's making.
  const sections = guideSections(['# A guide', '', '## Sonar', '', 'Who is nearby.'].join('\n'))
  const anchors = { target: (href?: string) => anchorTarget(href, sections), jump: () => {} }
  const guide = (text: string) => renderToStaticMarkup(createElement(SafeMarkdown, { text, anchors }))

  it('draws a link within the document as a control that jumps, as Jam Desktop does', () => {
    const html = guide('See [Sonar](#sonar).')
    expect(html).toMatch(/<button[^>]*data-anchor="sonar"/)
    expect(html).toContain('>Sonar</button>')
    expect(html).not.toMatch(/href=/)
  })

  it.each([
    ['a section the document does not have', '[gone](#no-such-page)'],
    ['another file of the documentation', '[reference](advanced-reference.md)'],
    ['another file with an anchor in it', '[reference](advanced-reference.md#sonar)'],
  ])('leaves %s as plain text', (_label, text) => {
    const html = guide(text)
    expect(html).not.toMatch(/<button/)
    expect(html).not.toMatch(/href=/)
  })

  it('still opens the links it can, and never becomes one on text that was given no anchors', () => {
    expect(guide('[band](https://example.com)')).toContain('href="https://example.com"')
    expect(renderToStaticMarkup(createElement(SafeMarkdown, { text: 'See [Sonar](#sonar).' }))).not.toMatch(/<button/)
  })

  /**
   * Which sources hand text to the renderer with anchors. The guide is the only text this app shows that carries
   * sections of its own, so there is one: anything else would be daemon text given somewhere to jump to.
   */
  const RENDERER = resolve(__dirname, '..')
  const sourcesPassingAnchors = (dir: string): string[] => {
    const found: string[] = []
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) found.push(...sourcesPassingAnchors(path))
      else if (/\.tsx?$/.test(name) && !name.includes('.test.') && passesAnchors(readFileSync(path, 'utf8'))) {
        found.push(relative(RENDERER, path).replaceAll('\\', '/'))
      }
    }
    return found
  }

  it('is given anchors by the guide alone, and by nothing that shows the daemon its own text', () => {
    expect(sourcesPassingAnchors(RENDERER)).toEqual(['pages/documentation.tsx'])
    // The known-bad: a source that hands anchors to a message would be found.
    expect(passesAnchors('<SafeMarkdown text={message.content} anchors={anchors} />')).toBe(true)
    expect(passesAnchors('<SafeMarkdown text={message.content} mentions={mentions} />')).toBe(false)
  })

  it("never gives a message's text a jump: a mention is a chip and the rest is plain", () => {
    const html = renderToStaticMarkup(
      createElement(SafeMarkdown, {
        text: 'See [Sonar](#sonar).',
        anchors,
        mentions: { names: {}, selfId: null },
      }),
    )
    expect(html).not.toMatch(/<button/)
    expect(html).toContain('Sonar')
  })
})

describe('SafeMarkdown with the words a search found', () => {
  const marked = (text: string, highlight: string) =>
    renderToStaticMarkup(createElement(SafeMarkdown, { text, highlight }))

  it('marks the words where they are said, as they were written', () => {
    const html = marked('The CHECKOUT page and the checkout flow', 'checkout')
    expect(html).toContain('<mark')
    // Twice, each keeping the case the message used.
    expect(html.match(/<mark[^>]*>/g)).toHaveLength(2)
    expect(html).toContain('>CHECKOUT</mark>')
    expect(html).toContain('>checkout</mark>')
    // And the message still says all of what it said.
    expect(html.replace(/<[^>]+>/g, '')).toBe('The CHECKOUT page and the checkout flow')
  })

  it('marks nothing when nothing was asked for, or when the words are not there', () => {
    expect(renderToStaticMarkup(createElement(SafeMarkdown, { text: 'checkout' }))).not.toContain('<mark')
    expect(marked('checkout', '   ')).not.toContain('<mark')
    expect(marked('checkout', 'sonar')).not.toContain('<mark')
  })

  it('leaves what is not read as words alone: a link, its address, and code', () => {
    const link = marked('[the checkout guide](https://example.com/checkout)', 'checkout')
    expect(link).toContain('href="https://example.com/checkout"')
    expect(link.match(/<mark[^>]*>/g)).toHaveLength(1)
    // Code keeps its own text: it is one value, not words to mark.
    expect(marked('`checkout()` and checkout', 'checkout').match(/<mark[^>]*>/g)).toHaveLength(1)
  })

  it('marks words that would mean something in a pattern, and never loops on them', () => {
    for (const words of ['.*', '()', '[a]', '$', String.fromCharCode(92)]) {
      const html = marked(`before ${words} after`, words)
      expect(html).toContain('<mark')
    }
  })

  it('still keeps raw HTML out of a message it marks', () => {
    // A block that opens with a tag is HTML and is dropped whole; a tag after words is dropped from among them.
    expect(marked('<script>alert(1)</script> checkout', 'checkout')).not.toMatch(/<script/i)
    const html = marked('checkout <script>alert(1)</script>', 'checkout')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('<mark')
  })
})

describe("SafeMarkdown for a message: mentions and Jam's line breaks", () => {
  const SELF = 'a1000000-0000-4000-8000-000000000001'
  const OTHER = 'a2000000-0000-4000-8000-000000000002'
  const message = (text: string, breaks = false) =>
    renderToStaticMarkup(
      createElement(SafeMarkdown, {
        text,
        breaks,
        mentions: { names: { [SELF]: 'Maria Tamm', [OTHER]: 'Atlas' }, selfId: SELF },
      }),
    )

  it("draws each mention as a chip named from the room, the reader's own marked, and never as a link", () => {
    const html = message(`@[[${SELF}]] and @[[${OTHER}]]`)
    expect(html).toMatch(/<span data-mention="self"[^>]*>@Maria Tamm<\/span>/)
    expect(html).toMatch(/<span data-mention="other"[^>]*>@Atlas<\/span>/)
    expect(html).not.toMatch(/<a /)
  })

  it('never lets a name that reads as Markdown become Markdown', () => {
    const hostile = 'a3000000-0000-4000-8000-000000000003'
    const html = renderToStaticMarkup(
      createElement(SafeMarkdown, {
        text: `@[[${hostile}]] please look`,
        mentions: { names: { [hostile]: '[Verify your account](https://evil.example)' }, selfId: SELF },
      }),
    )
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('evil.example"')
    expect(html).toMatch(/<span data-mention="other"/)
  })

  it('keeps single line breaks only when asked, as a message shows them', () => {
    const twoLines = ['one', 'two'].join(String.fromCharCode(10))
    expect(message(twoLines, true)).toMatch(/one<br\/>\s*two/)
    expect(message(twoLines)).not.toContain('<br')
  })
})
