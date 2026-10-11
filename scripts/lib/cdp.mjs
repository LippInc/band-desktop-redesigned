// cdp.mjs - the few Chrome DevTools Protocol calls the smoke scripts use to drive an Electron app started with
// --remote-debugging-port. Every call has a time limit, so a hung app fails a check instead of hanging it.
import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

export const json = async (port, path, timeoutMs = 5_000) =>
  (await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) })).json()

export function call(url, method, params = {}, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    let settled = false
    let timer
    const socket = new WebSocket(url)
    const settle = (message) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      resolve(message)
    }
    timer = setTimeout(() => settle({ error: { message: `no answer to ${method} within ${timeoutMs} ms` } }), timeoutMs)
    timer.unref()
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === 1) settle(message)
    })
    socket.addEventListener('error', () => settle({ error: { message: 'socket error' } }))
    socket.addEventListener('close', () => settle({ error: { message: 'connection closed' } }))
  })
}

/**
 * The app:// page of whatever app listens on `port`; null once `child` (when given) exits or `seconds` pass. A deadline,
 * not a count of tries: an app whose main process hangs (an error box, say) still accepts connections, and each try
 * would wait out its own time limit.
 */
export async function waitForAppPage(port, child = null, seconds = 20) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) return null
    try {
      const pages = await json(port, '/json/list', Math.min(5_000, Math.max(100, deadline - Date.now())))
      const page = pages.find((entry) => entry.type === 'page' && entry.url.startsWith('app://'))
      if (page) return page
    } catch {
      // not listening yet, or not answering
    }
    await sleep(250)
  }
  return null
}

/**
 * Evaluates `expression` in the page once the preload bridge exists. Returns its value, or { error } when it threw.
 * A page that is still loading can replace its execution context under the call, so that one error is retried.
 */
export async function evaluate(page, expression) {
  const wrapped = `(async () => { for (let i = 0; i < 50 && !window.jam; i++) await new Promise((r) => setTimeout(r, 100)); return ${expression} })()`
  for (let attempt = 1; ; attempt++) {
    const response = await call(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
      expression: wrapped,
      awaitPromise: true,
      returnByValue: true,
    })
    if (response.error && /context was destroyed|Cannot find context/i.test(response.error.message) && attempt < 20) {
      await sleep(250)
      continue
    }
    if (response.error) return { error: response.error.message }
    if (response.result?.exceptionDetails) {
      return { error: response.result.exceptionDetails.exception?.description ?? 'the expression threw' }
    }
    return response.result?.result?.value ?? null
  }
}

/** Closes whatever app listens on `port` the normal way, waits until it stops answering, then kills `child` if still there. */
export async function closeApp(port, child = null) {
  try {
    const { webSocketDebuggerUrl } = await json(port, '/json/version')
    void call(webSocketDebuggerUrl, 'Browser.close', {}, 10_000)
  } catch {
    // not listening
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await json(port, '/json/version')
    } catch {
      break
    }
    await sleep(250)
  }
  if (child && child.exitCode === null) {
    const exited = new Promise((done) => child.once('exit', done))
    await Promise.race([exited, sleep(3_000)])
    if (child.exitCode !== null) return
    // Its whole tree: on Windows, killing Electron's main process leaves its helpers holding the profile for a while.
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', timeout: 10_000 })
    else child.kill('SIGKILL')
    await Promise.race([exited, sleep(5_000)])
  }
}
