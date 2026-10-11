import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '@/lib/utils'

// ZCode's tooltips (docs/DESIGN.md, "Tooltips"): a card of radius 8 with a 1px line, 12px text at weight 500, no arrow,
// a shortcut in a mono key tag.

function TooltipProvider({ delay = 500, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 6,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-lg border border-line bg-tooltip py-1 pr-2.5 pl-2.5 text-ui-sm font-medium text-tooltip-foreground has-data-[slot=kbd]:pr-1 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0',
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
