// ui-check.mjs - visual check of the BUILT app. Run `pnpm ui:check` (builds first) or `node scripts/ui-check.mjs [outDir] [steps]`.
// Starts the app on a throwaway profile with a maximized window, the FAKE daemon and a Chrome DevTools Protocol port, runs
// the steps in scripts/ui-check.steps.json, saves screenshots, closes the app and deletes the profile. Compare the PNGs
// with design/reference/zcode/ (the look) and design/reference/jam/ (nothing missing); docs/DESIGN.md says how.
// Raw CDP on purpose: a general-purpose browser-automation client hung when attached to this app's debug port.
// Step types: wait, shot, key, click and hover (CSS selector), cdp, eval, and fake ({"fake": "<method>", "args": [...]}) which calls
// the fake daemon (tests/fake-daemon/server.ts) between steps: flags on and off, a paused daemon, a changed answer.
// A wait is the longest the next step waits, not a sleep: an eval that only reads the page is tried until it passes once the
// page is quiet, an eval that acts and a click or hover wait for a quiet page (and their target), and a shot, key, cdp or
// fake step still waits it out in full, as does every step but a reading eval after a wait that follows a fake step: the
// app's answer to a daemon change can be work the page does not show yet (2026-09-23: a plan re-read the pane opened
// before). UI_CHECK_FIXED_WAITS=1 sleeps every wait in full, the old timing, to compare runs.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as sleep } from 'node:timers/promises'
import { spawnArgs } from './lib/offstage.cjs'

/**
 * The steps press the app's command key as Ctrl (CDP modifier 2). On macOS the app's command key is Cmd (Meta, 4), so
 * there Ctrl becomes Cmd.
 */
const commandKey = (modifiers) => (process.platform === 'darwin' && modifiers & 2 ? (modifiers & ~2) | 4 : modifiers)

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(process.argv[2] ?? join(root, 'design', 'reference', 'app'))
const stepsFile = resolve(process.argv[3] ?? join(root, 'scripts', 'ui-check.steps.json'))
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'))
const port = Number(process.env.JAMR_CDP_PORT ?? 9344)
const electronBinary = createRequire(import.meta.url)('electron')

mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'jamr-ui-'))

// A maximized window matches the ZCode references (captured maximized: 1440x899 CSS px at 200% scaling).
// Migration 1 of settings.db never changes (migrations are append-only), so seeding it here stays valid.
const seed = new DatabaseSync(join(profile, 'settings.db'))
seed.exec(
  'CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT; PRAGMA user_version = 1;',
)
seed
  .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
  .run(
    'internal.windowState',
    JSON.stringify({ bounds: { x: 120, y: 80, width: 1280, height: 820 }, maximized: true }),
    Date.now(),
  )
seed.close()

// Chromium pauses transitions and throttles timers in windows it thinks are hidden or covered; a check running behind other
// windows would then capture half-finished animations. These switches keep the window "visible".
const chromiumSwitches = [
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
]

const { startFakeDaemon } = await import(new URL('../tests/fake-daemon/server.ts', import.meta.url).href)
const fake = await startFakeDaemon()

// Offstage: on Windows the window opens on a hidden desktop, never on the screen (scripts/lib/offstage.cjs).
const app = spawn(...spawnArgs(electronBinary, ['.', `--remote-debugging-port=${port}`, ...chromiumSwitches]), {
  cwd: root,
  env: { ...process.env, JAMR_USER_DATA: profile, JAMR_DAEMON_ENDPOINT: fake.endpoint, JAMR_DAEMON: '' },
  stdio: 'ignore',
})

const cdpJson = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`)).json()

function connect(url) {
  return new Promise((resolveConnection, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    let nextId = 0
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    })
    socket.addEventListener('error', reject)
    socket.addEventListener('open', () =>
      resolveConnection({
        send: (method, params = {}, timeoutMs = 20_000) =>
          new Promise((settle) => {
            const id = ++nextId
            const timer = setTimeout(() => {
              pending.delete(id)
              settle({ error: { message: `timeout: ${method}` } })
            }, timeoutMs)
            pending.set(id, (message) => {
              clearTimeout(timer)
              settle(message)
            })
            socket.send(JSON.stringify({ id, method, params }))
          }),
        close: () => socket.close(),
      }),
    )
  })
}

const FIXED_WAITS = process.env.UI_CHECK_FIXED_WAITS === '1'
// How long nothing on the page may change (no DOM mutation, no finite animation running) before it counts as quiet.
const QUIET_MS = 100
// An eval matching this may change the page or record state for a later step, so it is never tried twice.
const ACTS =
  /\.(click|focus|blur|submit|requestSubmit|select|scrollIntoView|scrollTo|scrollBy|dispatchEvent|setAttribute|removeAttribute|toggleAttribute|remove|append|appendChild|prepend|insertBefore|insertAdjacentHTML|insertAdjacentElement|replaceWith|replaceChildren|play|pause|update|reconnect|open|close|showModal|show|hide|execCommand|setSelectionRange|setRangeText|emit|invoke|send|write|clear|reset|set|delete|add)\(|\.[\w$]+\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|\?\?|&&|\|\|)?=(?![=>])|\]\s*[-+*/]?=(?![=>])|\+\+|--|localStorage|sessionStorage/

const sleepUntil = async (until) => {
  if (until > Date.now()) await sleep(until - Date.now())
}

// Resolves once the page has been quiet for QUIET_MS, or at `until` if it never is (an infinite animation does not count).
async function untilQuiet(page, until) {
  const most = until - Date.now()
  if (most <= 0) return
  await page.send(
    'Runtime.evaluate',
    {
      expression: `new Promise((done) => {
        const start = performance.now()
        let last = start
        const observer = new MutationObserver(() => { last = performance.now() })
        observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
        const moving = () => document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity)
        const check = () => {
          const now = performance.now()
          if ((now - last >= ${QUIET_MS} && !moving()) || now - start >= ${most}) { observer.disconnect(); done(null) }
          else requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      })`,
      awaitPromise: true,
    },
    most + 5_000,
  )
}

const evaluate = (page, expression) =>
  page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
const failure = (result) => result.result?.exceptionDetails?.exception?.description ?? result.error?.message

// A reading eval after a wait: tried until it passes; the try at or after `until` (when the old sleep ended) is the verdict.
async function evaluateUntil(page, expression, until) {
  await untilQuiet(page, until)
  for (let tries = 1; ; tries++) {
    const result = await evaluate(page, expression)
    if (!failure(result)) {
      if (tries > 1) await untilQuiet(page, until)
      return result
    }
    if (Date.now() >= until) return result
    await sleep(50)
  }
}

// The centre of the first element matching a selector, looked for until `until` (0: once).
async function centreOf(page, selector, until) {
  for (;;) {
    const found = await evaluate(
      page,
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    const point = found.result?.result?.value
    if (point || Date.now() >= until) return point
    await sleep(50)
  }
}

async function shutdown(code) {
  try {
    const { webSocketDebuggerUrl } = await cdpJson('/json/version')
    const browser = await connect(webSocketDebuggerUrl)
    void browser.send('Browser.close', {}, 3_000)
    await Promise.race([new Promise((done) => app.once('exit', done)), sleep(8_000)])
  } catch {
    // the app is already gone
  }
  if (app.exitCode === null) app.kill()
  await fake.close()
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  process.exit(code)
}

let target
for (let attempt = 0; attempt < 60 && !target; attempt++) {
  try {
    target = (await cdpJson('/json/list')).find((entry) => entry.type === 'page' && entry.url.startsWith('app://'))
  } catch {
    // not listening yet
  }
  if (!target) await sleep(500)
}
if (!target) {
  console.error(`ui-check: no app:// page on CDP port ${port} after 30 s - run pnpm build first`)
  await shutdown(2)
}

const page = await connect(target.webSocketDebuggerUrl)
let failures = 0
// When the waits since the last other step run out, whether they follow a fake step, and how long the waits allowed in all.
let waitEnds = 0
let waitsPending = false
let waitAfterFake = false
let lastWasFake = false
let waitsAllowed = 0
const started = Date.now()

for (const [index, step] of steps.entries()) {
  const label = `#${index}`
  if (step.wait) {
    if (!waitsPending) waitAfterFake = lastWasFake
    waitsPending = true
    waitEnds = Math.max(waitEnds, Date.now()) + step.wait
    waitsAllowed += step.wait
    if (FIXED_WAITS) await sleepUntil(waitEnds)
    continue
  }
  const until = waitsPending ? waitEnds : 0
  const pending = until > Date.now()
  const reading = step.eval !== undefined && !ACTS.test(step.eval)
  waitsPending = false
  waitEnds = 0
  lastWasFake = Boolean(step.fake)
  if (pending && (step.fake || step.shot || step.key || step.cdp || (waitAfterFake && !reading)))
    await sleepUntil(until)
  if (step.fake) {
    try {
      await fake[step.fake](...(step.args ?? []))
      console.log(`${label} fake.${step.fake}(${(step.args ?? []).map((arg) => JSON.stringify(arg)).join(', ')})`)
    } catch (error) {
      failures++
      console.log(`${label} fake.${step.fake} FAILED: ${error.message}`)
    }
  } else if (step.shot) {
    const result = await page.send('Page.captureScreenshot', { format: 'png' }, 60_000)
    if (result.error) {
      failures++
      console.log(`${label} screenshot FAILED (${step.shot}): ${result.error.message}`)
    } else {
      writeFileSync(join(outDir, `${step.shot}.png`), Buffer.from(result.result.data, 'base64'))
      console.log(`${label} saved ${step.shot}.png`)
    }
  } else if (step.key) {
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', {
        type,
        key: step.key,
        code: step.code ?? step.key,
        windowsVirtualKeyCode: step.vk ?? 0,
        modifiers: commandKey(step.modifiers ?? 0),
      })
    }
  } else if (step.hover) {
    if (pending) await untilQuiet(page, until)
    const point = await centreOf(page, step.hover, pending ? until : 0)
    if (!point) {
      failures++
      console.log(`${label} hover FAILED: nothing matches ${step.hover}`)
      continue
    }
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' })
  } else if (step.click) {
    if (pending) await untilQuiet(page, until)
    const point = await centreOf(page, step.click, pending ? until : 0)
    if (!point) {
      failures++
      console.log(`${label} click FAILED: nothing matches ${step.click}`)
      continue
    }
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' })
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 })
    }
  } else if (step.cdp) {
    const result = await page.send(step.cdp, step.params ?? {})
    if (result.error) {
      failures++
      console.log(`${label} ${step.cdp} FAILED: ${result.error.message}`)
    }
  } else if (step.eval) {
    let result
    if (pending && reading) result = await evaluateUntil(page, step.eval, until)
    else {
      if (pending) await untilQuiet(page, until)
      result = await evaluate(page, step.eval)
    }
    const exception = failure(result)
    if (exception) {
      failures++
      console.log(`${label} eval FAILED: ${exception.slice(0, 300)}`)
    } else {
      console.log(`${label} eval: ${JSON.stringify(result.result?.result?.value)}`)
    }
  } else {
    failures++
    console.log(`${label} unknown step ${JSON.stringify(step)}`)
  }
}

page.close()
const timing = `${Math.round((Date.now() - started) / 1000)} s, waits allowed ${Math.round(waitsAllowed / 1000)} s${FIXED_WAITS ? ' and slept in full' : ''}`
console.log(
  failures
    ? `ui-check: ${failures} step(s) failed (${timing})`
    : `ui-check: ${steps.length} steps ok in ${timing}, screenshots in ${outDir}`,
)
await shutdown(failures ? 1 : 0)
