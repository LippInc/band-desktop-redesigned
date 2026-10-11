// dev.mjs - `pnpm dev` (hot reload) and `pnpm start` (the built app) on the FAKE daemon by default, so development never
// reaches a real account by accident: it starts tests/fake-daemon on a pipe of its own and points the app at it.
// `pnpm dev:live` is the one way an unpackaged run reaches the live daemon; it says so, and passes the live guard first
// (scripts/lib/live-guard.mjs). The profile is a throwaway folder unless JAMR_USER_DATA names one.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertLiveAllowed } from './lib/live-guard.mjs'

const root = resolve(import.meta.dirname, '..')
const live = process.argv.includes('--live')
const preview = process.argv.includes('--preview')

const env = { ...process.env }
let fake = null
if (live) {
  assertLiveAllowed(root, 'dev:live')
  console.log('dev: LIVE daemon - this run reads your real Jam account, and writes only what you do in it')
  env.JAMR_DAEMON = 'live'
  delete env.JAMR_DAEMON_ENDPOINT
} else {
  const { startFakeDaemon } = await import(new URL('../tests/fake-daemon/server.ts', import.meta.url).href)
  fake = await startFakeDaemon()
  env.JAMR_DAEMON_ENDPOINT = fake.endpoint
  delete env.JAMR_DAEMON
  console.log(`dev: fake daemon on ${fake.endpoint} (fixtures from tests/fake-daemon/fixtures)`)
}

const ownProfile = !env.JAMR_USER_DATA
if (ownProfile) env.JAMR_USER_DATA = mkdtempSync(join(tmpdir(), 'jamr-dev-'))

const bin = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
const child = spawn(join(root, 'node_modules', '.bin', bin), [preview ? 'preview' : 'dev'], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

const stop = async (code) => {
  await fake?.close()
  if (ownProfile) rmSync(env.JAMR_USER_DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  process.exit(code ?? 0)
}
child.on('exit', (code) => void stop(code))
process.on('SIGINT', () => child.kill())
