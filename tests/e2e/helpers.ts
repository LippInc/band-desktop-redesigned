import { execFileSync } from 'node:child_process'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { electronLaunchOptions, spawnArgs } from '../../scripts/lib/offstage.cjs'
import { startFakeDaemon, type FakeDaemon } from '../fake-daemon/server'

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

// Chromium pauses animations and throttles timers in windows it considers hidden or covered, so a test window behind other
// windows never finishes a dialog's exit animation. Browsers launched by Playwright get these
// switches by default; Electron launches do not.
export const CHROMIUM_SWITCHES = [
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
]

export interface AppOptions {
  /** A fake daemon to talk to; a fresh one is started (and stopped) when none is given. `null`: no daemon at all. */
  fake?: FakeDaemon | null
  env?: Record<string, string>
}

/**
 * Starts the built app (out/) on the given profile and the fake daemon, runs the body, and always closes both, even when an
 * assertion fails. Every e2e run talks to the fake daemon, never the live one. Playwright's Electron support
 * needs the nodeCliInspect fuse, which only packaged release builds turn off. On Windows the app runs offstage, on a
 * hidden desktop, so its windows never reach the screen (scripts/lib/offstage.cjs; OFFSTAGE=0 shows them).
 */
export async function withApp(
  userData: string,
  body: (app: ElectronApplication, page: Page, fake: FakeDaemon | null) => Promise<void>,
  options: AppOptions = {},
): Promise<void> {
  const ownFake = options.fake === undefined
  const fake = ownFake ? await startFakeDaemon() : options.fake
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('JAMR_')) env[key] = value
  }
  env.JAMR_USER_DATA = userData
  if (fake) env.JAMR_DAEMON_ENDPOINT = fake.endpoint
  Object.assign(env, options.env)
  const app = await electron.launch(electronLaunchOptions({ args: ['.', ...CHROMIUM_SWITCHES], env }))
  try {
    const page = await app.firstWindow()
    await page.getByRole('complementary', { name: 'Sidebar' }).waitFor({ state: 'attached' })
    await body(app, page, fake ?? null)
  } finally {
    await app.close()
    if (ownFake) await fake?.close()
  }
}

/**
 * Runs the body against an account without agents: none in the agent list, no work, and a stream that sends no inbox
 * (the fixtures' account has two agents at work, Atlas and Nova).
 */
export async function withAgentlessApp(
  userData: string,
  body: (app: ElectronApplication, page: Page, fake: FakeDaemon | null) => Promise<void>,
): Promise<void> {
  const fake = await startFakeDaemon({
    answers: {
      '/v1/agent-list': { list: { rows: [], remote: 'Fresh', org_name: null } },
      '/v1/roomWorkSnapshot': { snapshot: { boards: [], lanes: [] } },
    },
    events: [],
  })
  try {
    await withApp(userData, body, { fake })
  } finally {
    await fake.close()
  }
}

/** Sets the window's width (unmaximized), for the narrow and wide layouts. */
export async function setWindowWidth(app: ElectronApplication, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, next) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.unmaximize()
    win?.setSize(next, 820)
  }, width)
}

/** A point in the page, as a selector (the centre of what it finds) or CSS pixels. */
export type HitPoint = string | [number, number]

// Asks the window what a press at a screen point would hit (WM_NCHITTEST: 2 is the caption, 1 the page).
const HIT_TEST_TYPE = [
  "$ProgressPreference = 'SilentlyContinue'",
  'Add-Type -TypeDefinition @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class Hit {',
  '  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);',
  '  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);',
  '}',
  '"@',
  '[Hit]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null',
]

/**
 * What a real mouse press would reach at each point on Windows: `drag` where the window's drag region takes it, `page`
 * where the page gets it. Playwright's clicks bypass the system's hit test, so a button lying under a drag region still
 * "clicks" in every other test while a real mouse only drags the window; this asks Windows itself.
 */
export async function hitTest(app: ElectronApplication, page: Page, points: HitPoint[]): Promise<string[]> {
  const css = await Promise.all(
    points.map(async (point) => {
      if (typeof point !== 'string') return { x: point[0], y: point[1] }
      const box = await page.locator(point).boundingBox()
      if (!box) throw new Error(`Nothing to press at ${point}`)
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }),
  )
  const { handle, onScreen, desktop } = await app.evaluate(({ BrowserWindow, screen }, inPage) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No window')
    const bounds = win.getContentBounds()
    return {
      handle: win.getNativeWindowHandle().readBigUInt64LE(0).toString(),
      onScreen: inPage.map((point) => screen.dipToScreenPoint({ x: bounds.x + point.x, y: bounds.y + point.y })),
      desktop: process.env.OFFSTAGE_DESKTOP ?? '',
    }
  }, css)
  const presses = onScreen.map((point) => {
    const lParam = (Math.round(point.y) & 0xffff) * 0x10000 + (Math.round(point.x) & 0xffff)
    return `[Hit]::SendMessage([IntPtr][Int64]${handle}, 0x84, [IntPtr]::Zero, [IntPtr][Int64]${lParam}).ToInt64()`
  })
  const script = Buffer.from([...HIT_TEST_TYPE, ...presses].join('\n'), 'utf16le').toString('base64')
  const powershell = ['-NoProfile', '-NonInteractive', '-EncodedCommand', script]
  // An offstage window's handle reaches nothing from another desktop (it reads as an empty, hidden window there), so the
  // question is asked from the app's own desktop.
  const [file, args] = desktop ? spawnArgs('powershell.exe', powershell, { desktop }) : ['powershell.exe', powershell]
  const out = execFileSync(file, args, { encoding: 'utf8' })
  return out
    .trim()
    .split(/\r?\n/)
    .map((line) => ({ '1': 'page', '2': 'drag' })[line.trim()] ?? `hit ${line.trim()}`)
}
