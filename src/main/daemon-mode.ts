/**
 * Which daemon a run talks to (README, "Develop"):
 * - a packaged build: always the live daemon, found by discovery; no JAMR_* variable changes that (on macOS and Linux,
 *   discovery honours Jam's own JAM_CONFIG_DIR, as Jam's CLI does, and still confirms the socket with a ping);
 * - an unpackaged run with JAMR_DAEMON_ENDPOINT: that endpoint, the fake daemon of `pnpm dev`, the e2e suite and ui:check;
 * - an unpackaged run with JAMR_DAEMON=live: the live daemon, on purpose (`pnpm dev:live`);
 * - any other unpackaged run: no daemon at all, so unfinished code never reaches a real account by accident.
 */
export type DaemonMode = { kind: 'live' } | { kind: 'fake'; endpoint: string } | { kind: 'none' }

export function resolveDaemonMode(isPackaged: boolean, env: NodeJS.ProcessEnv): DaemonMode {
  if (isPackaged) return { kind: 'live' }
  const endpoint = env.JAMR_DAEMON_ENDPOINT?.trim()
  if (endpoint) return { kind: 'fake', endpoint }
  if (env.JAMR_DAEMON === 'live') return { kind: 'live' }
  return { kind: 'none' }
}
