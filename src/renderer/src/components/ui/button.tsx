import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Buttons as ZCode draws them (docs/DESIGN.md, "Controls"): regular weight, radius 8, colour transitions of 150 ms.
 * The filled button is BAND's green with BAND's ink, as band.ai paints its own; ZCode's is white on dark.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-transparent text-ui-base font-normal whitespace-nowrap transition-colors outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-brand-hover',
        outline: 'border-line bg-transparent hover:bg-hover aria-expanded:bg-hover',
        secondary: 'bg-secondary hover:bg-surface-hover aria-expanded:bg-surface-hover',
        ghost: 'hover:bg-hover aria-expanded:bg-hover data-[state=open]:bg-hover',
        destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
        link: 'text-brand-text underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-2.5',
        sm: 'h-7 px-2',
        xs: 'h-6 px-2',
        pill: 'h-6 rounded-full px-2',
        icon: 'size-8',
        'icon-sm': 'size-7',
        'icon-xs': 'size-6 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
