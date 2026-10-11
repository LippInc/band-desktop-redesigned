import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Band's Copy handle, on the handle it copies: Sonar's people, and a team's members (Band Desktop 0.4.14). Writing to
 * the clipboard is the one permission this app allows.
 */
export function CopyHandle({ handle }: { handle: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? 'Copied' : 'Copy handle'}
      onClick={(event) => {
        event.stopPropagation()
        navigator.clipboard
          ?.writeText(handle)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => {})
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}
