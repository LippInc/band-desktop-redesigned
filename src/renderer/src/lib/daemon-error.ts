import { DAEMON_ERROR_CODES, type DaemonErrorCode } from '@shared/daemon-api'

/**
 * Reads the code the main process puts in a refused daemon operation (`[jam:<code>] text`). Electron wraps the message
 * ("Error invoking remote method ...: Error: [jam:offline] ..."), so the code is found anywhere in it.
 */
export function daemonErrorCode(error: unknown): DaemonErrorCode | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const match = /\[jam:([a-z-]+)\]/.exec(message)
  const code = match?.[1]
  return code && (DAEMON_ERROR_CODES as readonly string[]).includes(code) ? (code as DaemonErrorCode) : null
}

/** The part of the message meant for a person, without Electron's prefix or the code. */
export function daemonErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const tagged = /\[jam:[a-z-]+\]\s*(.*)$/s.exec(message)
  return (tagged?.[1] ?? message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')).trim()
}
