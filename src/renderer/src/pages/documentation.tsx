import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GuideRead } from '@shared/guide'
import { EmptyCard, Page } from '@/components/page'
import { SafeMarkdown } from '@/components/markdown'
import { Input } from '@/components/ui/input'
import {
  anchorTarget,
  guideContents,
  guideProblem,
  guideSections,
  railScroll,
  READING_LINE,
  readingSection,
  SEARCH_MIN,
  searchGuide,
} from '@/lib/guide'
import { jam } from '@/lib/platform'
import { cn } from '@/lib/utils'

/**
 * Documentation (Jam Desktop 0.4.10, read 2026-09-20): Jam's own user guide, read from the Jam install beside the
 * running daemon and shown read-only. Its list of parts and pages stands on the left, as Jam's does, with its search
 * over it; the guide itself is on the right. The page carries no title of its own: it opens on the guide's, as
 * Jam's does.
 *
 * The guide is Jam's. It is never copied into this project, never rewritten, and never edited here - the screen
 * reads it and shows it. Where it was read from stays in the main process.
 */
export function DocumentationPage() {
  const [guide, setGuide] = useState<GuideRead | null>(null)
  const [query, setQuery] = useState('')
  const [reading, setReading] = useState<string | null>(null)
  const article = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const api = jam()
    if (!api) return
    let current = true
    api.guide
      .read()
      .then((read) => current && setGuide(read))
      .catch(() => current && setGuide({ state: 'unreadable' }))
    return () => {
      current = false
    }
  }, [])

  const markdown = guide?.state === 'read' ? guide.markdown : ''
  const sections = useMemo(() => guideSections(markdown), [markdown])
  const contents = useMemo(() => guideContents(sections), [sections])
  const hits = useMemo(() => searchGuide(sections, query), [sections, query])
  const searching = query.trim().length >= SEARCH_MIN
  const title = sections.find((one) => one.level === 1)?.title ?? 'Documentation'

  const jump = useCallback((id: string) => {
    const target = article.current?.querySelector(`[data-guide-id="${CSS.escape(id)}"]`)
    if (!(target instanceof HTMLElement)) return
    target.scrollIntoView({ block: 'start' })
    // The keyboard goes where the view went: the next Tab carries on from the section, and a reader is told of it.
    target.tabIndex = -1
    target.focus({ preventScroll: true })
  }, [])

  // A link within the guide jumps to its section, as one does in Jam Desktop; a link out of the guide is left alone.
  const anchors = useMemo(() => ({ target: (href?: string) => anchorTarget(href, sections), jump }), [sections, jump])

  /**
   * The guide's own Markdown, shown through the one renderer this app has: text and sanitised Markdown, never raw
   * HTML, and a link opens only through the main process. Built once per guide, and never again while the reading
   * position moves: react-markdown parses its text on every render, and the guide Jam ships is eighty-odd sections.
   */
  const body = useMemo(
    () =>
      sections.map((section, index) => (
        <section
          key={section.id}
          data-guide-id={section.id}
          // The last section stands at least a view tall, so every heading in the guide can be brought to the top of
          // the page. Without it the last few pages of a long guide cannot be jumped to at all: the scrolling stops
          // at the end of the text while their headings are still below the top.
          className={cn('scroll-mt-6', index === sections.length - 1 ? 'min-h-[calc(100vh-4rem)]' : null)}
        >
          <Heading level={section.level}>{section.title}</Heading>
          {section.body.trim() === '' ? null : <SafeMarkdown text={section.body} anchors={anchors} />}
        </section>
      )),
    [sections, anchors],
  )

  // The list follows the reading position (user guide, "Documentation"), which is measured from the page's scrolling.
  useEffect(() => {
    const view = article.current
    const scroller = view?.closest('main')
    if (!view || !scroller) return
    let frame = 0
    const measure = () => {
      frame = 0
      const top = scroller.getBoundingClientRect().top
      const tops = [...view.querySelectorAll('[data-guide-id]')].map((section) => ({
        id: section.getAttribute('data-guide-id') ?? '',
        top: section.getBoundingClientRect().top - top,
      }))
      setReading(readingSection(tops, READING_LINE))
    }
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }
    measure()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    const reflow = new ResizeObserver(onScroll)
    reflow.observe(view)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      reflow.disconnect()
    }
  }, [sections])

  // A mark out of sight marks nothing: the list brings it into view, moving itself and never the page.
  useEffect(() => {
    const rail = list.current
    const item = reading === null ? null : rail?.querySelector(`[data-guide-jump="${CSS.escape(reading)}"]`)
    if (!rail || !item) return
    const railAt = rail.getBoundingClientRect()
    rail.scrollTop = railScroll({ ...railAt, scrollTop: rail.scrollTop }, item.getBoundingClientRect())
  }, [reading, searching])

  if (guide === null) {
    return (
      <Page>
        <p className="text-ui-base text-foreground-subtle">Reading the Band user guide on this computer…</p>
      </Page>
    )
  }

  if (guide.state !== 'read') {
    return (
      <Page>
        <EmptyCard title="The Band user guide is not here." description={guideProblem(guide.state)} />
      </Page>
    )
  }

  return (
    <Page wide>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Jam's own list of parts and pages, with its search over it. */}
        {/* Jam's list scrolls inside its own pane: the real guide has eighty-odd entries, far more than a window
            holds, so a rail that only stuck would put most of them out of reach. */}
        <nav
          aria-label="Guide contents"
          className="flex shrink-0 flex-col gap-3 lg:sticky lg:top-6 lg:max-h-[calc(100vh-7rem)] lg:w-64"
        >
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-subtle"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documentation…"
              aria-label="Search documentation"
              className="pl-9"
            />
          </div>
          {searching ? (
            <ul
              data-slot="guide-list"
              className="flex min-h-0 flex-col gap-1 overflow-y-auto pr-1"
              aria-label="Search results"
            >
              {hits.length === 0 ? (
                <li className="px-2 py-1.5 text-ui-sm text-foreground-subtle">Nothing in the guide matches that.</li>
              ) : (
                hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      data-guide-jump={hit.id}
                      onClick={() => jump(hit.id)}
                      className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover"
                    >
                      <span className="truncate text-ui-sm font-medium text-foreground">{hit.title}</span>
                      <span className="line-clamp-2 text-ui-xs text-foreground-subtle">{hit.excerpt}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : (
            <ul ref={list} data-slot="guide-list" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto pr-1">
              {contents.map((entry) => (
                <li key={entry.section.id}>
                  <ContentsLink section={entry.section} reading={reading} onJump={jump} />
                  {entry.children.length > 0 ? (
                    <ul className="flex flex-col gap-0.5">
                      {entry.children.map((child) => (
                        <li key={child.id}>
                          <ContentsLink section={child} reading={reading} onJump={jump} nested />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </nav>
        <article ref={article} className="min-w-0 flex-1" aria-label={title}>
          {body}
        </article>
      </div>
    </Page>
  )
}

function ContentsLink({
  section,
  reading,
  onJump,
  nested,
}: {
  section: { id: string; title: string }
  reading: string | null
  onJump: (id: string) => void
  nested?: boolean
}) {
  const here = reading === section.id
  return (
    <button
      type="button"
      onClick={() => onJump(section.id)}
      data-guide-jump={section.id}
      aria-current={here ? 'true' : undefined}
      className={cn(
        'w-full truncate rounded-lg px-2 py-1.5 text-left text-ui-sm transition-colors',
        nested ? 'pl-5 text-foreground-subtle' : 'font-medium text-foreground',
        here ? 'bg-selected' : 'hover:bg-hover',
      )}
    >
      {section.title}
    </button>
  )
}

/** The guide's own heading levels, in this app's type scale. */
function Heading({ level, children }: { level: number; children: string }) {
  if (level <= 1) {
    return <h1 className="mt-0 mb-6 text-ui-title font-semibold text-foreground">{children}</h1>
  }
  if (level === 2) {
    return <h2 className="mt-10 mb-3 text-ui-xl font-semibold text-foreground">{children}</h2>
  }
  return <h3 className="mt-6 mb-2 text-ui-lg font-semibold text-foreground">{children}</h3>
}
