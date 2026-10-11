import { cn } from '@/lib/utils'

/**
 * A shortcut key tag. `sm` is ZCode's tooltip tag (16 tall, mono, 10px); `md` is the key cap in the palette and menus.
 */
function Kbd({ className, size = 'sm', ...props }: React.ComponentProps<'kbd'> & { size?: 'sm' | 'md' }) {
  return (
    <kbd
      data-slot="kbd"
      data-size={size}
      className={cn(
        'pointer-events-none inline-flex w-fit shrink-0 items-center justify-center font-mono font-medium whitespace-nowrap text-kbd-foreground select-none',
        size === 'sm' ? 'h-4 rounded-sm bg-kbd px-1.5 text-ui-xs' : 'h-5 rounded-md bg-kbd px-1.5 font-sans text-ui-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
