import { AlertTriangle, Loader2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { BUILT_AGAINST } from '@shared/daemon'
import { Button } from '@/components/ui/button'
import { useDaemon } from '@/stores/daemon'

/**
 * What the app says about the Jam daemon, under the title bar. It never starts the daemon (README, "What this app never
 * does"): when none answers, it says so and points to the official app. A daemon on another wire version, or one that
 * does not state it, gets a notice that some screens may not work, and the app goes on.
 */
export function DaemonBanner() {
  const status = useDaemon((state) => state.status)
  const reconnect = useDaemon((state) => state.reconnect)
  const [slow, setSlow] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const running = status.state === 'connected' ? `${status.version}/${status.wire ?? '?'}` : null

  // "Connecting…" only after a moment, so a quick start does not flash a banner.
  useEffect(() => {
    if (status.state !== 'connecting') return
    const timer = setTimeout(() => setSlow(true), 800)
    return () => {
      clearTimeout(timer)
      setSlow(false)
    }
  }, [status.state])

  if (status.state === 'connecting' && slow) {
    return (
      <Banner role="status">
        <Loader2 className="animate-spin text-foreground-subtle" />
        <span>Connecting to the Band daemon…</span>
      </Banner>
    )
  }
  if (status.state === 'offline') {
    // "not-answering": the daemon is there but did not answer in time (busy, or stuck); "not-found": nothing answers.
    const busy = status.reason === 'not-answering'
    return (
      <Banner role="alert">
        <AlertTriangle className="text-warning" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{busy ? "Band isn't answering." : "Band isn't running."}</span>{' '}
          <span className="text-foreground-subtle">
            {busy
              ? 'It may be busy; this window connects again on its own.'
              : 'Open the Band app to start it; this window connects on its own.'}
          </span>
        </span>
        <Button variant="outline" size="sm" onClick={() => void reconnect()}>
          Try again
        </Button>
      </Banner>
    )
  }
  if (status.state === 'connected' && !status.wireMatches && dismissed !== running) {
    return (
      <Banner role="status">
        <AlertTriangle className="text-warning" />
        <span className="min-w-0 flex-1 text-foreground-subtle">
          This app was built for Band {BUILT_AGAINST.daemonVersion} (protocol {BUILT_AGAINST.wire}); the running Band is{' '}
          {status.version} (protocol {status.wire ?? 'not stated'}). Some screens may not work until the app is updated.
        </span>
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setDismissed(running)}>
          <X />
        </Button>
      </Banner>
    )
  }
  return null
}

function Banner({ role, children }: { role: 'status' | 'alert'; children: ReactNode }) {
  return (
    <div
      role={role}
      aria-label="Band connection"
      className="flex min-h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-1.5 text-ui-base [&_svg]:size-4 [&_svg]:shrink-0"
    >
      {children}
    </div>
  )
}
