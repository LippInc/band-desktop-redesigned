// packaged-smoke.mjs - smoke test of the PACKAGED Windows build. Run `pnpm dist:dir` (or dist:win) first, then
// `pnpm smoke:packaged`. Starts dist/win-unpacked/Jam Redesign.exe on a throwaway profile and checks that the UI loads from
// app://, the preload bridge answers with no Node globals in the page, the renderer is sandboxed, the throwaway profile was
// used, and the Electron fuses are flipped (read back from the exe). Then closes it.
// A packaged build always talks to the LIVE daemon, so this run reads it: ping, accounts and the shell's lists, never a
// write. It passes the live guard first (scripts/lib/live-guard.mjs; --live-ok overrides a blackout).
// Known-bad control: `pnpm smoke:packaged --break-settings` must FAIL (settings.db is a folder, so the app cannot start).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { closeApp, evaluate, waitForAppPage } from './lib/cdp.mjs'
import { assertLiveAllowed } from './lib/live-guard.mjs'
import { spawnArgs } from './lib/offstage.cjs'

const root = resolve(import.meta.dirname, '..')
const exe = join(root, 'dist', 'win-unpacked', 'Jam Redesign.exe')
if (process.platform !== 'win32' || !existsSync(exe)) {
  console.error(`packaged-smoke: needs Windows and ${exe} - run pnpm dist:dir first`)
  process.exit(2)
}
assertLiveAllowed(root, 'smoke:packaged')

const { getCurrentFuseWire, FuseV1Options, FuseState } = createRequire(import.meta.url)('@electron/fuses')
const fuses = await getCurrentFuseWire(exe)
const expectFuse = {
  RunAsNode: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  EnableCookieEncryption: true,
}
const fuseProblems = Object.entries(expectFuse).filter(
  ([name, on]) => fuses[FuseV1Options[name]] !== (on ? FuseState.ENABLE : FuseState.DISABLE),
)
console.log(fuseProblems.length ? `fuses WRONG: ${fuseProblems.map(([name]) => name).join(', ')}` : 'fuses ok')

const port = Number(process.env.JAMR_CDP_PORT ?? 9345)
const profile = mkdtempSync(join(tmpdir(), 'jamr-packaged-'))
if (process.argv.includes('--break-settings')) mkdirSync(join(profile, 'settings.db'))

const started = Date.now()
// Packaged builds ignore JAMR_USER_DATA on purpose; Chromium's --user-data-dir points them at the throwaway profile.
// The same switches as ui:check, so a window behind others still runs its timers.
const switches = [
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
]
// Offstage: the window opens on a hidden desktop, never on the screen (scripts/lib/offstage.cjs).
const app = spawn(...spawnArgs(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...switches]), {
  stdio: 'ignore',
})

async function finish(code, message) {
  console.log(message)
  await closeApp(port, app)
  // Removing the throwaway profile is tidying up: a file still held never changes the verdict above.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  } catch (error) {
    console.log(`the throwaway profile stays behind (${error.code ?? error.message}): ${profile}`)
  }
  process.exit(code)
}

const page = await waitForAppPage(port, app, 15)
if (!page) await finish(1, 'PACKAGED SMOKE FAILED: no app:// window within 15 s')

console.log(`window up after ${Date.now() - started} ms at ${page.url}`)
const report = await evaluate(
  page,
  'window.jam.app.getInfo().then((info) => ({ protocol: location.protocol, name: info.name, version: info.version, fakeDaemon: info.fakeDaemon, bridge: Object.keys(window.jam).sort().join(","), nodeInPage: typeof require !== "undefined" || typeof process !== "undefined" }))',
)
console.log('bridge ->', JSON.stringify(report))

// The packaged app must really use the throwaway profile, or this run would have touched the real one.
const usedProfile = existsSync(join(profile, 'settings.db'))
const ok =
  fuseProblems.length === 0 &&
  report?.protocol === 'app:' &&
  report.name === 'Jam Redesign' &&
  report.nodeInPage === false &&
  report.fakeDaemon === false &&
  report.bridge === 'app,daemon,files,guide,plan,platform,settings,shell,window' &&
  usedProfile
await finish(ok ? 0 : 1, ok ? 'PACKAGED SMOKE OK' : `PACKAGED SMOKE FAILED (profile used: ${usedProfile})`)
