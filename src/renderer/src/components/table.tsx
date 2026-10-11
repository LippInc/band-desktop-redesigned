import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The table Jam draws on a screen that lists rows of measured or reported values (Analytics' Per-agent summary and
 * per-model table, Sessions' host sessions), in ZCode's frame: one card of radius 12 on a 1px line, a quiet header
 * row, and each row divided from the last by a hairline the row itself carries.
 */
export function Table({
  head,
  align,
  children,
  label,
  hidden,
}: {
  head: readonly string[]
  /** One letter per column after the first: "r" puts it on the right, as a number belongs. */
  align: string
  children: ReactNode
  label?: string
  /** The answer behind the table never arrived, so an empty table would say something untrue. */
  hidden?: boolean
}) {
  if (hidden) return null
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <table className="w-full text-ui-base" aria-label={label}>
        <thead>
          <tr>
            {head.map((name, index) => (
              <th
                key={name}
                scope="col"
                className={cn(
                  'px-4 py-2.5 font-medium text-foreground-subtle',
                  index > 0 && align[index - 1] === 'r' ? 'text-right' : 'text-left',
                )}
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Cell({
  children,
  number,
  className,
  colSpan,
}: {
  children?: ReactNode
  number?: boolean
  className?: string
  colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn('px-4 py-2.5', number && 'text-right text-foreground-subtle tabular-nums', className)}
    >
      {children}
    </td>
  )
}

/**
 * The word a row reports in the daemon's own vocabulary ("live", "bound", "detached"), as Jam sets it: a small pill on
 * the strip, and BAND's green where the state is the running one.
 */
export function StatePill({ children, on }: { children: ReactNode; on?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-ui-sm',
        on ? 'bg-primary/15 text-brand-text' : 'bg-strip text-foreground-subtle',
      )}
    >
      {children}
    </span>
  )
}
