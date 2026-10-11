import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'
import { cn } from '@/lib/utils'

/** ZCode's field: 32 tall, radius 8, the input surface with a 1px line that strengthens on hover and focus. */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-line bg-input px-2.5 text-ui-base text-foreground transition-colors outline-none select-text placeholder:text-foreground-subtlest hover:border-line-strong focus:border-line-strong disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
