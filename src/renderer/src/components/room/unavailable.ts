import { daemonErrorCode } from '@/lib/daemon-error'
import type { Loadable } from '@/stores/daemon'

type Reason = Extract<Loadable<unknown>, { state: 'unavailable' }>['reason']

/**
 * Why a part of a screen (a room's, Home's agents) cannot be shown, in words, for the part named. A part the daemon
 * cannot give degrades only itself; the rest of the screen stays.
 */
export function unavailableText(what: string, reason: Reason): string {
  switch (reason) {
    case 'offline':
      return `${what} will show when Band is running again.`
    case 'unsupported':
      return `This version of Band does not offer ${what.toLowerCase()}.`
    case 'changed':
      return `Band answered with ${what.toLowerCase()} in a form this app does not know yet.`
    case 'failed':
      return `Band could not read ${what.toLowerCase()} right now.`
  }
}

/**
 * The same, chosen from what the daemon answered: every screen says the same thing about the same state, so a person
 * who has read one of them knows what the others mean.
 */
export function unavailableFor(error: unknown, what: string): string {
  const code = daemonErrorCode(error)
  if (code === 'unsupported') return unavailableText(what, 'unsupported')
  if (code === 'invalid-answer') return unavailableText(what, 'changed')
  if (code === 'offline') return unavailableText(what, 'offline')
  return unavailableText(what, 'failed')
}
