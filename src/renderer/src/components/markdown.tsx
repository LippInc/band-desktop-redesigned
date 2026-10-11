import { useMemo, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isSafeExternalUrl } from '@shared/external-url'
import { mentionIdOf, withMentionLinks } from '@/lib/messages'
import { jam } from '@/lib/platform'
import { cn } from '@/lib/utils'

/**
 * Markdown from the daemon (a room's plan), which is untrusted (README, "What this app never does"): GitHub's flavour,
 * raw HTML skipped, an image never loaded (its text stands in), and a link opened only through the main process and
 * only for https and mailto (the check the main process applies again); any other link is plain text.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="mt-5 mb-2 text-ui-lg font-semibold text-foreground first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-5 mb-2 text-ui-base font-semibold text-foreground first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-4 mb-1.5 text-ui-base font-medium text-foreground first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mt-4 mb-1.5 text-ui-base font-medium text-foreground first:mt-0">{children}</h6>,
  h5: ({ children }) => <h6 className="mt-4 mb-1.5 text-ui-base font-medium text-foreground first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 className="mt-4 mb-1.5 text-ui-base font-medium text-foreground first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-line-strong pl-3 text-foreground-subtle">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-line" />,
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-ui-sm leading-5">{children}</pre>
  ),
  code: ({ children, className }) => (
    <code
      className={cn(
        'rounded bg-surface px-1 py-0.5 font-mono text-ui-sm [pre_&]:bg-transparent [pre_&]:p-0',
        className,
      )}
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-ui-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-line bg-surface px-2 py-1 font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-line px-2 py-1">{children}</td>,
  a: ({ href, children }) => renderLink(href, children),
  mark: ({ children }) => <mark className="rounded bg-primary/30 text-foreground">{children}</mark>,
  img: ({ alt }) => (alt ? <span className="text-foreground-subtle">{alt}</span> : null),
}

/**
 * A mention as a chip, as Jam Desktop shows it: "@Name" on a quiet tint, or on the attention tint when it names the
 * person reading.
 */
function mentionChip(selfId: string | null): Components['a'] {
  return function Anchor({ href, children }) {
    const id = mentionIdOf(href)
    if (id === null) return renderLink(href, children)
    return (
      <span
        data-mention={id === selfId ? 'self' : 'other'}
        className={cn(
          'rounded-md px-1 py-px font-medium whitespace-nowrap',
          id === selfId ? 'bg-destructive/15 text-foreground' : 'bg-surface text-foreground-subtle',
        )}
      >
        {children}
      </span>
    )
  }
}

/**
 * What a link within the same document does. Only the guide has one: it is the only text this app shows that carries
 * its own sections (`@/lib/guide`).
 */
export interface DocumentAnchors {
  /** The section this link points at, or null when it points outside the document. */
  target: (href: string | undefined) => string | null
  jump: (id: string) => void
}

/**
 * A link within the document as a control that jumps, which is how Jam Desktop draws one in its guide; a link that
 * points outside it is left to the rule above - plain text unless it is a link this app can open.
 */
function anchorLink(anchors: DocumentAnchors): Components['a'] {
  return function Anchor({ href, children }) {
    const id = anchors.target(href)
    if (id === null) return renderLink(href, children)
    return (
      <button
        type="button"
        data-anchor={id}
        onClick={() => anchors.jump(id)}
        className="text-brand-text underline-offset-2 hover:underline"
      >
        {children}
      </button>
    )
  }
}

function renderLink(href: string | undefined, children: ReactNode) {
  return isSafeExternalUrl(href) ? (
    <a
      href={href}
      className="text-brand-text underline-offset-2 hover:underline"
      onClick={(event) => {
        event.preventDefault()
        void jam()?.shell.openExternal(href)
      }}
    >
      {children}
    </a>
  ) : (
    <span>{children}</span>
  )
}

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: { hName?: string } }

/**
 * A message's single line breaks kept, as Jam Desktop shows a message: each newline inside a paragraph becomes a break
 * (what remark-breaks does, in a few lines). Code blocks and inline code keep their own text.
 */
function remarkLineBreaks() {
  const walk = (node: MdNode) => {
    if (!node.children) return
    const next: MdNode[] = []
    for (const child of node.children) {
      if (child.type === 'text' && child.value?.includes('\n')) {
        child.value.split(/\r?\n/).forEach((part, index) => {
          if (index > 0) next.push({ type: 'break' })
          if (part) next.push({ type: 'text', value: part })
        })
      } else {
        walk(child)
        next.push(child)
      }
    }
    node.children = next
  }
  return (tree: MdNode) => walk(tree)
}

/**
 * The words a search found, marked where they are said (user guide, "Use Chat": Jam takes you to that message with
 * the term highlighted). It walks the text of the message and nothing else: a word inside a link's address, a code
 * fence's own text or a mention's id is not text a person reads, and is left alone. The words are marked as they
 * were written, not as they were typed: the search does not care about case, and the message keeps its own.
 */
function remarkHighlight(words: string) {
  const needle = words.toLowerCase()
  const split = (value: string): MdNode[] => {
    const out: MdNode[] = []
    let at = 0
    const lower = value.toLowerCase()
    for (let found = lower.indexOf(needle); found >= 0; found = lower.indexOf(needle, at)) {
      if (found > at) out.push({ type: 'text', value: value.slice(at, found) })
      out.push({
        type: 'emphasis',
        data: { hName: 'mark' },
        children: [{ type: 'text', value: value.slice(found, found + needle.length) }],
      })
      at = found + needle.length
    }
    if (out.length === 0) return [{ type: 'text', value }]
    if (at < value.length) out.push({ type: 'text', value: value.slice(at) })
    return out
  }
  const walk = (node: MdNode) => {
    if (!node.children) return
    const next: MdNode[] = []
    for (const child of node.children) {
      if (child.type === 'text' && child.value) next.push(...split(child.value))
      else {
        walk(child)
        next.push(child)
      }
    }
    node.children = next
  }
  return (tree: MdNode) => walk(tree)
}

/**
 * Untrusted Markdown, rendered safely (COMPONENTS). With `mentions`, a message's `@[[id]]` mentions become chips named
 * from `mentions.names`, the person's own (`mentions.selfId`) standing out; `breaks` keeps a message's single line breaks.
 * With `anchors`, a link within the same document jumps to its section - which only the guide has, so a message's text
 * never gains one, and `mentions` wins if both are given.
 */
export function SafeMarkdown({
  text,
  className,
  mentions,
  anchors,
  highlight,
  breaks = false,
}: {
  text: string
  className?: string
  mentions?: { names: Record<string, string>; selfId: string | null }
  anchors?: DocumentAnchors
  /** Words to mark where they are said: what a search found in this text. */
  highlight?: string
  breaks?: boolean
}) {
  const selfId = mentions?.selfId ?? null
  const withMentions = mentions !== undefined
  const components = useMemo(() => {
    if (withMentions) return { ...COMPONENTS, a: mentionChip(selfId) }
    if (anchors) return { ...COMPONENTS, a: anchorLink(anchors) }
    return COMPONENTS
  }, [withMentions, selfId, anchors])
  const marked = highlight?.trim() ?? ''
  const plugins = useMemo(() => {
    const some: unknown[] = [remarkGfm]
    if (breaks) some.push(remarkLineBreaks)
    if (marked !== '') some.push(() => remarkHighlight(marked))
    return some as Parameters<typeof Markdown>[0]['remarkPlugins']
  }, [breaks, marked])
  const source = mentions ? withMentionLinks(text, mentions.names) : text
  return (
    <div className={cn('text-ui-base leading-6 text-foreground select-text', className)}>
      <Markdown remarkPlugins={plugins} skipHtml components={components}>
        {source}
      </Markdown>
    </div>
  )
}
