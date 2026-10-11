import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startFakeDaemon } from '../fake-daemon/server'
import { MOD, hitTest, setWindowWidth, withAgentlessApp, withApp } from './helpers'

// Home and Rooms on the fake daemon's rooms (shapes recorded from a room made for recording them, contents invented).

const CHECKOUT = '5b0f6c2e-8d1a-4c3b-9e7f-2a4d6b8c0e11'
/** The agent Nova's own participant id in that room's fixture, which Remove must name. */
const NOVA_ID = '9c2e4a6f-8b1d-4e3a-a5c7-2d4f6b8e0a13'
const RELEASE_NOTES = '8c2d4e6f-1a3b-4c5d-8e9f-0a1b2c3d4e5f'
const ATLAS = '7a1d3c5e-2b4f-4a6c-8e0d-1f3a5c7e9b21'

const sidePane = (page: Page) => page.getByRole('complementary', { name: 'Side pane' })
const openRoom = (page: Page, title: string) =>
  page
    .getByRole('complementary', { name: 'Sidebar' })
    .getByRole('link', { name: new RegExp(`^${title}`) })
    .click()

/** The stream's first event, the person's inbox, as the fake daemon sends it: a copy to change and send again. */
const inboxEvent = () =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fake-daemon/fixtures/events/inbox_snapshot.json'), 'utf8'))

const inTitleBar = (label: string) => `header button[aria-label="${label}"]`
const inDrawer = (label: string) => `aside[aria-label=Sidebar] button[aria-label="${label}"]`

/** Drops one browser File onto the composer card that owns the named textbox. */
const dropFile = (page: Page, textbox: string, name: string, contents: string, type = 'text/markdown') =>
  page.getByRole('textbox', { name: textbox }).evaluate(
    (field, file) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([file.contents], file.name, { type: file.type }))
      const target = field.parentElement
      if (!target) throw new Error('the composer has no drop target')
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    },
    { name, contents, type },
  )

/** Points 1 px inside each edge of a resize handle, halfway down the window, once its panel has stopped sliding. */
async function edges(page: Page, label: string): Promise<[number, number][]> {
  const handle = page.getByRole('separator', { name: label })
  // Still across two animation frames: a panel that has just opened slides for 200 ms.
  await expect
    .poll(async () => {
      const before = await handle.boundingBox()
      await page.evaluate(
        () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
      )
      const after = await handle.boundingBox()
      return before !== null && after !== null && before.x === after.x && before.width === after.width
    })
    .toBe(true)
  const box = await handle.boundingBox()
  if (!box) throw new Error(`no ${label}`)
  const { x, width } = box
  return [
    [x + 1, 400],
    [x + width - 1, 400],
  ]
}

/** The name of the resize handle a press at a point would reach in the page, or what it reaches instead. */
const separatorAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    (point) => {
      const found = document.elementFromPoint(point.x, point.y)
      return found?.closest('[role=separator]')?.getAttribute('aria-label') ?? found?.tagName ?? null
    },
    { x, y },
  )

/** Whether the first element the selector finds can take focus now (not inert, not hidden). */
const takesFocus = (page: Page, selector: string) =>
  page.evaluate((found) => {
    const element = document.querySelector<HTMLElement>(found)
    element?.focus()
    const took = element !== null && document.activeElement === element
    element?.blur()
    return took
  }, selector)

test.describe.configure({ mode: 'serial' })

test.describe('rooms', () => {
  let userData = ''

  test.beforeAll(() => {
    userData = mkdtempSync(join(tmpdir(), 'jamr-e2e-rooms-'))
  })

  test.afterAll(() => {
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  })

  test('lists the rooms newest first and opens one with its plan, participants and files', async () => {
    await withApp(userData, async (_app, page) => {
      const rows = page
        .getByRole('complementary', { name: 'Sidebar' })
        .locator('a[href*="/rooms/"] [data-slot=room-title]')
      await expect(rows).toHaveText([
        'New Session',
        'Checkout flow redesign',
        'Release notes for 2.4',
        'Flaky test triage',
      ])

      // A row carries what Jam Desktop's own room row carries: its people's avatars, and its newest moment's time.
      const checkout = page
        .getByRole('complementary', { name: 'Sidebar' })
        .getByRole('link', { name: /^Checkout flow redesign/ })
      await expect(checkout.getByRole('img', { name: 'Sam Rivera, Atlas, Nova' })).toBeVisible()
      await expect(checkout.locator('span').last()).toHaveText(/\d/)

      await openRoom(page, 'Checkout flow redesign')
      await expect(page.locator('header h1')).toHaveText('Checkout flow redesign')

      // Jam's header controls: the room's people with their count, which show the panel and hide it again.
      const header = page.locator('header')
      await expect(header.getByRole('button', { name: 'Show participants' })).toHaveText('3')
      await header.getByRole('button', { name: 'Show participants' }).click()
      await expect(sidePane(page).getByRole('tab', { name: /^Participants/ })).toHaveAttribute('aria-selected', 'true')
      await header.getByRole('button', { name: 'Hide participants' }).click()
      await expect(sidePane(page)).toBeHidden()

      // Room actions, in Jam's words. Open in Band waits for a room link of Band's, so it is shown turned off.
      await header.getByRole('button', { name: 'Room actions' }).click()
      await expect(page.getByRole('menuitem')).toHaveText(['Open in Band', 'Copy room id'])
      await expect(page.getByRole('menuitem', { name: 'Open in Band' })).toBeDisabled()
      // The window may write to the clipboard and never read it back (shell.spec.ts, "permissions are refused"), so
      // what Copy room id put there is caught on its way out.
      await page.evaluate(() => {
        const caught = window as unknown as { copied?: string }
        navigator.clipboard.writeText = async (text: string) => void (caught.copied = text)
      })
      await page.getByRole('menuitem', { name: 'Copy room id' }).click()
      await expect.poll(() => page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBe(CHECKOUT)
      const plan = page.getByRole('main').getByRole('region', { name: 'Plan' })
      await expect(plan).toContainText('Checkout plan')
      // Jam's views in Jam's order; this room has agents, so its conversation shows.
      await expect(page.getByRole('tablist', { name: 'Room views' }).getByRole('tab')).toHaveText(['Work', 'Chat'])
      await expect(page.getByRole('log', { name: 'Conversation' })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled()

      await plan.getByRole('button', { name: /View full plan/ }).click()
      const full = sidePane(page).getByRole('article', { name: 'Plan' })
      await expect(full.getByRole('heading', { name: 'Checkout plan', level: 2 })).toBeVisible()
      await expect(full.locator('table')).toBeVisible()

      await sidePane(page)
        .getByRole('tab', { name: /^Participants/ })
        .click()
      await expect(sidePane(page).getByRole('heading', { name: /^Users \(\d+\)$/ })).toBeVisible()
      await expect(sidePane(page).getByRole('list', { name: 'Participants' })).toContainText('Sam Rivera')
      await expect(sidePane(page).getByRole('heading', { name: 'Agents (2)' })).toBeVisible()
      await sidePane(page)
        .getByRole('tab', { name: /^Files/ })
        .click()
      await expect(sidePane(page).getByRole('list', { name: 'Files' }).getByRole('listitem')).toHaveCount(2)
      // Jam's own line under a file's name: who shared it, its age, then its size.
      await expect(sidePane(page).getByRole('list', { name: 'Files' }).getByRole('listitem').first()).toContainText(
        /^checkout-plan\.mdfrom You · .+ · 602 B$/,
      )

      // A room without a plan keeps the card so a file can be chosen there, and its plan panel says so too;
      // without an agent, Jam's words.
      await openRoom(page, 'Release notes for 2.4')
      await expect(page.locator('header h1')).toHaveText('Release notes for 2.4')
      await expect(page.getByRole('main')).toContainText('No agents in this chat')
      await expect(page.getByRole('main').getByRole('button', { name: 'Add an agent to get started.' })).toBeVisible()
      // With nobody else in the room to address, there is no one to send to: the composer says so.
      await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled()
      // Jam's filters show in an empty conversation too, the Sender menu listing the people in the room.
      await page.getByRole('main').getByRole('button', { name: 'Sender' }).click()
      await expect(page.getByRole('menuitemcheckbox')).toHaveText([/^Select all/, /^Sam Rivera\s*0$/])
      await page.keyboard.press('Escape')
      await expect(page.getByRole('main').getByRole('region', { name: 'Plan' })).toContainText('No plan yet.')
      await sidePane(page).getByRole('tab', { name: 'Plan' }).click()
      await expect(sidePane(page)).toContainText('No plan yet')

      // Work, from Home's link form: the room opens on its Work view.
      await page.evaluate((id) => (location.hash = `#/rooms/${id}?view=work`), RELEASE_NOTES)
      const views = page.getByRole('tablist', { name: 'Work views' }).getByRole('tab')
      await expect(views).toHaveText(['Tasks', 'Status', 'Agents', 'Shared'])
      await expect(views.nth(1)).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('main')).toContainText('No agent in this room yet.')
    })
  })

  test('shows a plan from the daemon as text: no raw HTML, no image, no link but https and mailto', async () => {
    const fake = await startFakeDaemon()
    try {
      const attack = [
        '# Plan',
        '<script>window.jamrPlanRan = true</script>',
        '<img src=x onerror="window.jamrPlanRan = true">',
        '![remote](https://example.com/tracker.png)',
        '[run](javascript:window.jamrPlanRan=true) [local](file:///C:/Windows/notepad.exe) [site](https://example.com/)',
      ].join('\n\n')
      fake.setRoomAnswer(CHECKOUT, '/v1/getRoomPlan', {
        plan: {
          chat_id: CHECKOUT,
          source: { label: 'Hostile plan', kind: 'markdown', snapshot: true },
          cache: { body: attack, content_type: 'markdown', fetched_at: 1, bytes: attack.length },
          last_error: '',
          live_source_state: 'snapshot',
          watch_error: '',
          overlay: { states: {}, focus: '' },
          updated_at: 1,
          doc_rev: 1,
        },
      })
      await withApp(
        userData,
        async (_app, page) => {
          await openRoom(page, 'Checkout flow redesign')
          await page
            .getByRole('main')
            .getByRole('button', { name: /View full plan/ })
            .click()
          const full = sidePane(page).getByRole('article', { name: 'Plan' })
          await expect(full.getByRole('heading', { name: 'Hostile plan' })).toBeVisible()
          for (const scope of [full, page.getByRole('main').getByRole('region', { name: 'Plan' })]) {
            await expect(scope.locator('script, img, iframe, [onerror]')).toHaveCount(0)
            await expect(scope.locator('a')).toHaveCount(1)
            await expect(scope.locator('a')).toHaveAttribute('href', 'https://example.com/')
          }
          await expect(full).toContainText('remote')
          expect(await page.evaluate(() => (window as { jamrPlanRan?: boolean }).jamrPlanRan ?? false)).toBe(false)
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test('a part that fails degrades only itself, and a room outside the list says so', async () => {
    const fake = await startFakeDaemon()
    try {
      fake.setRoomAnswer(CHECKOUT, '/v1/roomParticipants', { participants: 'changed' })
      await withApp(
        userData,
        async (_app, page) => {
          await openRoom(page, 'Checkout flow redesign')
          await page
            .getByRole('main')
            .getByRole('button', { name: /View full plan/ })
            .click()
          await expect(sidePane(page).getByRole('article', { name: 'Plan' })).toBeVisible()
          await sidePane(page)
            .getByRole('tab', { name: /^Participants/ })
            .click()
          await expect(sidePane(page)).toContainText('in a form this app does not know yet')

          await page.evaluate(() => (location.hash = '#/rooms/00000000-0000-4000-8000-000000000009'))
          await expect(page.getByRole('main')).toContainText('This room is not in your list.')
          await expect(page.locator('header h1')).toHaveCount(0)
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test('reads the rooms again when the daemon announces a new room list', async () => {
    const fake = await startFakeDaemon()
    try {
      await withApp(
        userData,
        async (_app, page) => {
          const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
          await expect(sidebar.getByRole('link', { name: /^Flaky test triage/ })).toBeVisible()
          fake.setAnswer('/v1/rooms', {
            rooms: [
              {
                id: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
                title: 'Onboarding copy',
                task_id: '',
                updated_at: new Date().toISOString(),
                last_message_at: null,
              },
            ],
          })
          // The event recorded on 2026-09-19, with invented content.
          fake.emit({ peer: 'human:default', kind: { kind: 'room_directory_snapshot', rooms: [] } })
          await expect(sidebar.getByRole('link', { name: /^Onboarding copy/ })).toBeVisible()
          await expect(sidebar.getByRole('link', { name: /^Flaky test triage/ })).toHaveCount(0)
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test("a room's row writes its time as Jam does: 'just now', then the clock", async () => {
    const fake = await startFakeDaemon()
    try {
      await withApp(
        userData,
        async (_app, page) => {
          const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
          const now = new Date()
          // Earlier today, at a single-digit hour: Jam pads the hour and writes am or pm in lower case.
          const earlier = new Date(now)
          earlier.setHours(9, 5, 0, 0)
          // A room read before that hour has come round today would read it as tomorrow's, so it stands one day back.
          if (earlier > now) earlier.setDate(earlier.getDate() - 1)
          const clock = earlier.toDateString() === now.toDateString() ? /^09:05 [ap]m$/ : /\d/
          fake.setAnswer('/v1/rooms', {
            rooms: [
              {
                id: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
                title: 'Spoke just now',
                task_id: '',
                updated_at: now.toISOString(),
                last_message_at: now.toISOString(),
              },
              {
                id: 'bb22cc33-dd44-4e55-8f66-001122334455',
                title: 'Spoke earlier today',
                task_id: '',
                updated_at: earlier.toISOString(),
                last_message_at: earlier.toISOString(),
              },
            ],
          })
          fake.emit({ peer: 'human:default', kind: { kind: 'room_directory_snapshot', rooms: [] } })
          const time = (title: string) =>
            sidebar
              .getByRole('link', { name: new RegExp(`^${title}`) })
              .locator('span')
              .last()
          await expect(time('Spoke just now')).toHaveText('just now')
          await expect(time('Spoke earlier today')).toHaveText(clock)
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test('Inbox: what waits across the rooms, in one list, and answered from there', async () => {
    const fake = await startFakeDaemon()
    try {
      await withApp(
        userData,
        async (_app, page) => {
          fake.setExperiment('inbox-section', 'enabled')
          fake.emit({ type: 'experiments.changed' })
          const inbox = page.getByRole('navigation', { name: 'More sections' }).getByRole('link', { name: /^Inbox/ })
          // Jam counts what waits beside the section's name.
          await expect(inbox).toContainText('3')
          await inbox.click()

          // The rows: the permission request, then the question, then the mention, as Home orders what waits. The
          // fourth button is the X on the mention's row, the only row Jam's quiet dismiss takes here.
          const rows = page.getByRole('main').getByRole('list', { name: 'Inbox' }).getByRole('button')
          await expect(rows).toHaveCount(4)
          await expect(rows.nth(0)).toContainText('Permission: Write')
          await expect(rows.nth(1)).toContainText('Which payment provider')
          // A row reads as Jam's rows read: the daemon writes a mention "@[[id]]", and the row carries neither.
          await expect(rows.nth(2)).toContainText('I read the current steps')
          await expect(rows.nth(2)).not.toContainText('@')

          // The item open beside the list is the first row; a permission request carries no Dismiss at all.
          const detail = page.getByRole('article', { name: 'Inbox item' })
          await expect(detail).toContainText('Permission requested by')
          // Jam's quiet dismiss is for a routine mention only: a request leaves when it is decided.
          await expect(detail.getByRole('button', { name: 'Dismiss' })).toHaveCount(0)
          await detail.getByRole('button', { name: 'Review' }).click()
          await expect(page.getByRole('dialog')).toContainText('wants to change files')
          await page.keyboard.press('Escape')

          // A question waiting on the person is answered from here, without its room being open.
          await rows.nth(1).click()
          await expect(detail).toContainText('Asked by')
          // The item's own Answer…, in the detail's header: the room's history under it has the question's card too.
          await detail
            .locator(':scope > header')
            .getByRole('button', { name: /^Answer/ })
            .click()
          const dialog = page.getByRole('dialog')
          await expect(dialog).toContainText('Which payment provider should the checkout use first?')
          await dialog.getByRole('button', { name: 'Stripe' }).click()
          await dialog.getByRole('button', { name: 'Send answer' }).click()
          await expect(dialog).toHaveCount(0)
          // The whole message, as the room's own answer is checked: the agent addressed by handle and by id, and the
          // code the question asked for.
          const sent = fake.requests.filter((request) => request.route === '/v1/roomSend').at(-1)
          expect(sent?.body).toEqual({
            profile: 'default',
            chat_id: CHECKOUT,
            content: '@sam-rivera/atlas Answer 7F3A21C9: Stripe',
            mentions: [ATLAS],
          })

          // A permission request is decided from Inbox too, without the room being open.
          await rows.nth(0).click()
          await detail.getByRole('button', { name: 'Review' }).click()
          await page.getByRole('dialog').getByRole('button', { name: 'Deny', exact: true }).click()
          await expect(page.getByRole('dialog')).toHaveCount(0)
          const decided = fake.requests.filter((request) => request.route === '/v1/decideRuntimePermission').at(-1)
          expect((decided?.body as { outcome?: string })?.outcome).toBe('deny_once')

          // A mention carries Jam's Dismiss, and it marks that one mention read and done. Only a mention does:
          // a question or a permission request leaves the inbox when it is answered or decided.
          await rows.nth(2).click()
          await detail.getByRole('button', { name: 'Dismiss' }).click()
          const dismissed = fake.requests.filter((request) => request.route === '/v1/setInboxItemState').at(-1)
          expect(dismissed?.body).toMatchObject({ profile: 'default', read: true, done: true })
          expect(typeof (dismissed?.body as { item_id?: unknown })?.item_id).toBe('string')

          // Jam's own control on the row itself (its capture: "Dismiss mention from <sender>"): the X sits on the
          // mention's row alone - never on a question that waits or a request - and takes the same write.
          const rowX = page.getByRole('list', { name: 'Inbox' }).getByRole('button', { name: 'Dismiss mention from' })
          await expect(rowX).toHaveCount(1)
          // The X has to make its own write: with the detail's dismiss already sent, a row that only looked right
          // would still pass on that earlier request alone.
          const wrote = fake.requests.filter((request) => request.route === '/v1/setInboxItemState').length
          await rowX.click()
          expect(fake.requests.filter((request) => request.route === '/v1/setInboxItemState').length).toBe(wrote + 1)
          const dismissedFromRow = fake.requests.filter((request) => request.route === '/v1/setInboxItemState').at(-1)
          expect(dismissedFromRow?.body).toMatchObject({ profile: 'default', read: true, done: true })
          expect((dismissedFromRow?.body as { item_id?: string })?.item_id).toBe(
            (dismissed?.body as { item_id?: string })?.item_id,
          )

          // View in room opens the room the item came from.
          await rows.nth(1).click()
          await detail.getByRole('button', { name: 'View in room' }).click()
          await expect(page.locator('header h1')).toHaveText('Checkout flow redesign')
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test("Inbox: the item's room context, and a reply sent to that room from there", async () => {
    const fake = await startFakeDaemon()
    try {
      await withApp(
        userData,
        async (app, page) => {
          // A short window: the reply stays docked at the foot of the detail, in reach, and the history alone scrolls.
          await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0]
            win?.unmaximize()
            win?.setSize(1440, 640)
          })
          // A file staged in the room's own composer stays with it: a reply from Inbox keeps its own.
          await openRoom(page, 'Checkout flow redesign')
          await dropFile(page, 'Message', 'room-only.md', '# Only for the room\n')
          await expect(page.getByRole('main').getByLabel('Attached files')).toContainText('room-only.md')
          fake.setExperiment('inbox-section', 'enabled')
          fake.emit({ type: 'experiments.changed' })
          await page
            .getByRole('navigation', { name: 'More sections' })
            .getByRole('link', { name: /^Inbox/ })
            .click()
          const detail = page.getByRole('article', { name: 'Inbox item' })
          await expect(detail).toContainText('Permission requested by')

          // Jam's "Conversation history": the room's own conversation under the item, question cards and all.
          const history = detail.getByRole('region', { name: 'Conversation history' })
          const log = history.getByRole('log', { name: 'Conversation' })
          await expect(log).toContainText('Starting on the confirmation screen.')
          await expect(log).toContainText('Which payment provider should the checkout use first?')
          // Every event shows, as Jam's history shows them: the room's tool calls and a turn's tasks among its messages,
          // which the room's own page opens without.
          await expect(log.locator('[data-event=tool_call]').first()).toBeVisible()
          await expect(log.locator('[data-event=task]').first()).toBeAttached()
          // Asked once the history has drawn, so an absence cannot pass before there is anything to look at.
          await expect(detail).not.toContainText('Open it with View in room')
          await expect(detail.getByRole('textbox', { name: 'Message' })).toBeVisible()
          await expect(detail.getByLabel('Attached files')).toHaveCount(0)
          const scroller = history.locator('[data-slot=room-scroll]')
          expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
          await expect
            .poll(() =>
              scroller.evaluate((element) =>
                Math.round(element.scrollHeight - element.clientHeight - element.scrollTop),
              ),
            )
            .toBeLessThanOrEqual(24)
          // The page itself does not scroll: the list and the history each scroll in their own place, and Reply... is on
          // screen without scrolling to it, as Jam docks its composer at the foot.
          const pageScroller = page.locator('main')
          expect(
            await pageScroller.evaluate((element) => element.scrollHeight - element.clientHeight),
          ).toBeLessThanOrEqual(1)
          await expect(detail.getByRole('textbox', { name: 'Message' })).toBeInViewport({ ratio: 1 })
          await expect(detail.getByRole('button', { name: 'Send' })).toBeInViewport({ ratio: 1 })

          // A question in the history is answered from here, as its row's Answer… would.
          await log
            .getByRole('button', { name: /^Answer/ })
            .first()
            .click()
          await expect(page.getByRole('dialog')).toContainText('Which payment provider should the checkout use first?')
          await page.keyboard.press('Escape')
          await expect(page.getByRole('dialog')).toHaveCount(0)

          // Jam's reply, "Reply...", sends to the item's room, addressed as the room's own composer addresses it.
          const box = detail.getByRole('textbox', { name: 'Message' })
          await expect(box).toHaveAttribute('placeholder', 'Reply...')
          await box.fill('Thanks ')
          await detail.getByRole('button', { name: 'Mention' }).click()
          await page.getByRole('menuitem', { name: 'Atlas' }).click()
          await expect(box).toHaveValue('Thanks @Atlas ')
          await expect(box).toBeFocused()
          const sendsBefore = fake.requests.filter((request) => request.route === '/v1/roomSend').length
          await box.press('Enter')
          await expect
            .poll(() => fake.requests.filter((request) => request.route === '/v1/roomSend').length)
            .toBe(sendsBefore + 1)
          expect(fake.requests.filter((request) => request.route === '/v1/roomSend').at(-1)?.body).toEqual({
            profile: 'default',
            chat_id: CHECKOUT,
            content: 'Thanks @sam-rivera/atlas',
            mentions: [ATLAS],
          })
          await expect(box).toHaveValue('')
          // The window is put back as it opened, so the tests after this one start from the same place.
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.maximize())
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test("a room's plan can be set and replaced from a file chosen on this computer", async () => {
    const fake = await startFakeDaemon()
    // The chooser checks the file is still there, so what the dialog is stubbed with must be a real one.
    const chosen = mkdtempSync(join(tmpdir(), 'jamr-e2e-plan-'))
    const chosenFile = join(chosen, 'e2e-plan.md')
    writeFileSync(chosenFile, '# The chosen plan\n')
    try {
      await withApp(
        userData,
        async (app, page) => {
          await openRoom(page, 'Checkout flow redesign')
          const card = page.locator('main section[aria-label=Plan]')
          await expect(card).toContainText('Checkout plan')

          // A native file dialog cannot be driven, so this answers for it in the main process - the one process
          // whose answer the plan's path may come from at all.
          const stubDialogWith = (path: string | null) =>
            app.evaluate(({ dialog }, pick) => {
              dialog.showOpenDialog = async () =>
                pick === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [pick] }
            }, path)
          const planWrites = () => fake.requests.filter((request) => request.route === '/v1/setPlan')
          // A room with a plan offers Jam Desktop's own words for replacing it, among its Plan actions.
          const actions = card.getByRole('button', { name: 'Plan actions' })
          const choose = async () => {
            await actions.click()
            await page.getByRole('menuitem', { name: 'Replace with another file…' }).click()
          }
          const replace = () => page.getByRole('dialog').getByRole('button', { name: 'Replace' })

          // Replacing a plan the room already has asks first, before any picker opens. Declined - by Cancel or by
          // Escape - it opens no picker and sends nothing, though a file is waiting in the stubbed dialog.
          await stubDialogWith(chosenFile)
          const confirm = page.getByRole('dialog')
          const before = planWrites().length
          await choose()
          await confirm.getByRole('button', { name: 'Cancel' }).click()
          await expect(confirm).toHaveCount(0)
          await choose()
          await expect(confirm).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(confirm).toHaveCount(0)
          await page.waitForTimeout(300)
          expect(planWrites().length).toBe(before)
          await choose()
          await expect(confirm).toContainText("Replace this room's plan?")
          await confirm.getByRole('button', { name: 'Replace' }).click()
          await expect(confirm).toHaveCount(0)
          await expect
            .poll(() => planWrites().at(-1)?.body)
            .toEqual({ profile: 'default', chat_id: CHECKOUT, source: chosenFile })
          // The room is read again, so the card shows the plan Jam now holds: its file's own name as the label.
          await expect(card).toContainText('e2e-plan.md')
          await expect(card).toContainText('The chosen plan')
          // It follows its file now (no snapshot), so Plan actions offers Refresh - turned off, as the write is not made.
          await actions.click()
          await expect(page.getByRole('menuitem', { name: 'Refresh' })).toBeDisabled()
          await page.keyboard.press('Escape')
          await expect(page.getByRole('menu')).toHaveCount(0)

          // A file of another kind is refused before anything is sent - counted, so a control that only looked
          // right could not ride the write above.
          await stubDialogWith(join(chosen, 'notes.txt'))
          const wrote = planWrites().length
          await choose()
          await replace().click()
          await expect(card.getByRole('status')).toContainText('Choose a Markdown')
          expect(planWrites().length).toBe(wrote)

          // A typed path to a file that is gone is this computer's fact, and is not blamed on Jam.
          await stubDialogWith(join(chosen, 'was-here.md'))
          await choose()
          await replace().click()
          await expect(card.getByRole('status')).toContainText('no longer there')
          expect(planWrites().length).toBe(wrote)

          // A dialog closed without choosing sends nothing and says nothing. The count is read only after the
          // choosing has settled (Plan actions takes its enable back), so a late write could not slip past it.
          await stubDialogWith(null)
          await choose()
          await replace().click()
          await expect(actions).toBeEnabled()
          // Focus comes back to Plan actions once the picker has closed.
          await expect(actions).toBeFocused()
          expect(planWrites().length).toBe(wrote)
          await expect(card.getByRole('status')).toHaveCount(0)

          // The Plan tab's own Plan actions say their own refusal, and the card says nothing about it.
          const planPane = page.locator('aside[aria-label="Side pane"]')
          if (!(await planPane.isVisible()))
            await page.locator('header button[aria-label="Show the plan & diagram"]').click()
          await planPane.locator('[data-panel=plan]').click()
          await stubDialogWith(join(chosen, 'notes.txt'))
          await planPane.getByRole('button', { name: 'Plan actions' }).click()
          await page.getByRole('menuitem', { name: 'Replace with another file…' }).click()
          await replace().click()
          await expect(planPane.getByRole('status')).toContainText('Choose a Markdown')
          await expect(card.getByRole('status')).toHaveCount(0)
          expect(planWrites().length).toBe(wrote)

          // The bridge takes an account profile and a room id and nothing else: a malformed one is refused before any
          // dialog, and a path the page adds is ignored - the plan is the file the dialog answered.
          const choose2 = (input: unknown) =>
            page.evaluate(
              (value) =>
                (window as unknown as { jam: { plan: { choose(i: unknown): Promise<unknown> } } }).jam.plan
                  .choose(value)
                  .then(
                    () => 'answered',
                    () => 'refused',
                  ),
              input,
            )
          const writesNow = planWrites().length
          expect(await choose2({ profile: 'not a profile!', roomId: CHECKOUT })).toBe('refused')
          expect(await choose2({ profile: 'default', roomId: 'not-a-room' })).toBe('refused')
          expect(planWrites().length).toBe(writesNow)
          await stubDialogWith(chosenFile)
          expect(
            await choose2({ profile: 'default', roomId: CHECKOUT, source: join(chosen, 'from-the-page.md') }),
          ).toBe('answered')
          await expect.poll(() => planWrites().length).toBe(writesNow + 1)
          expect(planWrites().at(-1)?.body).toEqual({ profile: 'default', chat_id: CHECKOUT, source: chosenFile })

          // A room without a plan keeps its card and offers the choosing from its Plan tab too. There is nothing
          // to replace, so the picker opens at once: no ask comes first, and the Plan tab owns its own refusal.
          await openRoom(page, 'Release notes for 2.4')
          await expect(card).toContainText('No plan yet.')
          const pane = page.locator('aside[aria-label="Side pane"]')
          if (!(await pane.isVisible()))
            await page.locator('header button[aria-label="Show the plan & diagram"]').click()
          await pane.locator('[data-panel=plan]').click()
          await stubDialogWith(join(chosen, 'notes.txt'))
          const writesBefore = planWrites().length
          await pane.getByRole('button', { name: 'Choose file…' }).click()
          await expect(pane.getByRole('status')).toContainText('Choose a Markdown')
          expect(planWrites().length).toBe(writesBefore)

          await stubDialogWith(chosenFile)
          await card.getByRole('button', { name: 'Choose file…' }).click()
          await expect(page.getByRole('dialog')).toHaveCount(0)
          await expect
            .poll(() => planWrites().at(-1)?.body)
            .toEqual({ profile: 'default', chat_id: RELEASE_NOTES, source: chosenFile })
          await expect(card).toContainText('e2e-plan.md')
          // The room's first plan swaps Choose file… for Plan actions, and the focus goes to what is there now.
          await expect(card.getByRole('button', { name: 'Plan actions' })).toBeFocused()
        },
        { fake },
      )
    } finally {
      await fake.close()
      rmSync(chosen, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    }
  })

  test("Jam's Plan actions: Replace, Remove turned off, and the terminal lines with Copy command", async () => {
    const fake = await startFakeDaemon()
    const commands = [`band plan diagram ${CHECKOUT} < arch.json`, `band plan set ${CHECKOUT} ./plan.md`]
    try {
      await withApp(
        userData,
        async (_app, page) => {
          await openRoom(page, 'Checkout flow redesign')
          const card = page.locator('main section[aria-label=Plan]')
          await expect(card).toContainText('Checkout plan')
          await card.getByRole('button', { name: 'Plan actions' }).click()
          const menu = page.getByRole('menu')
          await expect(menu.getByRole('menuitem', { name: 'Replace with another file…' })).toBeEnabled()
          // This room's plan is a snapshot: there is no file to refresh, so no Refresh. Asked only once the menu has
          // drawn its items, or a count of none would pass before there was anything to count.
          await expect(menu.getByRole('menuitem', { name: 'Refresh' })).toHaveCount(0)
          // This app does not make the write that removes a plan, so it is shown turned off.
          await expect(menu.getByRole('menuitem', { name: 'Remove from this room' })).toBeDisabled()
          await expect(menu).toContainText('Or attach from the terminal')
          for (const line of commands) await expect(menu.locator('pre[data-commands]')).toContainText(line)

          // The window may write to the clipboard and never read it back, so what Copy command put there is caught
          // on its way out. The menu stays open and says it copied.
          await page.evaluate(() => {
            const caught = window as unknown as { copied?: string }
            navigator.clipboard.writeText = async (text: string) => void (caught.copied = text)
          })
          await menu.getByRole('menuitem', { name: 'Copy command' }).click()
          await expect
            .poll(() => page.evaluate(() => (window as unknown as { copied?: string }).copied))
            .toBe(commands.join('\n'))
          await expect(menu.getByRole('menuitem', { name: 'Copied' })).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(menu).toHaveCount(0)

          // The same actions sit in the Plan tab's header.
          const pane = page.locator('aside[aria-label="Side pane"]')
          if (!(await pane.isVisible()))
            await page.locator('header button[aria-label="Show the plan & diagram"]').click()
          await pane.locator('[data-panel=plan]').click()
          await pane.getByRole('button', { name: 'Plan actions' }).click()
          await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Remove from this room' })).toBeDisabled()
          await page.keyboard.press('Escape')
          await expect(page.getByRole('menu')).toHaveCount(0)

          // Opening and copying wrote nothing.
          expect(
            fake.requests.filter((request) => /^\/v1\/(setPlan|clearPlan|refreshPlan)$/.test(request.route)),
          ).toEqual([])
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test('a staged room file can be removed, then is stored and sent by its id', async () => {
    const fake = await startFakeDaemon()
    const contents = '# Checkout notes\n'
    const encoded = Buffer.from(contents).toString('base64')
    const artifactId = `art-${createHash('sha256').update(encoded).digest('hex').slice(0, 24)}`
    try {
      await withApp(
        userData,
        async (_app, page) => {
          await openRoom(page, 'Checkout flow redesign')
          const main = page.getByRole('main')
          const box = main.getByRole('textbox', { name: 'Message' })

          await dropFile(page, 'Message', 'notes.md', contents)
          const staged = main.getByLabel('Attached files')
          await expect(staged).toContainText('notes.md')
          await expect(staged.getByRole('button', { name: 'Remove notes.md' })).toBeVisible()
          await staged.getByRole('button', { name: 'Remove notes.md' }).click()
          await expect(staged).toHaveCount(0)

          await dropFile(page, 'Message', 'notes.md', contents)
          await expect(main.getByLabel('Attached files')).toContainText('notes.md')
          await box.fill('Use the attached notes ')
          await main.getByRole('button', { name: 'Mention' }).click()
          await page.getByRole('menuitem', { name: 'Atlas' }).click()
          const storesBefore = fake.requests.filter((request) => request.route === '/v1/artifactStore').length
          const sendsBefore = fake.requests.filter((request) => request.route === '/v1/roomSend').length
          await main.getByRole('button', { name: 'Send', exact: true }).click()

          await expect
            .poll(() => fake.requests.filter((request) => request.route === '/v1/artifactStore').length)
            .toBe(storesBefore + 1)
          expect(fake.requests.filter((request) => request.route === '/v1/artifactStore').at(-1)?.body).toEqual({
            profile: 'default',
            chat_id: CHECKOUT,
            source: { kind: 'bytes', value: encoded },
            name: 'notes.md',
            created_by: '',
            mime: 'text/markdown',
          })
          await expect
            .poll(() => fake.requests.filter((request) => request.route === '/v1/roomSend').length)
            .toBe(sendsBefore + 1)
          expect(fake.requests.filter((request) => request.route === '/v1/roomSend').at(-1)?.body).toEqual({
            profile: 'default',
            chat_id: CHECKOUT,
            content: 'Use the attached notes @sam-rivera/atlas',
            mentions: [ATLAS],
            attachment_ids: [artifactId],
          })
          await expect(main.getByLabel('Attached files')).toHaveCount(0)
          await expect(box).toHaveValue('')
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test("the room composer's files: Attach files, paste, the Work view, a refused store and its retry", async () => {
    const fake = await startFakeDaemon()
    const count = (route: string) => fake.requests.filter((request) => request.route === route).length
    try {
      await withApp(
        userData,
        async (_app, page) => {
          await openRoom(page, 'Checkout flow redesign')
          const main = page.getByRole('main')
          const box = main.getByRole('textbox', { name: 'Message' })
          const staged = main.getByLabel('Attached files')

          // Jam's room composer offers Attach files beside Mention; it opens the system's file picker.
          await expect(main.getByRole('button', { name: 'Attach files' })).toBeEnabled()
          await main
            .locator('input[type=file]')
            .setInputFiles({ name: 'picked.md', mimeType: 'text/markdown', buffer: Buffer.from('# Picked\n') })
          await expect(staged).toContainText('picked.md')

          // A pasted file stages; a paste that also carries text is left alone, so the text is what lands.
          const pasted = await box.evaluate((field) => {
            const paste = (withText: boolean) => {
              const transfer = new DataTransfer()
              transfer.items.add(new File(['shot'], 'shot.png', { type: 'image/png' }))
              if (withText) transfer.setData('text/plain', 'A1 B1')
              const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
              field.dispatchEvent(event)
              return event.defaultPrevented
            }
            return { fileOnly: paste(false), withText: paste(true) }
          })
          expect(pasted).toEqual({ fileOnly: true, withText: false })
          await expect(staged.getByRole('button', { name: 'Remove shot.png', exact: true })).toHaveCount(1)

          // A drag carrying files is taken, so the drop lands in the composer instead of opening the file.
          const taken = await box.evaluate((field) => {
            const transfer = new DataTransfer()
            transfer.items.add(new File(['x'], 'x.md'))
            const event = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer })
            field.parentElement?.dispatchEvent(event)
            return event.defaultPrevented
          })
          expect(taken).toBe(true)

          // The Work view takes the composer off the screen; its files are there again when Chat comes back.
          await main.getByRole('tab', { name: 'Work', exact: true }).click()
          await main.getByRole('tab', { name: 'Chat', exact: true }).click()
          await expect(staged).toContainText('picked.md')

          // A store the daemon refuses stops the send, names the file, and keeps the draft and the files.
          fake.removeRoute('/v1/artifactStore')
          await box.fill('Use these ')
          await main.getByRole('button', { name: 'Mention' }).click()
          await page.getByRole('menuitem', { name: 'Atlas' }).click()
          const sendsBefore = count('/v1/roomSend')
          await main.getByRole('button', { name: 'Send', exact: true }).click()
          await expect(main.getByRole('alert')).toContainText('“picked.md” could not be attached')
          expect(count('/v1/roomSend')).toBe(sendsBefore)
          await expect(staged).toContainText('picked.md')
          await expect(box).toHaveValue(/^Use these @Atlas/)

          // Tried again once the store answers: each file is stored once and the message carries both.
          fake.setAnswer('/v1/artifactStore', undefined)
          const storesBefore = count('/v1/artifactStore')
          await main.getByRole('button', { name: 'Send', exact: true }).click()
          await expect.poll(() => count('/v1/roomSend')).toBe(sendsBefore + 1)
          expect(count('/v1/artifactStore')).toBe(storesBefore + 2)
          const sent = fake.requests.filter((request) => request.route === '/v1/roomSend').at(-1)?.body as {
            attachment_ids?: string[]
          }
          expect(sent.attachment_ids).toHaveLength(2)
          await expect(staged).toHaveCount(0)
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test('the palette lists the rooms and opens the one chosen', async () => {
    await withApp(userData, async (_app, page) => {
      // Once the app has loaded, as a person would: a key pressed in its first moments can come before its shortcuts exist.
      await expect(
        page.getByRole('complementary', { name: 'Sidebar' }).getByRole('link', { name: /^Flaky/ }),
      ).toBeVisible()
      await page.keyboard.press(`${MOD}+k`)
      const palette = page.getByRole('dialog')
      await expect(palette.getByRole('combobox', { name: 'Search' })).toBeFocused()
      await expect(palette.getByRole('option', { name: 'Flaky test triage' })).toBeVisible()
      await page.keyboard.type('Checkout flow')
      // Enter chooses the highlighted row: wait until the filter has made it the room (Enter can outrun the last key).
      await expect(palette.getByRole('option', { name: 'Checkout flow redesign' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await page.keyboard.press('Enter')
      await expect(page.locator('header h1')).toHaveText('Checkout flow redesign')
      await expect(palette).toHaveCount(0)
      // The next opening starts afresh: an empty search, and "All".
      await page.keyboard.press(`${MOD}+k`)
      await expect(page.getByPlaceholder('Search sections, rooms, and actions')).toHaveValue('')
      await expect(palette.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    })
  })

  test('a narrow window lays the room list over the page as a drawer, as Jam does', async () => {
    await withApp(userData, async (app, page) => {
      const sidebar = page.locator('aside[aria-label=Sidebar]')
      const main = page.locator('section[aria-label=Main]')
      const titleBarMark = page.locator('header button[aria-label="Toggle sidebar"]')
      const myRooms = sidebar.getByRole('button', { name: 'Rooms', exact: true })
      await expect(sidebar.getByRole('link', { name: /^Flaky/ })).toBeVisible()
      // A section folded beside the page stays folded when the sidebar moves over it.
      await myRooms.click()
      await expect(myRooms).toHaveAttribute('aria-expanded', 'false')
      await setWindowWidth(app, 700)
      await expect(sidebar).toHaveAttribute('data-drawer', 'true')
      await expect(sidebar).toHaveAttribute('data-open', 'false')
      // Jam's Toggle sidebar and history move to the title bar; the closed drawer's rows take no focus.
      await expect(titleBarMark).toBeVisible()
      expect(await takesFocus(page, 'aside[aria-label=Sidebar] a')).toBe(false)

      // Opening it moves focus into it and puts the page behind out of reach.
      await page.keyboard.press(`${MOD}+b`)
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      await expect(sidebar).toBeFocused()
      await expect(main).toHaveAttribute('inert', '')
      expect(await takesFocus(page, 'aside[aria-label=Sidebar] a')).toBe(true)
      await expect(myRooms).toHaveAttribute('aria-expanded', 'false')
      await myRooms.click()

      // Escape closes only what is on top: the palette opened over the drawer, and the drawer stays.
      await page.keyboard.press(`${MOD}+k`)
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(sidebar).toHaveAttribute('data-open', 'true')

      // Choosing a room shows it behind the drawer, which stays open until it is closed (user guide: "Select a room, then
      // close the drawer with Hide rooms or the backdrop").
      await sidebar.getByRole('link', { name: /^Checkout flow redesign/ }).click()
      await expect(page.locator('header h1')).toHaveText('Checkout flow redesign')
      await expect(sidebar).toHaveAttribute('data-open', 'true')

      // Hide rooms, the backdrop and Escape close it, and the page is in reach again. Nothing had focus when it opened,
      // so focus goes to the title bar's Toggle sidebar, which opens it.
      await sidebar.getByRole('button', { name: 'Hide rooms' }).click()
      await expect(sidebar).toHaveAttribute('data-open', 'false')
      await expect(main).not.toHaveAttribute('inert')
      await expect(titleBarMark).toBeFocused()
      await page.keyboard.press(`${MOD}+b`)
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      await page.mouse.click(650, 400)
      await expect(sidebar).toHaveAttribute('data-open', 'false')
      // Opened from the title bar's Toggle sidebar, it gives focus back to it when it closes.
      await titleBarMark.click()
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      await page.keyboard.press('Escape')
      await expect(sidebar).toHaveAttribute('data-open', 'false')
      await expect(titleBarMark).toBeFocused()
      // Opened from a field on the page (Ctrl+B works in one), it gives focus back to that field.
      await page.locator('header button[aria-label="Assign work"]').click()
      const describe = page.getByRole('textbox', { name: 'Describe the work' })
      await describe.focus()
      await page.keyboard.press(`${MOD}+b`)
      await expect(sidebar).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(sidebar).toHaveAttribute('data-open', 'false')
      await expect(describe).toBeFocused()

      // A wide window closes it: the sidebar is back beside the page as it was, and narrowing again leaves it closed.
      await page.keyboard.press(`${MOD}+b`)
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      await setWindowWidth(app, 1280)
      await expect(sidebar).not.toHaveAttribute('data-drawer', 'true')
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      await setWindowWidth(app, 700)
      await expect(sidebar).toHaveAttribute('data-drawer', 'true')
      await expect(sidebar).toHaveAttribute('data-open', 'false')
      await setWindowWidth(app, 1280)
    })
  })

  test('opened from the keyboard, the drawer takes focus without a ring of its own', async () => {
    await withApp(userData, async (app, page) => {
      const sidebar = page.locator('aside[aria-label=Sidebar]')
      await expect(sidebar.getByRole('link', { name: /^Flaky/ })).toBeVisible()
      await setWindowWidth(app, 700)
      await expect(sidebar).toHaveAttribute('data-drawer', 'true')
      // Keyboard focus on a control first, so the focus moved into the drawer counts as keyboard focus too.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement?.matches(':focus-visible'))).toBe(true)
      await page.keyboard.press(`${MOD}+b`)
      await expect(sidebar).toBeFocused()
      expect(await page.evaluate(() => document.activeElement?.matches(':focus-visible'))).toBe(true)
      await expect(sidebar).toHaveCSS('outline-style', 'none')
      await page.keyboard.press('Escape')
      await expect(sidebar).toHaveAttribute('data-open', 'false')
      // Focus that fell to the page's body (a focused row that went away) still lets Escape close it.
      await page.keyboard.press(`${MOD}+b`)
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press('Escape')
      await expect(sidebar).toHaveAttribute('data-open', 'false')
      await setWindowWidth(app, 1280)
    })
  })

  test("Jam's Toggle sidebar folds the sidebar to Jam's rail of sections, and opens it again", async () => {
    await withApp(userData, async (_app, page) => {
      const sidebar = page.locator('aside[aria-label=Sidebar]')
      const toggles = sidebar.getByRole('button', { name: 'Toggle sidebar' })
      await expect(sidebar.getByRole('link', { name: /^Flaky/ })).toBeVisible()
      const openToggle = page.locator('aside[aria-label=Sidebar] > div:first-child button[aria-label="Toggle sidebar"]')
      const railToggle = sidebar.locator('[data-slot=rail] button[aria-label="Toggle sidebar"]')
      // Open, Jam's button comes first in the top row, the only control of that name: the mark is the brand. Folded from
      // it by the keyboard, focus follows to the rail's toggle, where the same control now is.
      await expect(toggles).toHaveCount(1)
      const openAt = (await openToggle.boundingBox())?.x ?? Number.NaN
      await openToggle.focus()
      await page.keyboard.press('Enter')
      await expect(sidebar).toHaveAttribute('data-open', 'false')
      await expect(sidebar).toHaveAttribute('data-rail', 'true')
      await expect(railToggle).toBeFocused()
      await expect(toggles).toHaveCount(1)
      // The toggle stays at one place, open or folded, as Jam's does.
      expect(Math.abs(((await railToggle.boundingBox())?.x ?? Number.NaN) - openAt)).toBeLessThanOrEqual(4)

      // Folded, the rail names every section in Jam's order (Search, this app's, after Home); the sidebar's rows behind
      // it take no focus, the rail's do.
      const rail = sidebar.getByRole('navigation', { name: 'Sections' })
      await expect(rail.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
      expect(await rail.locator('a, button').evaluateAll((items) => items.map((item) => item.ariaLabel))).toEqual([
        'Home',
        'Search',
        'Agents',
        'Teams',
        'Rooms',
        'Analytics',
        'Sonar',
        'Contacts',
        'Documentation',
        'Settings',
      ])
      await expect(rail.getByRole('img', { name: 'Discovery on' })).toBeVisible()
      // Nothing behind the rail takes focus: every link and button of the folded sidebar, its top row included.
      const behind = await page.evaluate(() => {
        const controls = [
          ...document.querySelectorAll<HTMLElement>('aside[aria-label=Sidebar] > div:first-child :is(a, button)'),
        ]
        const focusable = controls.filter((control) => {
          control.focus()
          const took = document.activeElement === control
          control.blur()
          return took
        })
        return { controls: controls.length, focusable: focusable.length }
      })
      expect(behind.controls).toBeGreaterThan(10)
      expect(behind.focusable).toBe(0)
      expect(await takesFocus(page, 'aside[aria-label=Sidebar] nav[aria-label=Sections] a')).toBe(true)
      // Beside the rail the title bar holds history and Assign work, and no second toggle.
      await expect(page.locator(inTitleBar('Go back'))).toBeVisible()
      await expect(page.locator(inTitleBar('Assign work'))).toBeVisible()
      await expect(page.locator(inTitleBar('Toggle sidebar'))).toHaveCount(0)

      // A section opens from the rail, which marks it as the page shown; Agents in Jam Desktop's words.
      await rail.getByRole('link', { name: 'Agents' }).click()
      await expect(page.locator('main h1')).toHaveText('Agents')
      await expect(rail.getByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('main').getByRole('button', { name: 'New agent' })).toBeVisible()
      await expect(page.getByRole('main').getByRole('button', { name: 'Manage' })).toHaveCount(0)
      await expect(
        page.getByRole('main').getByRole('region', { name: 'Band Hosted' }).getByRole('listitem'),
      ).toHaveCount(2)
      // Rooms opens the sidebar, where the room list lives; folded again, the rail's own toggle opens it too.
      await rail.getByRole('button', { name: 'Rooms' }).click()
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      await expect(sidebar.getByRole('link', { name: /^Flaky/ })).toBeVisible()
      await expect(toggles).toHaveCount(1)
      await toggles.click()
      await expect(sidebar).toHaveAttribute('data-rail', 'true')
      await expect(toggles).toHaveCount(1)
      // Opened from the rail's toggle by the keyboard, focus follows back to the top row's.
      await expect(railToggle).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      await expect(openToggle).toBeFocused()
    })
  })

  test('a real mouse press reaches the drawer and its backdrop, not the window drag region beneath them', async () => {
    test.skip(process.platform !== 'win32', 'asks Windows what a press would hit')
    await withApp(userData, async (app, page) => {
      const sidebar = page.locator('aside[aria-label=Sidebar]')
      await expect(sidebar.getByRole('link', { name: /^Flaky/ })).toBeVisible()
      // Wide: a press anywhere on a resize handle reaches it, both edges of it, in the title bar's height too; Windows
      // must let the page have the press, and the page must give it to the handle, not to what lies beside it.
      const expandSidePane = page.locator('header button[aria-label="Expand side pane"]')
      const openedSidePane = (await expandSidePane.count()) > 0
      if (openedSidePane) await expandSidePane.click()
      const sidebarHandle = await edges(page, 'Resize sidebar')
      const sidePaneHandle = await edges(page, 'Resize side pane')
      await expect
        .poll(() => hitTest(app, page, [...sidebarHandle.map(([x]): [number, number] => [x, 24]), ...sidebarHandle]))
        .toEqual(['page', 'page', 'page', 'page'])
      for (const [x, y] of [...sidebarHandle, ...sidebarHandle.map(([at]): [number, number] => [at, 24])]) {
        expect(await separatorAt(page, x, y), `the press at ${x},${y}`).toBe('Resize sidebar')
      }
      for (const [x, y] of sidePaneHandle) {
        expect(await separatorAt(page, x, y), `the press at ${x},${y}`).toBe('Resize side pane')
      }
      if (openedSidePane) await page.locator('header button[aria-label="Collapse side pane"]').click()
      // Jam's Toggle sidebar takes a real press first in the sidebar's top row, whose empty part drags the window;
      // folded, the rail's toggle does the same in the rail's top row.
      const openToggle = 'aside[aria-label=Sidebar] > div:first-child button[aria-label="Toggle sidebar"]'
      const railToggle = 'aside[aria-label=Sidebar] [data-slot=rail] button[aria-label="Toggle sidebar"]'
      await expect.poll(() => hitTest(app, page, [openToggle, [150, 24]])).toEqual(['page', 'drag'])
      await page.locator(openToggle).click()
      await expect(sidebar).toHaveAttribute('data-rail', 'true')
      await expect.poll(() => hitTest(app, page, [railToggle, [44, 24], [400, 24]])).toEqual(['page', 'drag', 'drag'])
      await page.locator(railToggle).click()
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      // At the window's minimum height (520) the room list scrolls, and its scrollbar's thumb still takes a press: the
      // handle is narrow enough to stay clear of it.
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        win?.unmaximize()
        win?.setSize(1280, 520)
      })
      await expect
        .poll(() =>
          page.evaluate(() => {
            const list = document.querySelector<HTMLElement>('aside [aria-label=Rooms]')
            if (!list || list.scrollHeight <= list.clientHeight) return 'no scrollbar'
            const box = list.getBoundingClientRect()
            // The thumb is the middle 4 px of a 10 px scrollbar (globals.css); aim at its right-hand pixel.
            const hit = document.elementFromPoint(box.right - 4, box.y + box.height / 2)
            return hit === list
              ? 'scrollbar'
              : (hit?.closest('[role=separator]')?.getAttribute('aria-label') ?? hit?.tagName)
          }),
        )
        .toBe('scrollbar')
      await setWindowWidth(app, 1280)
      await setWindowWidth(app, 700)
      await expect(sidebar).toHaveAttribute('data-drawer', 'true')
      // The empty title bar drags the window, so the check can see a drag region; its buttons take presses.
      await expect
        .poll(() => hitTest(app, page, [[400, 24], inTitleBar('Toggle sidebar'), inTitleBar('Assign work')]))
        .toEqual(['drag', 'page', 'page'])

      // Open, the drawer's buttons and the backdrop over the title bar take presses; its top row's empty part drags.
      await page.keyboard.press(`${MOD}+b`)
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      const hideRooms = 'aside[aria-label=Sidebar] button:text-is("Hide rooms")'
      await expect
        .poll(() =>
          hitTest(app, page, [inDrawer('Toggle sidebar'), inDrawer('Go back'), hideRooms, [400, 24], [150, 24]]),
        )
        .toEqual(['page', 'page', 'page', 'page', 'drag'])

      // Closed, it leaves nothing behind over the title bar.
      await page.keyboard.press('Escape')
      await expect(sidebar).toHaveAttribute('data-open', 'false')
      await expect.poll(() => hitTest(app, page, [inTitleBar('Assign work'), [220, 24]])).toEqual(['page', 'drag'])
      await setWindowWidth(app, 1280)
    })
  })

  test('Home: Enter opens the agent control and keeps the draft; Shift+Enter adds a line', async () => {
    await withAgentlessApp(userData, async (_app, page) => {
      // Jam's "Assign work" where ZCode greets you, and no attach button (Jam's Home takes a pasted or dropped file).
      await expect(page.locator('main h1')).toHaveText('Assign work')
      await expect(page.getByRole('main').getByRole('button', { name: 'Attach files' })).toHaveCount(0)
      // Jam's agent control says "Agent" and is named "Choose an agent".
      await expect(page.getByRole('main').getByRole('button', { name: 'Choose an agent' })).toContainText('Agent')
      // With no recent agent there is no Quick picks group, empty or not. Counted in the page, not by role: an empty
      // group laid out with `display: contents` has no box, so a role query calls it hidden and never counts it.
      await expect(page.locator('main [role=group][aria-label="Quick picks"]')).toHaveCount(0)
      const describe = page.getByRole('textbox', { name: 'Describe the work' })
      await describe.fill('Fix the flaky test')
      await describe.press('Shift+Enter')
      await describe.pressSequentially('then ship it')
      await expect(describe).toHaveValue('Fix the flaky test\nthen ship it')
      await describe.press('Enter')
      await expect(page.getByRole('menuitem', { name: 'Create an agent…' })).toBeVisible()
      await expect(describe).toHaveValue('Fix the flaky test\nthen ship it')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('main')).toContainText('All clear')
      // Jam keeps Recent rooms on Home without agents, empty in its own words.
      await expect(page.getByRole('main')).toContainText('No rooms yet. Assigning work creates the first one.')
      // Agents without agents: Jam's own line, New Jam Agent, and no Manage.
      await page.evaluate(() => (location.hash = '#/agents'))
      await expect(page.getByRole('main')).toContainText('No agents yet. Create one to see it here.')
      await expect(page.getByRole('main').getByRole('region', { name: 'Band Hosted' })).toHaveCount(0)
      await expect(page.getByRole('main').getByRole('button', { name: 'New agent' })).toBeVisible()
      await expect(page.getByRole('main').getByRole('button', { name: 'Manage' })).toHaveCount(0)
    })
  })

  test('Home stages a file unbound and assigns it by the stored id', async () => {
    const fake = await startFakeDaemon()
    const contents = '# Assignment notes\n'
    const encoded = Buffer.from(contents).toString('base64')
    const artifactId = `art-${createHash('sha256').update(encoded).digest('hex').slice(0, 24)}`
    try {
      await withApp(
        userData,
        async (_app, page) => {
          await page.evaluate(() => (location.hash = '#/'))
          const main = page.getByRole('main')
          const box = main.getByRole('textbox', { name: 'Describe the work' })
          await expect(main.getByRole('button', { name: 'Choose an agent' })).toContainText('Atlas')
          // The recent agents' chips sit in the group Jam names Quick picks, every chip inside it.
          const chips = main.locator('section[aria-labelledby=assign-work] button[aria-pressed]')
          await expect(chips).not.toHaveCount(0)
          await expect(main.getByRole('group', { name: 'Quick picks' }).locator('button[aria-pressed]')).toHaveCount(
            await chips.count(),
          )

          await dropFile(page, 'Describe the work', 'brief.md', contents)
          await expect(main.getByLabel('Attached files')).toContainText('brief.md')
          await box.fill('Review the attached brief')
          const storesBefore = fake.requests.filter((request) => request.route === '/v1/artifactStore').length
          const assignmentsBefore = fake.requests.filter((request) => request.route === '/v1/kickoffWork').length
          await main.getByRole('button', { name: 'Assign work' }).click()

          await expect
            .poll(() => fake.requests.filter((request) => request.route === '/v1/artifactStore').length)
            .toBe(storesBefore + 1)
          expect(fake.requests.filter((request) => request.route === '/v1/artifactStore').at(-1)?.body).toEqual({
            profile: 'default',
            chat_id: '',
            source: { kind: 'bytes', value: encoded },
            name: 'brief.md',
            created_by: '',
            mime: 'text/markdown',
          })
          await expect
            .poll(() => fake.requests.filter((request) => request.route === '/v1/kickoffWork').length)
            .toBe(assignmentsBefore + 1)
          expect(fake.requests.filter((request) => request.route === '/v1/kickoffWork').at(-1)?.body).toEqual({
            profile: 'default',
            agent: { profile: 'default', scope: 'atlas', handle: 'sam-rivera/atlas' },
            message: 'Review the attached brief',
            artifact_ids: [artifactId],
          })
          await expect(main.getByLabel('Attached files')).toHaveCount(0)
          await expect(box).toHaveValue('')
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })

  test('a room with agents: the conversation, a question, a permission request and the work, as Jam shows them', async () => {
    const fake = await startFakeDaemon()
    try {
      await withApp(
        userData,
        async (_app, page) => {
          // Home: what waits on the person, approvals first; the agents' open work by room; the rooms they work in.
          const attention = page.getByRole('list', { name: 'Needs attention' })
          await expect(attention.getByRole('link')).toHaveText([
            /Checkout flow redesign\s*Waiting for your approval/,
            /Checkout flow redesign\s*An agent asked a question/,
          ])
          const active = page.getByRole('region', { name: 'Checkout flow redesign' })
          await expect(active.getByRole('button', { name: 'Checkout flow redesign (4)' })).toBeVisible()
          await expect(active.getByRole('link').first()).toContainText('In progress')
          await expect(page.getByRole('list', { name: 'Recent rooms' })).toContainText('Checkout flow redesign')

          await attention.getByRole('link', { name: /Waiting for your approval/ }).click()
          const main = page.getByRole('main')
          const log = main.getByRole('log', { name: 'Conversation' })
          // Jam's default filter: messages, errors and system events; the tool calls and turns are counted, not shown.
          await expect(log).toContainText('Atlas joined the conversation')
          await expect(log).toContainText('Starting on the confirmation screen.')
          await expect(log.locator('[data-event=tool_call]')).toHaveCount(0)
          await expect(log.locator('[data-mention=self]').first()).toHaveText('@Sam Rivera')
          await main.getByRole('button', { name: 'Event type' }).click()
          await expect(page.getByRole('menuitemcheckbox', { name: /^Tool calls/ })).toContainText('4')
          await page.getByRole('menuitemcheckbox', { name: /^Tool calls/ }).click()
          await page.keyboard.press('Escape')
          await expect(log.locator('[data-event=tool_call]')).toHaveCount(4)
          // Jam's own control on a tool row: View full JSON opens the whole call under the row, as text, and closes it.
          const read = log.locator('[data-event=tool_call]').first()
          await read.getByRole('button', { name: 'View full JSON' }).click()
          await expect(read.getByRole('button', { name: 'View full JSON' })).toHaveAttribute('aria-expanded', 'true')
          await expect(read.locator('pre[data-full=json]')).toContainText('"file_path": "src/checkout/steps.ts"')
          await read.getByRole('button', { name: 'View full JSON' }).click()
          await expect(read.locator('pre[data-full=json]')).toHaveCount(0)
          // Find looks through a tool call's whole JSON; the row it goes to opens, so the words can be read where it lands.
          await main.getByRole('button', { name: 'Find in conversation' }).click()
          const find = main.getByRole('combobox', { name: 'Find in conversation' })
          await find.fill('toolu_a1')
          await find.press('Enter')
          await expect(read.locator('pre[data-full=json]')).toContainText('"tool_call_id": "toolu_a1"')
          // ...with the words it found marked where they are said.
          await expect(read.locator('pre[data-full=json] mark')).toHaveText(['toolu_a1'])
          await page.keyboard.press('Escape')
          // Jam's Sender menu: Select all, then every participant with a count; a sender turned off leaves the log.
          await main.getByRole('button', { name: 'Sender' }).click()
          await expect(page.getByRole('menuitemcheckbox')).toHaveText([/^Select all/, /^Sam Rivera/, /^Atlas/, /^Nova/])
          await page.getByRole('menuitemcheckbox', { name: /^Nova/ }).click()
          await expect(log).not.toContainText('Starting on the confirmation screen.')
          await page.getByRole('menuitemcheckbox', { name: /^Select all/ }).click()
          await expect(log).toContainText('Starting on the confirmation screen.')
          await page.keyboard.press('Escape')
          // A menu closed with Escape can still be on the page while it animates out; a second menu opened then made
          // "Select all" match twice (2026-09-23, 1 run in 6).
          await expect(page.getByRole('menu')).toHaveCount(0)
          // A long message folds under Jam's Show full message, and Collapse message folds it again.
          await log.getByRole('button', { name: 'Show full message' }).click()
          await log.getByRole('button', { name: 'Collapse message' }).click()
          await expect(log.getByRole('button', { name: 'Show full message' })).toBeVisible()
          // Filters that show nothing, then Show all events: back at the end, a new message is followed.
          await main.getByRole('button', { name: 'Event type' }).click()
          await page.getByRole('menuitemcheckbox', { name: /^Select all/ }).click()
          await page.getByRole('menuitemcheckbox', { name: /^Select all/ }).click()
          await page.keyboard.press('Escape')
          await expect(main).toContainText('No events match the filters.')
          await main.getByRole('button', { name: 'Show all events' }).click()
          await expect(log).toBeVisible()
          await main
            .locator('[data-slot=room-scroll]')
            .evaluate((element) => (element.scrollTop = element.scrollHeight))
          const snapshot = JSON.parse(
            readFileSync(
              join(process.cwd(), `tests/fake-daemon/fixtures/room/${CHECKOUT}/roomMessageSnapshot.json`),
              'utf8',
            ),
          )
          const last = snapshot.snapshot.messages.at(-1)
          snapshot.snapshot.messages.push({
            ...last,
            id: 'a9000000-0000-4000-8000-000000000001',
            content: 'The confirmation screen is ready for a look.',
            message_type: 'text',
            inserted_at: '2026-09-19T11:40:00.000000Z',
            mention_names: {},
          })
          fake.setRoomAnswer(CHECKOUT, '/v1/roomMessageSnapshot', snapshot)
          fake.emit({ peer: 'human/default', kind: { kind: 'room_message' } })
          await expect(log.getByText('The confirmation screen is ready for a look.')).toBeInViewport()

          // The question: the card without the answer instruction, and Jam's answer dialog.
          const question = log.locator('[data-question=open]')
          await expect(question).toContainText('Which payment provider should the checkout use first?')
          await expect(question).not.toContainText('Reply with')
          await question.getByRole('button', { name: 'Answer…' }).click()
          const answer = page.getByRole('dialog', { name: 'Answer Atlas' })
          await expect(answer.getByRole('button', { name: 'Stripe' })).toBeVisible()
          await expect(answer.getByRole('button', { name: 'Send answer' })).toBeDisabled()
          await answer.getByRole('button', { name: 'Cancel' }).click()
          await expect(answer).toHaveCount(0)

          // The permission request: Jam's banner and its review dialog, with the complete operation.
          const banner = main.getByRole('region', { name: 'Permission requests' })
          await expect(banner).toContainText('sam-rivera/nova wants to change files · 1 request')
          // As in Jam, only the conversation scrolls: at its end the banner and the views are still in view.
          const scroller = main.locator('[data-slot=room-scroll]')
          await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
          expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
          await expect(banner).toBeInViewport({ ratio: 1 })
          await expect(main.getByRole('tablist', { name: 'Room views' })).toBeInViewport({ ratio: 1 })
          await expect(page.getByRole('textbox', { name: 'Message' })).toBeInViewport({ ratio: 1 })
          await expect(page.getByRole('status', { name: /^Waiting for permission, 2 agents$/ })).toBeVisible()
          await banner.getByRole('button', { name: 'Review' }).click()
          const review = page.getByRole('dialog', { name: 'sam-rivera/nova wants to change files' })
          await expect(review.getByLabel('Full operation')).toContainText('/work/nova/src/checkout/confirmation.tsx')
          await expect(review.getByRole('button', { name: 'Deny always' })).toBeVisible()
          await expect(review.getByRole('button', { name: 'Allow once' })).toBeEnabled()
          // It opens on the operation, not on Deny always: Enter pressed as it opens decides nothing.
          await expect(review.getByLabel('Full operation')).toBeFocused()
          const decisionsBefore = fake.requests.filter(
            (request) => request.route === '/v1/decideRuntimePermission',
          ).length
          await page.keyboard.press('Enter')
          // A decision would close the dialog once its write came back; nothing is sent, so it stays.
          await page.waitForTimeout(400)
          await expect(review).toBeVisible()
          expect(fake.requests.filter((request) => request.route === '/v1/decideRuntimePermission').length).toBe(
            decisionsBefore,
          )
          await page.keyboard.press('Escape')
          await expect(review).toHaveCount(0)
          // An operation the provider cut cannot be allowed, as Jam's guide says: Allow once is off, and the dialog says why.
          const cut = inboxEvent()
          cut.kind.snapshot.pending_permissions[0].record.request.display_truncated = true
          fake.emit(cut)
          await banner.getByRole('button', { name: 'Review' }).click()
          await expect(review.getByRole('button', { name: 'Allow once' })).toBeDisabled()
          await expect(review).toContainText('did not show this operation in full')
          await expect(review.getByRole('button', { name: 'Deny', exact: true })).toBeEnabled()
          await page.keyboard.press('Escape')
          await expect(review).toHaveCount(0)
          // An inbox in a form this app does not know: the banner goes and the room says why, never an older inbox.
          fake.emit({
            peer: 'human/default',
            kind: { kind: 'inbox_snapshot', profile: 'default', snapshot: 'changed' },
          })
          await expect(banner).toHaveCount(0)
          await expect(main).toContainText('in a form this app does not know yet')
          // A question does not claim it timed out: whether it waits cannot be shown.
          await expect(log.locator('[data-question]')).toContainText(
            'Whether this question still waits cannot be shown right now.',
          )
          fake.emitFirst()
          await expect(banner).toBeVisible()
          await expect(log.locator('[data-question=open]')).toBeVisible()

          // The participants: Jam's Agents group, each agent online, with what waits on the person from it.
          await sidePane(page)
            .getByRole('tab', { name: /^Participants/ })
            .click()
          const agents = sidePane(page).getByRole('list', { name: 'Agents' })
          await expect(agents.getByRole('listitem')).toHaveCount(2)
          await expect(
            agents.getByRole('listitem', { name: 'Nova' }).getByRole('img', { name: 'Online' }),
          ).toBeVisible()
          await expect(agents.getByRole('img', { name: '1 waiting on you' })).toHaveCount(2)
          // What each is on, in Jam's words: the tool a waiting permission request asks for.
          await expect(agents.getByRole('listitem', { name: 'Nova' })).toContainText('Write')
          await expect(agents.getByRole('listitem', { name: 'Atlas' })).toContainText('AskUserQuestion')

          // Jam's guide draws no line between a person and an agent here, so Remove is on an agent's card too, as the
          // same menu with the same word that a person's row carries - and it sends the same operation, naming the
          // agent by its own participant id and the room it is in. The room's owner is offered no menu at all.
          await expect(
            sidePane(page)
              .getByRole('list', { name: 'Participants' })
              .getByRole('listitem')
              .filter({ hasText: 'Sam Rivera' })
              .getByRole('button', { name: /^Actions for / }),
          ).toHaveCount(0)
          await agents.getByRole('button', { name: 'Actions for Nova' }).click()
          await expect(page.getByRole('menuitem')).toHaveText(['Remove'])
          await page.getByRole('menuitem', { name: 'Remove' }).click()
          await expect
            .poll(() => fake.requests.filter((request) => request.route === '/v1/removeRoomParticipant').length)
            .toBe(1)
          expect(fake.requests.filter((request) => request.route === '/v1/removeRoomParticipant').at(-1)?.body).toEqual(
            { profile: 'default', chat_id: CHECKOUT, participant_id: NOVA_ID },
          )
          await expect(page.getByRole('menuitem')).toHaveCount(0)

          // Work: Status opens first; the question sits on the agent's task in Human in the loop, the request on its own.
          await main.getByRole('tab', { name: 'Work' }).click()
          const status = main.getByRole('table', { name: 'Tasks by status' })
          await expect(status.getByRole('columnheader')).toHaveText([
            /Agent/,
            /To-do\s*2/,
            /In progress\s*1/,
            /Human in the loop\s*2/,
            /Done\s*1/,
          ])
          await expect(status.getByRole('row', { name: 'Atlas' })).toContainText('Draft the summary step')
          await expect(status.getByRole('row', { name: 'Nova' })).toContainText('Permission: Write')
          await expect(status.getByText('blocked')).toBeVisible()
          await main.getByRole('tab', { name: 'Shared' }).click()
          await expect(main.getByRole('region', { name: 'Todo' })).toContainText('#1Review the new checkout flow')
          await main.getByRole('tab', { name: 'Agents' }).click()
          await expect(main.getByRole('progressbar', { name: 'Atlas: 1 of 3 tasks done' })).toBeVisible()

          // The stream says the request was decided: the banner goes, at once, without a reload.
          const decided = inboxEvent()
          decided.kind.snapshot.pending_permissions = []
          fake.emit(decided)
          await expect(banner).toHaveCount(0)

          // Agents: Jam Hosted's cards, found by name or handle.
          await page.evaluate(() => (location.hash = '#/agents'))
          const hosted = main.getByRole('region', { name: 'Band Hosted' })
          await expect(hosted.getByRole('listitem')).toHaveCount(2)
          await main.getByRole('searchbox', { name: 'Search agents' }).fill('sam-rivera/nov')
          await expect(hosted.getByRole('listitem')).toHaveText([/Nova/])

          // Home when the inbox comes in a form this app does not know: Needs attention says so.
          await page.evaluate(() => (location.hash = '#/'))
          fake.emit({
            peer: 'human/default',
            kind: { kind: 'inbox_snapshot', profile: 'default', snapshot: 'changed' },
          })
          await expect(main).toContainText('Band answered with this list in a form this app does not know yet.')
          await expect(page.getByRole('list', { name: 'Needs attention' })).toHaveCount(0)
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })
  test("the person's own actions reach the daemon as Jam sends them: a message, an answer, a decision", async () => {
    const fake = await startFakeDaemon()
    const sent = (route: string) => fake.requests.filter((request) => request.route === route)
    try {
      await withApp(
        userData,
        async (_app, page) => {
          await openRoom(page, 'Checkout flow redesign')
          const main = page.getByRole('main')
          const box = page.getByRole('textbox', { name: 'Message' })
          await expect(box).toHaveAttribute('placeholder', 'Tag an agent and describe the task…')
          // The inbox is read for an account's profile name and nothing else.
          expect(
            await page.evaluate(() =>
              window.jam?.daemon.getInbox('../x').then(
                () => 'read',
                () => 'refused',
              ),
            ),
          ).toBe('refused')

          // Shift+Enter adds a line and sends nothing.
          await box.fill('Please add')
          await box.press('Shift+Enter')
          await expect(box).toHaveValue(['Please add', ''].join(String.fromCharCode(10)))
          expect(sent('/v1/roomSend')).toHaveLength(0)
          // Sending without a mention keeps the draft and opens the mention picker, as Jam does.
          await box.fill('Please add the tax line')
          await box.press('Enter')
          await page.getByRole('menuitem', { name: 'Atlas' }).click()
          await expect(box).toHaveValue('Please add the tax line @Atlas ')
          expect(sent('/v1/roomSend')).toHaveLength(0)
          await box.press('Enter')
          await expect.poll(() => sent('/v1/roomSend').length).toBe(1)
          expect(sent('/v1/roomSend')[0]?.body).toEqual({
            profile: 'default',
            chat_id: CHECKOUT,
            content: 'Please add the tax line @sam-rivera/atlas',
            mentions: [ATLAS],
          })
          await expect(box).toHaveValue('')

          // Typing @ opens the picker, and the choice takes the @'s place; closed without a choice, the @ stays.
          await box.press('@')
          await page.getByRole('menuitem', { name: 'Nova' }).click()
          await expect(box).toHaveValue('@Nova ')
          // The composer puts the caret after the mention on the next frame; text typed before then was pulled back to
          // where the caret lands (2026-09-23: "mail m@e at me", 1 run in 8).
          await expect.poll(() => box.evaluate((field) => (field as HTMLTextAreaElement).selectionStart)).toBe(6)
          await box.fill('mail me at me')
          await box.press('@')
          await page.keyboard.press('Escape')
          await expect(box).toHaveValue('mail me at me@')
          await box.fill('')

          // A refused message keeps its draft and says why.
          fake.removeRoute('/v1/roomSend')
          await box.fill('')
          await page.getByRole('button', { name: 'Mention' }).click()
          await page.getByRole('menuitem', { name: 'Nova' }).click()
          // The mention is in, and the caret after it, before the typing starts, as a person's would be: the field
          // takes its focus and caret a frame after the picker closes, and typing inside that frame once put the first
          // letter ahead of the mention, so Enter found no one addressed and opened the picker instead of sending.
          await expect(box).toHaveValue('@Nova ')
          await expect(box).toBeFocused()
          await box.pressSequentially('are you there?')
          await box.press('Enter')
          await expect(main.getByRole('alert')).toContainText('The message was not sent')
          await expect(box).toHaveValue('@Nova are you there?')
          fake.setAnswer('/v1/roomSend', undefined)
          await box.fill('')

          // An answer is Jam's answer form, addressed to the agent that asked.
          await main.locator('[data-question=open]').getByRole('button', { name: 'Answer…' }).click()
          const answer = page.getByRole('dialog', { name: 'Answer Atlas' })
          await answer.getByRole('button', { name: 'Stripe' }).click()
          await answer.getByRole('button', { name: 'Send answer' }).click()
          await expect(answer).toHaveCount(0)
          expect(sent('/v1/roomSend').at(-1)?.body).toEqual({
            profile: 'default',
            chat_id: CHECKOUT,
            content: '@sam-rivera/atlas Answer 7F3A21C9: Stripe',
            mentions: [ATLAS],
          })

          // A decision: the review's Allow once, for that request, to the agent that asked; nothing else is sent.
          await main
            .getByRole('region', { name: 'Permission requests' })
            .getByRole('button', { name: 'Review' })
            .click()
          const review = page.getByRole('dialog', { name: 'sam-rivera/nova wants to change files' })
          await review.getByRole('button', { name: 'Allow once' }).click()
          await expect(review).toHaveCount(0)
          expect(sent('/v1/decideRuntimePermission')).toHaveLength(1)
          expect(sent('/v1/decideRuntimePermission')[0]?.body).toEqual({
            target: { profile: 'default', scope: 'nova', handle: 'sam-rivera/nova' },
            id: 'claude-permission:claudecode:4d6f8a1c-3e5b-4c7d-9f1a-6b8d0e2f4a35:1789800000000:1',
            outcome: 'allow_once',
          })
          // Deny refuses this request only; Deny always sets the standing rule, and only when chosen (the fake keeps
          // the request waiting, so the banner stays for each).
          for (const [button, outcome] of [
            ['Deny', 'deny_once'],
            ['Deny always', 'deny_always'],
          ] as const) {
            await main
              .getByRole('region', { name: 'Permission requests' })
              .getByRole('button', { name: 'Review' })
              .click()
            await review.getByRole('button', { name: button, exact: true }).click()
            await expect(review).toHaveCount(0)
            expect(sent('/v1/decideRuntimePermission').at(-1)?.body).toMatchObject({ outcome })
          }
          expect(sent('/v1/decideRuntimePermission')).toHaveLength(3)
          // Nothing else was written: of every write this app can make (the routes docs/jam/routes.md lists as writes: its
          // eighteen named operations and setPlan), only these two were called.
          const table = readFileSync(join(process.cwd(), 'docs', 'jam', 'routes.md'), 'utf8')
          const writes = new Set([...table.matchAll(/^\| `(\/v1\/[^`]+)` \| writes /gm)].map((match) => match[1]))
          expect(writes.size).toBeGreaterThanOrEqual(19)
          const written = new Set(fake.requests.map((request) => request.route).filter((route) => writes.has(route)))
          expect([...written].toSorted()).toEqual(['/v1/decideRuntimePermission', '/v1/roomSend'])
        },
        { fake },
      )
    } finally {
      await fake.close()
    }
  })
})
