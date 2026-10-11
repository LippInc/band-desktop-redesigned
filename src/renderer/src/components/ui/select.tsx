import * as React from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// ZCode's select (docs/DESIGN.md, "Controls"): a 192×32 trigger of radius 8 on the input surface; a popover list of
// radius 12 with rows of radius 8 that take the secondary grey when highlighted, and a quiet check on the chosen one.

const Select = SelectPrimitive.Root

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value data-slot="select-value" className={cn('flex-1 truncate text-left', className)} {...props} />
  )
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex h-8 w-48 items-center gap-1.5 rounded-lg border border-line bg-input pr-2 pl-3 text-ui-base whitespace-nowrap text-foreground transition-colors outline-none hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50 data-popup-open:border-line-strong [&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<ChevronDownIcon className="size-4 text-foreground-subtle" />} />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'end',
  alignOffset = 0,
  alignItemWithTrigger = false,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<SelectPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'alignItemWithTrigger'>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            'relative isolate z-50 max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-xl border border-line bg-popover p-1 text-popover-foreground shadow-popover duration-100 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
            className,
          )}
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-lg py-1.5 pr-8 pl-2 text-ui-base outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-secondary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 items-center gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={<span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />}
      >
        <CheckIcon className="text-foreground-subtle" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('-mx-1 my-1 h-px bg-line', className)}
      {...props}
    />
  )
}

export { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue }
export type SelectProps = React.ComponentProps<typeof Select>
