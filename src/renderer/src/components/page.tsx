import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A section page in ZCode's frame (docs/DESIGN.md, "Pages"): a centred column 832 wide, the title 24 under the title bar
 * at 30/36 weight 600 with tight tracking, its description 12 below in the quieter ink, actions on the right, content 32
 * below.
 */
export function Page({
  title,
  description,
  actions,
  children,
  wide,
  variant = 'page',
  fill = false,
}: {
  /** Left out by a page Jam gives no title, which opens straight into its content (docs/jam/differences.md). */
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  /** The Marketplace's 848 instead of 832, for a page with a two-column list. */
  wide?: boolean
  /** Settings pages start right under the title bar, as ZCode's do; other pages 24 below it. */
  variant?: 'page' | 'settings'
  /**
   * The page fills the window and scrolls nothing itself (`data-scroll="own"`, as the room's page does): its content
   * takes the height under the title and scrolls in its own parts, so a control docked at the foot stays in reach.
   */
  fill?: boolean
}) {
  return (
    <div
      data-scroll={fill ? 'own' : undefined}
      className={cn(
        'mx-auto w-full px-4',
        fill ? 'flex h-full min-h-0 flex-col pb-4' : 'pb-16',
        variant === 'settings' ? 'pt-px' : 'pt-6',
        wide ? 'max-w-[880px]' : 'max-w-[864px]',
      )}
    >
      {title === undefined && description === undefined && actions === undefined ? null : (
        <header className="mb-8 flex shrink-0 items-end gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {title === undefined ? null : <h1 className="text-ui-title font-semibold text-foreground">{title}</h1>}
            {description ? (
              <p data-slot="page-description" className="text-ui-base leading-5 text-pretty text-foreground-subtle">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className={cn('flex flex-col gap-8', fill && 'min-h-0 flex-1')}>{children}</div>
    </div>
  )
}

/** A heading inside a page: ZCode's "Installed" and "Productivity", 16/24 at weight 600, with an optional note. */
export function PageSection({
  title,
  note,
  actions,
  children,
}: {
  /** Left out where Jam's own page has no heading over its group, only a note. */
  title?: ReactNode
  note?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          {title ? <h2 className="text-ui-lg font-semibold text-foreground">{title}</h2> : null}
          {note ? <p className="mt-1 text-ui-base leading-6 text-pretty text-foreground-subtle">{note}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** ZCode's empty-state card: 226 tall, radius 16, a 1px card line on the page background, centred text and actions. */
export function EmptyCard({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex min-h-[226px] w-full flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-background px-4 py-8 text-center">
      <div className="flex max-w-md flex-col gap-1.5">
        <p className="text-ui-base text-foreground-subtle">{title}</p>
        {description ? <p className="text-ui-base text-pretty text-foreground-subtlest">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** ZCode's settings card: radius 12, the card surface, a 1px line, rows divided by 1px lines. */
export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-hidden rounded-xl border border-line bg-card', className)}>{children}</div>
}

/** A settings row: 12/16 padding, the label at 500 over a quieter description, the control on the right. */
export function SettingsRow({
  label,
  description,
  control,
  children,
}: {
  label: ReactNode
  description?: ReactNode
  control?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="border-t border-line px-4 py-3 text-ui-base leading-[1.625] first:border-t-0">
      <div className="flex items-center gap-6">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">{label}</div>
          {description ? <div className="text-pretty text-foreground-subtle">{description}</div> : null}
        </div>
        {control ? <div className="flex shrink-0 items-center justify-end gap-2">{control}</div> : null}
      </div>
      {children}
    </div>
  )
}

/**
 * ZCode's stat strip (Usage stats): one surface card of radius 12, the values centred with their labels below.
 *
 * `wrap` is for a strip with more totals than fit across the column, which Jam shows in one row of its full-width
 * pane: four to a row here, two where even that would cut the names short. A total marked `wide` takes two cells, so
 * a count that does not divide by four still fills every row - Analytics' seven become eight units, which fit four
 * columns and two with no hole in either. How many fit is asked of the strip itself, not of the window, because the
 * page is a centred column: at the same window width the strip is one width on a page and another in a narrow panel.
 */
export function StatStrip({
  stats,
  wrap,
}: {
  stats: { label: string; value: ReactNode; note?: ReactNode; beside?: ReactNode; wide?: true }[]
  wrap?: true
}) {
  return (
    <section className="@container overflow-hidden rounded-xl bg-surface" aria-label="Totals">
      <div className={cn(wrap ? 'grid grid-cols-2 @xl:grid-cols-4' : 'flex flex-col @lg:flex-row @lg:items-center')}>
        {stats.map((stat) => (
          <div
            key={stat.label}
            data-slot="stat"
            className={cn('min-w-0 px-4 py-3 text-center', wrap ? (stat.wide ? 'col-span-2' : null) : 'flex-1')}
          >
            <div className="flex items-center justify-center gap-2">
              <span className="text-ui-lg font-semibold text-foreground tabular-nums">{stat.value}</span>
              {stat.beside}
            </div>
            <div className="mt-1 truncate text-ui-base text-foreground-subtle">{stat.label}</div>
            {stat.note ? <div className="mt-0.5 truncate text-ui-xs text-foreground-subtlest">{stat.note}</div> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

/** A note that a part of a screen arrives in a later session, stated once and plainly. */
export function ComingNote({ children }: { children: ReactNode }) {
  return <p className="text-ui-sm text-foreground-subtlest">{children}</p>
}
