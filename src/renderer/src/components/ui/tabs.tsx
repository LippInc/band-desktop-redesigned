import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cn } from '@/lib/utils'

/**
 * Tabs in ZCode's two forms (docs/DESIGN.md, "Tabs"): `pills` for a page's views (Usage stats' "App usage", the
 * Marketplace's "Public"), 29 tall, radius full, weight 500, the active one on the selected tint; `segmented` for a card's
 * own switch (Daily, Weekly), 24 tall on a surface track, the active one on the page background.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />
}

function TabsList({
  className,
  variant = 'pills',
  ...props
}: TabsPrimitive.List.Props & { variant?: 'pills' | 'segmented' }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        'group/tabs-list inline-flex w-fit items-center',
        variant === 'pills' ? 'gap-1.5' : 'gap-0.5 rounded-full bg-surface p-0.5',
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap text-foreground-subtle transition-colors outline-none hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-active:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0',
        'group-data-[variant=pills]/tabs-list:px-3 group-data-[variant=pills]/tabs-list:py-1 group-data-[variant=pills]/tabs-list:text-ui-base group-data-[variant=pills]/tabs-list:data-active:bg-selected',
        'group-data-[variant=segmented]/tabs-list:h-6 group-data-[variant=segmented]/tabs-list:px-2.5 group-data-[variant=segmented]/tabs-list:text-ui-sm group-data-[variant=segmented]/tabs-list:data-active:bg-background',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
