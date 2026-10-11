import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'

/** ZCode's switch, 32×18 with a 16 thumb; on is BAND's green with an ink thumb. */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full p-px transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 data-unchecked:bg-foreground-subtlest',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full transition-transform data-checked:translate-x-3.5 data-checked:bg-primary-foreground data-unchecked:translate-x-0 data-unchecked:bg-background"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
