import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shortcutLabel } from '@/lib/platform'
import { cn } from '@/lib/utils'

/**
 * A sidebar row as ZCode draws it (docs/DESIGN.md, "Sidebar"): 32 tall, radius 8, 10 in, a 16 icon and the label 8 apart,
 * a faint shortcut on the right. The page shown takes `selected` (the same as the hover's stronger surface in ZCode's
 * themes, Jam's blue in the Jam theme), and only the other rows take the hover, so a hovered current row keeps its colour.
 */
const ROW =
  'group flex h-8 w-full shrink-0 items-center gap-2 overflow-hidden rounded-lg px-2.5 text-left text-ui-base text-foreground transition-colors outline-none [&_svg]:size-4 [&_svg]:shrink-0'

interface NavRowProps {
  icon: LucideIcon
  label: string
  shortcut?: string
  /** A count badge, e.g. Inbox's waiting items. */
  count?: number
  trailing?: ReactNode
}

export function NavLinkRow({ to, icon: Icon, label, shortcut, count, trailing }: NavRowProps & { to: string }) {
  return (
    <Link
      to={to}
      className={ROW}
      activeOptions={{ exact: to === '/' }}
      activeProps={{ className: 'bg-selected', 'aria-current': 'page' }}
      inactiveProps={{ className: 'hover:bg-surface-hover' }}
    >
      <Icon />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <RowEnd shortcut={shortcut} count={count} trailing={trailing} />
    </Link>
  )
}

export function NavButtonRow({
  onClick,
  icon: Icon,
  label,
  shortcut,
  count,
  trailing,
  active,
}: NavRowProps & { onClick(): void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(ROW, active ? 'bg-selected' : 'hover:bg-surface-hover')}
      aria-current={active ? 'page' : undefined}
    >
      <Icon />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <RowEnd shortcut={shortcut} count={count} trailing={trailing} />
    </button>
  )
}

/**
 * A section as the folded sidebar's rail shows it, as Jam's rail does: a 32 square around the 16 icon, the page shown on
 * `selected` as in the rows, and the name (with its shortcut) in a tooltip beside it. `badge` sits on the icon's corner.
 */
const RAIL_ITEM =
  'relative flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors outline-none [&_svg]:size-4'

interface RailItemProps {
  icon: LucideIcon
  label: string
  shortcut?: string
  badge?: ReactNode
}

export function RailLink({
  to,
  params,
  icon: Icon,
  label,
  shortcut,
  badge,
}: RailItemProps & { to: string; params?: Record<string, string> }) {
  return (
    <RailTooltip label={label} shortcut={shortcut}>
      <Link
        to={to}
        params={params}
        aria-label={label}
        className={RAIL_ITEM}
        activeOptions={{ exact: to === '/' }}
        activeProps={{ className: 'bg-selected', 'aria-current': 'page' }}
        inactiveProps={{ className: 'hover:bg-surface-hover' }}
      >
        <Icon />
        {badge}
      </Link>
    </RailTooltip>
  )
}

export function RailButton({
  onClick,
  icon: Icon,
  label,
  shortcut,
  active,
}: RailItemProps & { onClick(): void; active?: boolean }) {
  return (
    <RailTooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(RAIL_ITEM, active ? 'bg-selected' : 'hover:bg-surface-hover')}
        aria-current={active ? 'page' : undefined}
      >
        <Icon />
      </button>
    </RailTooltip>
  )
}

function RailTooltip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right">
        {label}
        {shortcut ? <Kbd>{shortcutLabel(shortcut)}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}

function RowEnd({ shortcut, count, trailing }: Pick<NavRowProps, 'shortcut' | 'count' | 'trailing'>) {
  return (
    <>
      {count ? (
        <span className="rounded-full bg-primary px-1.5 text-ui-xs leading-4 font-medium text-primary-foreground">
          {count}
        </span>
      ) : null}
      {shortcut ? (
        <span className="shrink-0 text-ui-xs text-foreground-subtlest">{shortcutLabel(shortcut)}</span>
      ) : null}
      {trailing}
    </>
  )
}
