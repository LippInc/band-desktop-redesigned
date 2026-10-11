import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from '@/lib/utils'

// ZCode's popovers (docs/DESIGN.md, "Menus"): the same card as a menu - radius 12, a 1px line, a medium shadow - but
// holding controls rather than rows, so its padding is the content's own.

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props & {
  align?: PopoverPrimitive.Positioner.Props['align']
  sideOffset?: PopoverPrimitive.Positioner.Props['sideOffset']
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner align={align} sideOffset={sideOffset} className="z-50">
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'min-w-40 origin-(--transform-origin) rounded-xl border border-line bg-surface p-1 text-foreground shadow-md outline-none',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
