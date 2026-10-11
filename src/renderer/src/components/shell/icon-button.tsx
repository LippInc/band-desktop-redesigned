import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shortcutLabel } from '@/lib/platform'
import { cn } from '@/lib/utils'

interface IconButtonProps extends Omit<ComponentProps<typeof Button>, 'children'> {
  label: string
  shortcut?: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/** An icon-only button with ZCode's tooltip: its name, and its shortcut in a key tag. */
export function IconButton({ label, shortcut, children, side = 'bottom', className, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={cn('text-foreground', className)}
            {...props}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side={side}>
        {label}
        {shortcut ? <Kbd>{shortcutLabel(shortcut)}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * A button in the title bar's right cluster: ZCode's 45×48 footprint with a square hover, over the drag region.
 * `active` marks a panel that is open.
 */
export function TitleBarButton({
  label,
  shortcut,
  children,
  active,
  className,
  ...props
}: IconButtonProps & { active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            className={cn(
              'inline-flex h-12 w-[45px] items-center justify-center text-foreground transition-colors outline-none no-drag hover:bg-hover [&_svg]:size-4',
              active && 'bg-selected hover:bg-selected',
              className,
            )}
            {...(props as ComponentProps<'button'>)}
          >
            {children}
          </button>
        }
      />
      <TooltipContent side="bottom">
        {label}
        {shortcut ? <Kbd>{shortcutLabel(shortcut)}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}
