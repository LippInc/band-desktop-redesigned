import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { DAEMON_OPERATION_NAMES } from '../../src/shared/daemon-api'
import { IPC, daemonChannel } from '../../src/shared/ipc-contract'
import { startFakeDaemon } from '../fake-daemon/server'
import { MOD, withAgentlessApp, withApp } from './helpers'

// Drives the built app (out/) through the real app:// protocol, preload bridge and daemon client, against the fake daemon.

const uiFontSize = (page: Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-font-size').trim())

/** The native window's own background colour, which the theme sets beside the page's. */
const windowColour = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBackgroundColor().toLowerCase())

test.describe.configure({ mode: 'serial' })

test.describe('app shell', () => {
  let userData = ''

  test.beforeAll(() => {
    userData = mkdtempSync(join(tmpdir(), 'jamr-e2e-'))
  })

  test.afterAll(() => {
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  })

  test('boots from app:// into a sandboxed window with only the typed bridge', async () => {
    await withApp(userData, async (app, page) => {
      expect(page.url()).toMatch(/^app:\/\/jam-redesign\/index\.html/)
      // The window is named as this app (the taskbar, Alt+Tab, a screen reader), never as the official one.
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())).toBe(
        'Jam Redesign',
      )
      expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined')
      expect(await page.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined')
      expect(await page.evaluate(() => Object.keys(window.jam ?? {}).toSorted())).toEqual([
        'app',
        'daemon',
        'files',
        'guide',
        'plan',
        'platform',
        'settings',
        'shell',
        'window',
      ])
      // The daemon surface is the named operations and nothing that takes a route (README, "What this app never does").
      expect(await page.evaluate(() => Object.keys(window.jam?.daemon ?? {}).toSorted())).toEqual(
        [...DAEMON_OPERATION_NAMES, 'getInbox', 'getStatus', 'onEvent', 'onStatus', 'reconnect'].toSorted(),
      )
      const renderers = await app.evaluate(({ app: electronApp }) =>
        electronApp
          .getAppMetrics()
          .filter((metric) => metric.type === 'Tab')
          .map((metric) => metric.sandboxed),
      )
      expect(renderers.length).toBeGreaterThan(0)
      expect(renderers.every((sandboxed) => sandboxed === true)).toBe(true)
      const csp = await page.evaluate(async () =>
        (await fetch('app://jam-redesign/index.html')).headers.get('content-security-policy'),
      )
      expect(csp).toContain("script-src 'self'")
      expect(csp).toContain("frame-src 'none'")
    })
  })

  test('the main process answers only the channels of the contract', async () => {
    await withApp(userData, async (app) => {
      // ipcMain keeps its handlers in a private map; reading it here pins the whole surface the page can invoke. Electron
      // registers its own internal channels there too, all named in capitals (IMPORT_SHARED_TEXTURE_..., Electron 44).
      const channels = await app.evaluate(({ ipcMain }) =>
        // oxlint-disable-next-line no-underscore-dangle -- Electron's private handler map is the only list there is
        [...((ipcMain as unknown as { _invokeHandlers: Map<string, unknown> })._invokeHandlers?.keys() ?? [])]
          .filter((channel) => !/^[A-Z0-9_]+$/.test(channel))
          .toSorted(),
      )
      const invokable = [
        IPC.appGetInfo,
        IPC.settingsGetAll,
        IPC.settingsUpdate,
        IPC.windowGetState,
        IPC.shellOpenExternal,
        IPC.guideRead,
        IPC.filesAct,
        IPC.filesVerify,
        IPC.planChoose,
        IPC.daemonGetStatus,
        IPC.daemonGetInbox,
        IPC.daemonReconnect,
        ...DAEMON_OPERATION_NAMES.map(daemonChannel),
      ].toSorted()
      expect(channels).toEqual(invokable)
    })
  })

  test('navigation, new windows and permissions are refused', async () => {
    await withApp(userData, async (app, page) => {
      // http is not handed to the system browser, so this must be denied outright and open nothing.
      expect(await page.evaluate(() => window.open('http://example.com/') === null)).toBe(true)
      expect(app.windows()).toHaveLength(1)
      await page.evaluate(() => {
        window.location.href = 'http://example.com/'
      })
      await page.waitForTimeout(500)
      expect(page.url()).toMatch(/^app:\/\/jam-redesign\//)
      expect(await page.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state)).toBe(
        'denied',
      )
      // Writing to the clipboard is the one permission the window is granted (Copy room id, a message's Copy), and
      // reading it back is not: what the page put there is the person's, and the page never takes anything from it.
      expect(
        await page.evaluate(() => navigator.clipboard.writeText('jam-redesign clipboard check').then(() => 'written')),
      ).toBe('written')
      expect(
        await page.evaluate(() =>
          navigator.clipboard
            .readText()
            .then(() => 'read')
            .catch(() => 'refused'),
        ),
      ).toBe('refused')
      // Links leave only as https or mailto, through the main process.
      await expect(
        page.evaluate(() => window.jam?.shell.openExternal('file:///C:/Windows/notepad.exe')),
      ).rejects.toThrow(/Only https and mailto/)
    })
  })

  test('shows the fake daemon account, and Inbox and Sessions follow their experiments', async () => {
    const fake = await startFakeDaemon()
    try {
      await withApp(
        userData,
        async (_app, page) => {
          await expect(page.getByRole('link', { name: /^Account: Sam Rivera/ })).toBeVisible()
          const primary = page.getByRole('navigation', { name: 'Primary' })
          await expect(primary.getByRole('link', { name: 'Home' })).toBeVisible()
          // Jam puts Inbox at the foot of its sidebar, above Documentation, and Sessions in an Advanced group of its
          // own after Network; neither is among the daily rows.
          const more = page.getByRole('navigation', { name: 'More sections' })
          await expect(page.getByRole('link', { name: /^Inbox/ })).toHaveCount(0)
          fake.setExperiment('inbox-section', 'enabled')
          fake.emit({ type: 'experiments.changed' })
          await expect(more.getByRole('link', { name: /^Inbox/ })).toBeVisible()
          await expect(primary.getByRole('link', { name: /^Inbox/ })).toHaveCount(0)
          await expect(page.getByRole('link', { name: 'Sessions' })).toHaveCount(0)
          fake.setExperiment('sessions-section', 'enabled')
          fake.emit({ type: 'experiments.changed' })
          await expect(
            page.getByRole('navigation', { name: 'Advanced' }).getByRole('link', { name: 'Sessions' }),
          ).toBeVisible()

          // Sonar's dot follows whether this computer is discoverable.
          const dot = page.getByRole('navigation', { name: 'Network' }).getByRole('img', { name: 'Discovery on' })
          await expect(dot).toBeVisible()
          fake.setAnswer('/v1/listDiscovered', { snapshot: { discoverable: false, users: [], multicast: 'ok' } })
          fake.emit({ type: 'discovery.changed' })
          await expect(dot).toHaveCount(0)
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test('says when the daemon is gone and connects again when it is back', async () => {
    const fake = await startFakeDaemon()
    try {
      await withApp(
        userData,
        async (_app, page) => {
          const banner = page.getByRole('alert', { name: 'Band connection' })
          await expect(banner).toHaveCount(0)
          await fake.pause()
          await page.evaluate(() => window.jam?.daemon.reconnect())
          await expect(banner).toContainText("Band isn't running")
          await fake.resume()
          await banner.getByRole('button', { name: 'Try again' }).click()
          await expect(banner).toHaveCount(0)
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test('an unpackaged run without a fake daemon talks to no daemon at all', async () => {
    await withApp(
      userData,
      async (_app, page) => {
        expect(await page.evaluate(() => window.jam?.daemon.getStatus())).toEqual({
          state: 'offline',
          reason: 'not-found',
        })
        await expect(page.getByRole('alert', { name: 'Band connection' })).toBeVisible()
        // Nothing was ever read, so the room list says it is unavailable rather than loading until Jam returns.
        await expect(page.getByLabel('Rooms', { exact: true })).toContainText('Rooms are unavailable')
        await expect(page.getByLabel('Rooms', { exact: true })).not.toContainText('Loading')
        // So do the experiments on Settings' own page.
        await page.evaluate(() => {
          location.hash = '#/settings/experiments'
        })
        await expect(page.locator('main h1')).toHaveText('Experiments')
        await expect(page.locator('main')).toContainText(
          'Experiments are unavailable right now. Experiments will show when Band is running again.',
        )
        await expect(page.locator('main')).not.toContainText('Loading experiments')
      },
      { fake: null },
    )
  })

  test('sidebar, palette and side pane respond to their shortcuts', async () => {
    await withApp(userData, async (_app, page) => {
      const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
      const sidePane = page.getByRole('complementary', { name: 'Side pane' })

      await expect(sidebar).toHaveAttribute('data-open', 'true')
      await page.keyboard.press(`${MOD}+b`)
      await expect(sidebar).toHaveAttribute('data-open', 'false')
      // Jam's own shortcut: b, when no field has focus.
      await page.locator('main').click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('b')
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      // ... and never while typing.
      await page.getByRole('textbox', { name: 'Describe the work' }).click()
      await page.keyboard.press('b')
      await expect(sidebar).toHaveAttribute('data-open', 'true')

      await page.keyboard.press(`${MOD}+k`)
      const palette = page.getByRole('dialog')
      await expect(palette).toBeVisible()
      // Typing as soon as the palette shows goes into it, never into the page behind it (a regression seen before). Typing
      // before it shows, on a cold start, is checked over forty launches, which one test cannot do.
      await page.keyboard.type('side pane')
      await expect(page.getByPlaceholder('Search sections, rooms, and actions')).toHaveValue('side pane')
      await page.keyboard.press('Enter')
      await expect(palette).toBeHidden()
      await expect(sidePane).toHaveAttribute('data-open', 'true')

      // A global shortcut pressed while the palette is open closes the palette first.
      await page.keyboard.press(`${MOD}+k`)
      await expect(palette).toBeVisible()
      await page.keyboard.press(`${MOD}+Alt+b`)
      await expect(palette).toBeHidden()
      await expect(sidePane).toHaveAttribute('data-open', 'false')

      // Back and forward walk the history, but never from inside a text field, where Alt+Left and Alt+Right move the
      // caret (by a word on macOS).
      const composer = page.getByRole('textbox', { name: 'Describe the work' })
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Agents' }).click()
      await expect(page.locator('main h1')).toHaveText('Agents')
      await page.locator('main').click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(composer).toBeVisible()
      await composer.click()
      await page.keyboard.press('Alt+ArrowRight')
      await page.waitForTimeout(400)
      await expect(composer).toBeVisible()
      await page.locator('main').click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('Alt+ArrowRight')
      await expect(page.locator('main h1')).toHaveText('Agents')
    })
  })

  test('keyboard focus shows a ring on a control; the mouse and a text field show none', async () => {
    // Without agents, Home's green Create an agent is there for the check on a filled control.
    await withAgentlessApp(userData, async (_app, page) => {
      const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
      await expect(sidebar.getByRole('link', { name: 'Agents' })).toBeVisible()
      const outline = () => page.evaluate(() => getComputedStyle(document.activeElement ?? document.body).outlineStyle)
      // The first stop from the top of the page is Jam's Toggle sidebar, first in the sidebar's top row, a button that
      // turns its outline off for the mouse.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press('Tab')
      await expect(sidebar.getByRole('button', { name: 'Toggle sidebar' })).toBeFocused()
      expect(await outline()).toBe('solid')
      await page.keyboard.press('Tab')
      expect(await outline()).toBe('solid')
      // A row chosen with the mouse keeps focus without a ring.
      await sidebar.getByRole('link', { name: 'Agents' }).click()
      await expect(sidebar.getByRole('link', { name: 'Agents' })).toBeFocused()
      expect(await outline()).toBe('none')
      // A text field shows its caret, not a ring.
      await page.keyboard.press(`${MOD}+k`)
      await expect(page.getByRole('combobox', { name: 'Search' })).toBeFocused()
      expect(await outline()).toBe('none')
      await page.keyboard.press('Escape')
      // A control filled with BAND's green takes the ring in the ink, which shows on the green in both themes. Its fade is
      // turned off first: the ring's colour fades in from the text's, the same ink, which a check could read mid-fade.
      await sidebar.getByRole('link', { name: /^Home/ }).click()
      const create = page.getByRole('link', { name: 'Create an agent' })
      await expect(create).toBeVisible()
      await create.evaluate((el) => {
        el.style.transition = 'none'
      })
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await create.focus()
      expect(await page.evaluate(() => document.activeElement?.matches(':focus-visible'))).toBe(true)
      // The style first: without the ring, the outline's colour falls back to the text's, the same ink.
      await expect(create).toHaveCSS('outline-style', 'solid')
      await expect(create).toHaveCSS('outline-color', 'rgb(0, 19, 25)')
    })
  })

  test("Teams: Band's cards, a team's members and guidelines, and New team and Edit team writing Band's draft", async () => {
    await withApp(userData, async (_app, page, fake) => {
      if (!fake) throw new Error('this test needs its own fake daemon')
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Teams' }).click()
      await expect(page.locator('main h1')).toHaveText('Teams')
      const cards = page.getByRole('list', { name: 'Teams' }).getByRole('listitem')
      await expect(cards).toHaveCount(2)
      await expect(cards.first()).toContainText('Atlas, Nova')
      await expect(cards.first()).toContainText('On your roster')
      await expect(cards.nth(1)).toContainText('1 of 2 on your roster')
      await expect(page.getByRole('button', { name: 'Browse Library' })).toBeDisabled()

      // Search teams looks through a team's name, its description and its agents.
      const search = page.getByRole('searchbox', { name: 'Search teams' })
      await search.fill('release')
      await expect(cards).toHaveCount(1)
      await search.fill('atlas')
      await expect(cards).toHaveCount(1)
      await expect(cards.first()).toContainText('Checkout crew')
      await search.fill('')
      await expect(cards).toHaveCount(2)

      // A team: its members on the roster and its guidelines; Edit team sends the whole draft with the team's id.
      await page.getByRole('button', { name: 'Open Checkout crew' }).click()
      await expect(page.locator('main h1')).toHaveText('Checkout crew')
      const members = page.getByRole('list', { name: 'Members' }).getByRole('listitem')
      await expect(members).toHaveCount(2)
      await expect(page.getByRole('main')).toContainText('Atlas drafts each step')
      // Band's Copy handle beside each member's handle; what it puts on the clipboard is caught on its way out.
      await page.evaluate(() => {
        const caught = window as unknown as { copied?: string }
        navigator.clipboard.writeText = async (text: string) => void (caught.copied = text)
      })
      await expect(members.getByRole('button', { name: 'Copy handle' })).toHaveCount(2)
      await members.first().getByRole('button', { name: 'Copy handle' }).click()
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { copied?: string }).copied))
        .toBe('sam-rivera/atlas')
      await expect(members.first().getByRole('button', { name: 'Copied' })).toBeVisible()
      await page.getByRole('button', { name: 'Edit team' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByLabel('Name')).toHaveValue('Checkout crew')
      await dialog.getByLabel('Description').fill('Ships the checkout, one reviewed step at a time.')
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(dialog).toHaveCount(0)
      const saved = fake.requests.filter((one) => one.route === '/v1/updateTeam').at(-1)
      expect(saved?.body).toEqual({
        profile: 'default',
        team_id: '5b8e2c4a-1f3d-4e6b-9a7c-0d2e4f6a8b1c',
        draft: {
          name: 'Checkout crew',
          description: 'Ships the checkout, one reviewed step at a time.',
          guidelines:
            'Atlas drafts each step and Nova builds it. Every change says why in one line, and nothing merges without a passing test.',
          agent_ids: ['7a1d3c5e-2b4f-4a6c-8e0d-1f3a5c7e9b21', '9c2e4a6f-8b1d-4e3a-a5c7-2d4f6b8e0a13'],
          role_ids: [],
        },
      })
      await expect(page.getByRole('main')).toContainText('Ships the checkout, one reviewed step at a time.')

      // New team holds its Create team back until it has a name and an agent, in Band's words for the agent.
      await page.getByRole('button', { name: 'Back to teams' }).click()
      await page.getByRole('button', { name: 'New team' }).click()
      const create = dialog.getByRole('button', { name: 'Create team' })
      await expect(create).toBeDisabled()
      await dialog.getByLabel('Name').fill('Docs crew')
      await expect(dialog).toContainText('Choose at least one agent for the team.')
      await expect(create).toBeDisabled()
      await dialog.getByRole('checkbox', { name: /Atlas/ }).click()
      await expect(create).toBeEnabled()
      // Band's refusal is said in its own words, without Electron's wrapping (invented words: no refusal of a whole
      // draft has been seen live).
      fake.failRoute('/v1/createTeam', 400, { error: 'A team named Docs crew already exists.' })
      await create.click()
      await expect(dialog.getByRole('alert')).toHaveText('A team named Docs crew already exists.')
      fake.setAnswer('/v1/createTeam', undefined)
      // A save on its way keeps the dialog open: Escape waits, and the team opens when Band has answered.
      fake.setLatency(1_500)
      await create.click()
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      await page.keyboard.press('Escape')
      // Past the dialog's own closing time and well before Band answers, it is still open.
      await page.waitForTimeout(600)
      expect(await dialog.count()).toBe(1)
      await expect(page.locator('main h1')).toHaveText('Docs crew')
      fake.setLatency(0)
      const made = fake.requests.filter((one) => one.route === '/v1/createTeam').at(-1)
      expect(made?.body).toEqual({
        profile: 'default',
        draft: {
          name: 'Docs crew',
          description: '',
          guidelines: '',
          agent_ids: ['7a1d3c5e-2b4f-4a6c-8e0d-1f3a5c7e9b21'],
          role_ids: [],
        },
      })
      await page.getByRole('button', { name: 'Back to teams' }).click()
      await expect(cards).toHaveCount(3)

      // A team from Band's Library: Edit team sends its roles back unchanged, and lists the agent the account does not
      // hold as Not on your roster, to keep or take out.
      await page.getByRole('button', { name: 'Open Release crew' }).click()
      await page.getByRole('button', { name: 'Edit team' }).click()
      const offRoster = dialog.getByRole('checkbox', { name: /Not on your roster/ })
      await expect(offRoster).toBeChecked()
      await offRoster.click()
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(dialog).toHaveCount(0)
      expect(fake.requests.filter((one) => one.route === '/v1/updateTeam').at(-1)?.body).toEqual({
        profile: 'default',
        team_id: 'c3f1a7e9-6d2b-4c8e-b0a4-7e9c1d3f5a20',
        draft: {
          name: 'Release crew',
          description: 'Prepares releases: a security review, the release notes and the release itself.',
          guidelines: '',
          agent_ids: ['9c2e4a6f-8b1d-4e3a-a5c7-2d4f6b8e0a13'],
          role_ids: ['security-reviewer', 'technical-writer', 'release-engineer'],
        },
      })
      await expect(page.getByRole('main')).toContainText('Members · On your roster')
    })
  })

  test('every Jam section is reachable from the sidebar', async () => {
    await withApp(userData, async (_app, page) => {
      for (const [nav, name] of [
        ['Primary', 'Agents'],
        ['Primary', 'Teams'],
        ['Network', 'Sonar'],
        ['Network', 'Contacts'],
      ] as const) {
        await page.getByRole('navigation', { name: nav }).getByRole('link', { name }).click()
        await expect(page.locator('main h1')).toHaveText(name)
      }
      // Documentation opens on the guide's own title, as Jam's does, not on its section's name.
      await page.getByRole('navigation', { name: 'More sections' }).getByRole('link', { name: 'Documentation' }).click()
      await expect(page.getByRole('navigation', { name: 'Guide contents' })).toBeVisible()
      await expect(page.locator('main h1')).not.toHaveText('Documentation')
      // Analytics opens straight into its tabs, as Jam's does, so it has no page title to check for.
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Analytics' }).click()
      await expect(page.getByRole('tab', { name: 'Activity' })).toBeVisible()
      await expect(page.locator('main h1')).toHaveCount(0)
      // Jam's dot beside Sonar: the fixture's computer is discoverable.
      await expect(
        page.getByRole('navigation', { name: 'Network' }).getByRole('img', { name: 'Discovery on' }),
      ).toBeVisible()
      await page.getByRole('link', { name: 'Settings', exact: true }).click()
      await expect(page.locator('main h1')).toHaveText('Account')
      await expect(page.getByRole('navigation', { name: 'Settings' })).toBeVisible()
    })
  })

  test("Appearance: Jam's themes and font sizes, the Jam theme on the window itself, kept across restarts", async () => {
    await withApp(userData, async (app, page) => {
      await page.keyboard.press(`${MOD}+Comma`)
      const settingsNav = page.getByRole('navigation', { name: 'Settings' })
      await settingsNav.getByRole('link', { name: 'Appearance' }).click()
      await expect(page.locator('main h1')).toHaveText('Appearance')
      // Jam's words, in its order, then the Jam theme. Dark first: from Dark to Jam, Electron's nativeTheme stays dark
      // and says nothing, so only the settings change itself can give the window Jam's colour.
      await page.getByRole('combobox', { name: 'Theme' }).click()
      await expect(page.getByRole('option')).toHaveText(['Light', 'Dark', 'Auto', 'Band'])
      await page.getByRole('option', { name: 'Dark' }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await expect.poll(() => windowColour(app)).toBe('#131313')
      await page.getByRole('combobox', { name: 'Theme' }).click()
      await page.getByRole('option', { name: 'Band' }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'jam')
      // The window's own colour follows, so no seam shows at start or behind the caption buttons.
      await expect.poll(() => windowColour(app)).toBe('#0c1217')
      // Jam's blue selection marks the page shown; the mark keeps BAND's green.
      await expect(page.locator('nav[aria-label=Settings] a[aria-current=page]')).toHaveCSS(
        'background-color',
        'rgb(27, 49, 69)',
      )
      // The mark is Band's mascot, in BAND's own green under every theme.
      await expect(page.locator('aside [data-slot=mark] svg stop').first()).toHaveCSS(
        'stop-color',
        'rgb(119, 232, 119)',
      )
      await page.getByRole('combobox', { name: 'App font size' }).click()
      await expect(page.getByRole('option')).toHaveText(['Small', 'Default', 'Large'])
      await page.getByRole('option', { name: 'Large' }).click()
      await expect.poll(() => uiFontSize(page)).toBe('16px')
    })

    await withApp(userData, async (app, page) => {
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'jam')
      expect(await uiFontSize(page)).toBe('16px')
      expect(await windowColour(app)).toBe('#0c1217')
      // Auto follows the system's light or dark, and the window leaves Jam's colour too.
      await page.evaluate(() => window.jam?.settings.update({ theme: 'system', uiFontSize: 14 }))
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'jam')
      await expect
        .poll(async () => {
          const dark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)
          return (await windowColour(app)) === (dark ? '#131313' : '#f6f9f9')
        })
        .toBe(true)
      // Back to the defaults (Dark), so the tests after this one see the app as it starts.
      await page.evaluate(() => window.jam?.settings.update({ theme: 'dark' }))
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await expect.poll(() => windowColour(app)).toBe('#131313')
    })
  })

  test("Home shows Jam's mascot, in BAND's own colours under every theme", async () => {
    await withApp(userData, async (_app, page) => {
      // Jam Desktop draws its mascot above "Assign work", 56 across (docs/DESIGN.md, "Anatomy").
      const mascot = page.locator('main section[aria-labelledby=assign-work] > svg')
      await expect(mascot).toHaveCount(1)
      const box = await mascot.boundingBox()
      const title = await page.locator('main h1').boundingBox()
      expect([Math.round(box?.width ?? Number.NaN), Math.round(box?.height ?? Number.NaN)]).toEqual([56, 56])
      expect((box?.y ?? Number.NaN) + (box?.height ?? 0)).toBeLessThanOrEqual(title?.y ?? Number.NaN)
      // It is BAND's own artwork, not this app's palette, so it keeps BAND's colours under every theme, as the mark does.
      for (const theme of ['dark', 'light', 'jam'] as const) {
        await page.evaluate((chosen) => window.jam?.settings.update({ theme: chosen }), theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(mascot.locator('stop').first()).toHaveCSS('stop-color', 'rgb(119, 232, 119)')
        await expect(mascot.locator('[class*=eye]').first()).toHaveCSS('fill', 'rgb(54, 239, 255)')
      }
      // Back to the theme the app starts in, for the tests after this one.
      await page.evaluate(() => window.jam?.settings.update({ theme: 'dark' }))
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    })
  })

  test('known-bad control: must FAIL when JAMR_KNOWN_BAD=1', async () => {
    test.skip(!process.env.JAMR_KNOWN_BAD, 'instrument check: run with JAMR_KNOWN_BAD=1 and expect this test to fail')
    await withApp(userData, async (_app, page) => {
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia', { timeout: 2_000 })
    })
  })
})
