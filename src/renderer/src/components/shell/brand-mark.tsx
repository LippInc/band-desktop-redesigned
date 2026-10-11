import { JamMascot } from '@/components/jam-mascot'
import { cn } from '@/lib/utils'

/**
 * The mark: Band's own mascot, which Band Desktop 0.4.14 uses as its app icon and Home shows above "Assign work". It is
 * BAND's artwork from their public site (`components/jam-mascot.tsx`), not this app's drawing, and keeps BAND's colours
 * under every theme.
 */
export function BrandMark({ className }: { className?: string }) {
  return <JamMascot className={cn('size-7', className)} />
}
