import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// ZCode's check box (docs/DESIGN.md, "Controls"): a 16 square of radius 4 on the line's grey, filled with the brand
// green when it is on. Its focus ring comes from the one rule in globals.css, as every control's does.
//
// The whole row is the control. Anything passed as children sits beside the box and is the box's own label, so a row
// of a label and a note under it is one thing to click and one thing a screen reader announces.

const BOX =
  'flex size-4 shrink-0 items-center justify-center rounded border border-line-strong bg-background transition-colors group-data-checked:border-primary group-data-checked:bg-primary group-data-checked:text-brand-text'

function Checkbox({ className, children, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'group flex cursor-default items-start gap-2.5 text-left outline-none data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span className={cn(BOX, children ? 'mt-0.5' : undefined)}>
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          <CheckIcon className="size-3" />
        </CheckboxPrimitive.Indicator>
      </span>
      {children}
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
