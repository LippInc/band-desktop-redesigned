import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { SearchIcon } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

// The command list inside ZCode's palette (docs/DESIGN.md, "Command palette"): a pill search field on the input surface,
// group headings at weight 500 in the quiet ink, rows 35 tall of radius 12 that take the secondary grey when selected.

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn('flex size-full flex-col overflow-hidden bg-popover text-popover-foreground', className)}
      {...props}
    />
  )
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-8 items-center gap-2 rounded-full border border-line-strong bg-input px-2.5"
    >
      <SearchIcon className="size-4 shrink-0 text-foreground-subtle" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'min-w-0 flex-1 bg-transparent text-ui-base leading-5 text-foreground outline-none select-text placeholder:text-foreground-subtlest disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'max-h-[min(440px,60vh)] scroll-py-1 overflow-x-hidden overflow-y-auto p-1 outline-none',
        className,
      )}
      {...props}
    />
  )
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('py-8 text-center text-ui-base text-foreground-subtle', className)}
      {...props}
    />
  )
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'overflow-hidden text-foreground **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-ui-base **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-foreground-subtle',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('-mx-1 my-1 h-px bg-line', className)}
      {...props}
    />
  )
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-xl px-2.5 py-1.5 text-ui-base outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-secondary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-foreground-subtle",
        className,
      )}
      {...props}
    />
  )
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'kbd'>) {
  return <Kbd size="md" data-slot="command-shortcut" className={cn('ml-auto', className)} {...props} />
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
