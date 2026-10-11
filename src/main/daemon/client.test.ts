import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HISTORY_MAX_PAGES, MESSAGE_MAX_CHARS } from '@shared/daemon'
import { ATTACHMENT_MAX_BASE64, DAEMON_OPERATION_NAMES } from '@shared/daemon-api'
import { startFakeDaemon, type FakeDaemon } from '../../../tests/fake-daemon/server'
import { DaemonClient, DaemonError } from './client'
import { assertRouteAllowed, FORBIDDEN_ROUTES } from './forbidden'
import { OPERATIONS } from './operations'
import { candidateEndpoints, request } from './transport'

let fake: FakeDaemon
let client: DaemonClient

/** The fixture room with a plan and files. */
const CHECKOUT = '5b0f6c2e-8d1a-4c3b-9e7f-2a4d6b8c0e11'
/** Atlas, one of the fixtures' two local agents (invented). */
const ATLAS = '7a1d3c5e-2b4f-4a6c-8e0d-1f3a5c7e9b21'
/** The fixtures' two teams (invented): one made by hand, one added from Band's Library, with its roles. */
const CHECKOUT_CREW = '5b8e2c4a-1f3d-4e6b-9a7c-0d2e4f6a8b1c'
const RELEASE_CREW = 'c3f1a7e9-6d2b-4c8e-b0a4-7e9c1d3f5a20'
const TEAM_DRAFT = {
  name: 'Docs crew',
  description: 'Keeps the guides true to the app.',
  guidelines: '',
  agentIds: [ATLAS],
  roleIds: [],
}

beforeEach(async () => {
  fake = await startFakeDaemon()
  client = new DaemonClient({ endpoint: fake.endpoint })
})

afterEach(async () => {
  client.stop()
  await fake.close()
})

const code = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error instanceof DaemonError ? error.code : `not a DaemonError: ${String(error)}`
  }
  return 'resolved'
}

describe('DaemonClient against the fake daemon', () => {
  it('connects, reports the version and whether the wire matches', async () => {
    expect(await client.start()).toEqual({ state: 'connected', version: '0.4.14', wire: 30, wireMatches: true })
  })

  it('reports a different wire version instead of failing', async () => {
    fake.setAnswer('/v1/ping', { version: '0.5.0', wire: 25 })
    expect(await client.start()).toMatchObject({ state: 'connected', wire: 25, wireMatches: false })
  })

  it('counts a ping without a wire version as a different protocol, not as no daemon', async () => {
    fake.setAnswer('/v1/ping', { version: '0.6.0' })
    expect(await client.start()).toEqual({ state: 'connected', version: '0.6.0', wire: null, wireMatches: false })
  })

  it('does not take an endpoint whose ping names no version for Jam’s daemon', async () => {
    fake.setAnswer('/v1/ping', { wire: 24 })
    expect(await client.start()).toEqual({ state: 'offline', reason: 'not-found' })
  })

  it('still finds a daemon whose ping has nulls where it has no value yet', async () => {
    fake.setAnswer('/v1/ping', { version: '0.4.11', wire: null, update: { latest: null, checked_at: null } })
    expect(await client.start()).toEqual({ state: 'connected', version: '0.4.11', wire: null, wireMatches: false })
  })

  it('runs every named operation and validates its answer', async () => {
    await client.start()
    const room = { profile: 'default', roomId: CHECKOUT }
    const inputs: Record<string, unknown> = {
      rooms: { profile: 'default' },
      roomOrg: { profile: 'default' },
      searchDirectory: { profile: 'default', kind: 'agent', q: 'be' },
      runtimePermissions: { profile: 'default', scope: 'atlas', handle: 'sam-rivera/atlas', hostSession: 'default' },
      setRoomOrg: {
        profile: 'default',
        org: { folders: [], assignments: {}, pinned: [], collapsed: [], archived: {} },
      },
      agentList: { profile: 'default' },
      contactsOverview: { profile: 'default' },
      dashboard: { profile: 'default', range: '7d' },
      roomParticipants: room,
      roomMessages: room,
      roomHistory: { ...room, page: 1 },
      roomPlan: room,
      roomFiles: room,
      roomWork: room,
      roomBoard: room,
      workSnapshot: { profile: 'default' },
      usageReport: { kind: 'daily' },
      agentSessions: { profile: 'default', scope: 'atlas', handle: 'sam-rivera/atlas' },
      agentStatus: { profile: 'default', scope: 'atlas', handle: 'sam-rivera/atlas' },
      defaultAgent: { profile: 'default' },
      fileDeletePreview: { profile: 'default', id: 'artifact-plan-1' },
      roomSend: { ...room, content: '@sam-rivera/atlas hello', mentions: [ATLAS] },
      decidePermission: {
        profile: 'default',
        scope: 'nova',
        handle: 'sam-rivera/nova',
        requestId: 'claude-permission:claudecode:4d6f8a1c-3e5b-4c7d-9f1a-6b8d0e2f4a35:1789800000000:1',
        outcome: 'deny_once',
      },
      kickoffWork: {
        profile: 'default',
        scope: 'atlas',
        handle: 'sam-rivera/atlas',
        message: 'Look at the failing checkout test and say what you find.',
      },
      setDefaultAgent: { profile: 'default', peer: 'default/atlas' },
      fileSaveCopy: { profile: 'default', id: 'artifact-plan-1' },
      fileStore: { profile: 'default', roomId: CHECKOUT, name: 'notes.md', mime: 'text/markdown', content: 'aGVsbG8=' },
      fileDelete: { profile: 'default', id: 'artifact-plan-1', impactToken: '3f7a1b92c4e05d68' },
      dismissMention: { profile: 'default', itemId: 'inbox-mention-1' },
      createRoom: { profile: 'default' },
      renameRoom: { ...room, title: 'Checkout flow redesign' },
      deleteRoom: room,
      addRoomParticipant: { ...room, participantId: ATLAS },
      removeRoomParticipant: { ...room, participantId: ATLAS },
      setNotifications: { version: 1, direct_mentions: true, human_requests: true, task_updates: 'completed_only' },
      teams: { profile: 'default' },
      createTeam: { profile: 'default', draft: TEAM_DRAFT },
      updateTeam: { profile: 'default', teamId: CHECKOUT_CREW, draft: TEAM_DRAFT },
      interruptTurn: {
        profile: 'default',
        scope: 'atlas',
        handle: 'sam-rivera/atlas',
        hostSession: 'atlas-3f2a7c19-5b84-4e61-9d0a-7c1e5f8b2a46',
      },
    }
    for (const name of DAEMON_OPERATION_NAMES) {
      await expect(client.run(name, inputs[name])).resolves.toBeDefined()
    }
    expect(await client.run('accounts', undefined)).toEqual([
      expect.objectContaining({ profile: 'default', signed_in: true }),
    ])
  })

  it('never passes a local path from the daemon to the page', async () => {
    await client.start()
    expect(await client.run('ping', undefined)).not.toHaveProperty('executable')
    const room = { profile: 'default', roomId: CHECKOUT }
    const plan = await client.run('roomPlan', room)
    expect(plan.source).toEqual({ label: 'Checkout plan', kind: 'markdown', snapshot: true })
    const files = await client.run('roomFiles', room)
    expect(files.files).toHaveLength(2)
    expect(JSON.stringify([plan, files])).not.toMatch(/plans|jam-data|artifacts/)
  })

  it("reports a plan whose file failed to refresh without passing on the error, which can name the file's path", async () => {
    const failing = JSON.parse(
      readFileSync(join(process.cwd(), 'tests/fake-daemon/fixtures/room', CHECKOUT, 'getRoomPlan.json'), 'utf8'),
    )
    failing.plan.watch_error = `cannot read ${['D:', 'plans', 'checkout-plan.md'].join('\\')}: file not found`
    fake.setRoomAnswer(CHECKOUT, '/v1/getRoomPlan', failing)
    await client.start()
    const plan = await client.run('roomPlan', { profile: 'default', roomId: CHECKOUT })
    expect(plan.refreshFailed).toBe(true)
    expect(plan.cache?.body).toContain('# Checkout plan')
    expect(JSON.stringify(plan)).not.toMatch(/plans|not found/)
  })

  it("sets a room's plan from the main process, and calls any refusal only 'unavailable'", async () => {
    await client.start()
    const source = ['D:', 'plans', 'next.md'].join('\\')
    expect(await client.setPlan('default', CHECKOUT, source)).toBe(true)
    expect(fake.requests.at(-1)).toMatchObject({
      route: '/v1/setPlan',
      body: { profile: 'default', chat_id: CHECKOUT, source },
    })
    fake.failRoute('/v1/setPlan', 422, { error: `cannot read ${source}` })
    expect(await client.setPlan('default', CHECKOUT, source)).toBe('unavailable')
    fake.removeRoute('/v1/setPlan')
    expect(await client.setPlan('default', CHECKOUT, source)).toBe('unavailable')
    fake.setAnswer('/v1/setPlan', undefined)
  })

  it("reads a room as the daemon answers it, sending the room's id as chat_id", async () => {
    await client.start()
    const participants = await client.run('roomParticipants', { profile: 'default', roomId: CHECKOUT })
    expect(participants[0]).toEqual({
      id: expect.any(String),
      handle: 'sam-rivera',
      name: 'Sam Rivera',
      kind: 'User',
      role: 'owner',
      status: 'active',
    })
    expect(participants.slice(1).map((participant) => participant.kind)).toEqual(['Agent', 'Agent'])
    expect(fake.requests.at(-1)).toMatchObject({ route: '/v1/roomParticipants', body: { chat_id: CHECKOUT } })
    const work = await client.run('workSnapshot', { profile: 'default' })
    expect(work).toMatchObject({ boards: 1, lanes: 2 })
    expect(work.rooms).toEqual([{ roomId: CHECKOUT, lanes: expect.any(Array) }])
  })

  it("hands the page a room's messages read one by one: one in a changed format is left out and counted", async () => {
    const message = {
      id: 'm1',
      content: '<img src=x onerror=alert(1)>',
      message_type: 'text',
      sender_id: 'p1',
      sender_name: 'Sam Rivera',
      sender_type: 'User',
      inserted_at: '2026-09-19T09:31:40.000000Z',
      chat_id: CHECKOUT,
      connectivity_profile: 'default',
    }
    fake.setRoomAnswer(CHECKOUT, '/v1/roomMessageSnapshot', {
      snapshot: {
        messages: [message, { id: 'm2' }, { ...message, id: 'm3', content: 'y'.repeat(MESSAGE_MAX_CHARS + 1) }],
        has_more: true,
        recovery: { state: 'running', detail: '', completed_rooms: 0, total_rooms: 1 },
      },
    })
    await client.start()
    const read = await client.run('roomMessages', { profile: 'default', roomId: CHECKOUT })
    expect(read).toMatchObject({ unreadable: 1, hasMore: true, loading: true })
    expect(read.messages).toHaveLength(2)
    // The text passes as text (the page never renders it as HTML); the room and connectivity fields stay behind.
    expect(read.messages[0]).toMatchObject({ id: 'm1', content: message.content, cut: false, mention_names: {} })
    expect(read.messages[0]).not.toHaveProperty('chat_id')
    expect(read.messages[0]).not.toHaveProperty('connectivity_profile')
    // A text too long to show is cut, and says so.
    expect(read.messages[1]).toMatchObject({ id: 'm3', cut: true })
    expect(read.messages[1]?.content).toHaveLength(MESSAGE_MAX_CHARS)
  })

  // Past the snapshot, a conversation is read a page at a time: page 1 is its newest (docs/jam/routes.md).
  it('asks for one page of a conversation at a time, and refuses a page that is not one', async () => {
    fake.setRoomAnswer(CHECKOUT, '/v1/roomMessages', {
      page: {
        // A message in a format this app cannot read is left out and counted, as in the snapshot.
        messages: [
          { id: 'm9', content: 'earlier', message_type: 'text', inserted_at: '2026-09-17T16:02:11.000000Z' },
          { id: 'm8' },
        ],
        page: 2,
        total_pages: 3,
        has_more: true,
      },
    })
    await client.start()
    const page = await client.run('roomHistory', { profile: 'default', roomId: CHECKOUT, page: 2 })
    expect(page).toMatchObject({ hasMore: true, totalPages: 3, unreadable: 1 })
    expect(page.messages).toMatchObject([{ id: 'm9', content: 'earlier' }])
    expect(page.messages).toHaveLength(1)
    // Every kind of event and all of time, as the snapshot gives them, in pages of the size the daemon itself used.
    expect(fake.requests.at(-1)).toMatchObject({
      route: '/v1/roomMessages',
      body: { profile: 'default', chat_id: CHECKOUT, query: { page: 2, page_size: 50, message_type: '', since: '' } },
    })
    // A daemon that says nothing about more pages has not said there are none.
    fake.setRoomAnswer(CHECKOUT, '/v1/roomMessages', { page: { messages: [] } })
    expect(await client.run('roomHistory', { profile: 'default', roomId: CHECKOUT, page: 1 })).toMatchObject({
      hasMore: null,
      totalPages: null,
    })
    // The last page the reader can ask for is the last the main process takes, and one past it is not a page.
    await expect(
      client.run('roomHistory', { profile: 'default', roomId: CHECKOUT, page: HISTORY_MAX_PAGES }),
    ).resolves.toBeDefined()
    for (const page of [0, -1, 1.5, '1', null, Number.NaN, HISTORY_MAX_PAGES + 1, 10_000]) {
      await expect(client.run('roomHistory', { profile: 'default', roomId: CHECKOUT, page })).rejects.toMatchObject({
        code: 'input',
      })
    }
  })

  it('sends a message as the daemon takes it, and refuses one without text or a mention', async () => {
    await client.start()
    const room = { profile: 'default', roomId: CHECKOUT }
    expect(
      await client.run('roomSend', { ...room, content: 'Hello @sam-rivera/atlas', mentions: [ATLAS, ATLAS] }),
    ).toEqual({
      id: expect.any(String),
    })
    expect(fake.requests.at(-1)).toMatchObject({
      route: '/v1/roomSend',
      body: { profile: 'default', chat_id: CHECKOUT, content: 'Hello @sam-rivera/atlas', mentions: [ATLAS] },
    })
    for (const bad of [
      { ...room, content: '   ', mentions: [ATLAS] },
      { ...room, content: 'x'.repeat(20_001), mentions: [ATLAS] },
      { ...room, content: 'hello', mentions: [] },
      { ...room, content: 'hello', mentions: ['sam-rivera/atlas'] },
      { ...room, content: 'hello', mentions: Array.from({ length: 51 }, () => ATLAS) },
      { ...room, roomId: 'not-a-room', content: 'hello', mentions: [ATLAS] },
    ]) {
      expect(await code(client.run('roomSend', bad))).toBe('input')
    }
  })

  /**
   * The picker searches Band's own directory. The daemon takes exactly two kinds and refuses anything else with
   * "Invalid value for enum", so a third never leaves here.
   */
  it('searches the directory for the two kinds the daemon takes, and no other', async () => {
    await client.start()
    const found = await client.run('searchDirectory', { profile: 'default', kind: 'agent', q: 'be' })
    expect(found.entries.map((one) => one.name)).toEqual(['Beacon', 'Lantern', 'Tideline'])
    expect(found.truncated).toBe(true)
    expect(fake.requests.at(-1)).toMatchObject({
      route: '/v1/searchDirectory',
      body: { profile: 'default', kind: 'agent', q: 'be' },
    })
    expect(await client.run('searchDirectory', { profile: 'default', kind: 'user', q: 'be' })).toBeTruthy()
    for (const bad of [
      { profile: 'default', kind: 'person', q: 'be' },
      { profile: 'default', kind: 'people', q: 'be' },
      { profile: 'default', kind: '', q: 'be' },
      { profile: 'default', kind: 'agent', q: 'x'.repeat(201) },
      { profile: 'default', kind: 'agent' },
    ]) {
      expect(await code(client.run('searchDirectory', bad))).toBe('input')
    }
  })

  /**
   * The room organisation is written back whole and the official Jam app shares it, so a member missing or of the
   * wrong kind would be written over the whole of it. It never leaves the main process.
   */
  it('writes the room organisation whole, and refuses one that is not an organisation', async () => {
    await client.start()
    const org = {
      folders: [{ id: 'f-1', name: 'Shipping' }],
      assignments: { [CHECKOUT]: 'f-1' },
      pinned: [CHECKOUT],
      collapsed: [],
      archived: {},
      somethingJamKeeps: { and: 'this app does not read' },
    }
    expect(await client.run('setRoomOrg', { profile: 'default', org })).toEqual({ set: true })
    // What was sent is the whole object, the key this app does not read included.
    expect(fake.requests.at(-1)).toMatchObject({ route: '/v1/setRoomOrg', body: { profile: 'default', org } })

    const whole = { folders: [], assignments: {}, pinned: [], collapsed: [], archived: {} }
    for (const bad of [
      { profile: 'default', org: { ...whole, folders: undefined } },
      { profile: 'default', org: { ...whole, pinned: {} } },
      { profile: 'default', org: { ...whole, collapsed: 'none' } },
      { profile: 'default', org: { ...whole, assignments: [] } },
      { profile: 'default', org: { ...whole, archived: null } },
      { profile: 'default', org: 'nothing like an organisation' },
      { profile: '', org: whole },
      // The profile names a file the daemon looks up, so it is held to the same shape every other operation holds it
      // to: nothing that could walk out of it, and nothing longer than a name.
      { profile: '../elsewhere', org: whole },
      { profile: 'a profile', org: whole },
      { profile: 'x'.repeat(65), org: whole },
    ]) {
      expect(await code(client.run('setRoomOrg', bad))).toBe('input')
    }
  })

  it('stores a file for a message as the daemon takes it, and the send carries the ids it answered', async () => {
    await client.start()
    // The bytes of "hello", in the one form the store takes: base64, and nothing that names a place on this machine.
    const stored = await client.run('fileStore', {
      profile: 'default',
      roomId: CHECKOUT,
      name: 'notes.md',
      mime: 'text/markdown',
      content: 'aGVsbG8=',
    })
    expect(stored.id).toMatch(/^art-[0-9a-f]{24}$/)
    expect(fake.requests.at(-1)).toMatchObject({
      route: '/v1/artifactStore',
      body: {
        profile: 'default',
        chat_id: CHECKOUT,
        source: { kind: 'bytes', value: 'aGVsbG8=' },
        name: 'notes.md',
        created_by: '',
        mime: 'text/markdown',
      },
    })
    // The answer the daemon gives carries the file's local path; what the page gets is the id and nothing else.
    expect(Object.keys(stored)).toEqual(['id'])

    expect(
      await client.run('roomSend', {
        profile: 'default',
        roomId: CHECKOUT,
        content: '@sam-rivera/atlas the notes',
        mentions: [ATLAS],
        attachmentIds: [stored.id],
      }),
    ).toEqual({ id: expect.anything() })
    expect(fake.requests.at(-1)).toMatchObject({
      route: '/v1/roomSend',
      body: { attachment_ids: [stored.id] },
    })

    // Home's assignment carries its staged files the same way, staged unbound for the room it will open.
    expect(
      await client.run('kickoffWork', {
        profile: 'default',
        scope: 'atlas',
        handle: 'sam-rivera/atlas',
        message: 'Look at the notes.',
        attachmentIds: [stored.id],
      }),
    ).toBeDefined()
    expect(fake.requests.at(-1)).toMatchObject({ route: '/v1/kickoffWork', body: { artifact_ids: [stored.id] } })

    // An unbound store is the empty room id, and the only other one this operation takes.
    expect(
      await client.run('fileStore', {
        profile: 'default',
        roomId: '',
        name: 'notes.md',
        mime: 'text/markdown',
        content: 'aGVsbG8=',
      }),
    ).toBeDefined()

    // What is not a file to stage never leaves here: bytes that are not base64, a name that walks a path, a file
    // past Jam's own limit, and ids the store never answered.
    // A no-padding base64 string at the maximum encoded length decodes to one byte over 32 MB. Checking the
    // encoded length alone would therefore let one oversized file through the main-process boundary.
    const oneByteOver = 'A'.repeat(ATTACHMENT_MAX_BASE64)
    for (const bad of [
      // Eight characters, so only the alphabet check can reject it: `*` is not base64.
      { profile: 'default', roomId: CHECKOUT, name: 'notes.md', mime: 'text/markdown', content: 'not*base' },
      { profile: 'default', roomId: CHECKOUT, name: '../notes.md', mime: 'text/markdown', content: 'aGVsbG8=' },
      { profile: 'default', roomId: CHECKOUT, name: 'notes.md', mime: 'text/markdown', content: oneByteOver },
      { profile: 'default', roomId: '../elsewhere', name: 'notes.md', mime: 'text/markdown', content: 'aGVsbG8=' },
      // Each of the name's own refusals: the other slash, blank, too long, a folder's name, a control character.
      { profile: 'default', roomId: CHECKOUT, name: '..\\notes.md', mime: 'text/markdown', content: 'aGVsbG8=' },
      { profile: 'default', roomId: CHECKOUT, name: '  ', mime: 'text/markdown', content: 'aGVsbG8=' },
      { profile: 'default', roomId: CHECKOUT, name: 'n'.repeat(201), mime: 'text/markdown', content: 'aGVsbG8=' },
      { profile: 'default', roomId: CHECKOUT, name: '..', mime: 'text/markdown', content: 'aGVsbG8=' },
      {
        profile: 'default',
        roomId: CHECKOUT,
        name: `notes${String.fromCharCode(10)}.md`,
        mime: 'text/markdown',
        content: 'aGVsbG8=',
      },
      // The kind: too long, and not of the form type/subtype.
      { profile: 'default', roomId: CHECKOUT, name: 'notes.md', mime: `text/${'m'.repeat(96)}`, content: 'aGVsbG8=' },
      { profile: 'default', roomId: CHECKOUT, name: 'notes.md', mime: 'text/markdown\r\nX: y', content: 'aGVsbG8=' },
      // The bytes: none, and a length base64 cannot have.
      { profile: 'default', roomId: CHECKOUT, name: 'notes.md', mime: 'text/markdown', content: '' },
      { profile: 'default', roomId: CHECKOUT, name: 'notes.md', mime: 'text/markdown', content: 'aGVsbG8' },
    ]) {
      expect(await code(client.run('fileStore', bad))).toBe('input')
    }
    // A name of exactly 200 characters and a plain kind still go through.
    expect(
      await client.run('fileStore', {
        profile: 'default',
        roomId: CHECKOUT,
        name: 'n'.repeat(200),
        mime: 'application/octet-stream',
        content: 'aGVsbG8=',
      }),
    ).toBeDefined()
    // What the daemon says when it refuses a store never reaches the page: its words can carry a path.
    const storeFolder = ['', 'home', 'someone', '.jam', 'artifacts'].join('/')
    fake.failRoute('/v1/artifactStore', 500, { error: `disk full at ${storeFolder}` })
    const refused = await client
      .run('fileStore', {
        profile: 'default',
        roomId: CHECKOUT,
        name: 'notes.md',
        mime: 'text/markdown',
        content: 'aGVsbG8=',
      })
      .catch((error: unknown) => error)
    expect(String(refused)).toContain('The daemon did not store the file')
    expect(String(refused)).not.toContain('/home/')
    fake.setAnswer('/v1/artifactStore', undefined)
    for (const bad of [
      {
        profile: 'default',
        roomId: CHECKOUT,
        content: '@sam-rivera/atlas hi',
        mentions: [ATLAS],
        attachmentIds: ['not an id'],
      },
      {
        profile: 'default',
        roomId: CHECKOUT,
        content: '@sam-rivera/atlas hi',
        mentions: [ATLAS],
        attachmentIds: Array.from({ length: 11 }, () => stored.id),
      },
    ]) {
      expect(await code(client.run('roomSend', bad))).toBe('input')
    }
  })

  it('decides a permission request as the daemon takes it, and never with an answer Jam does not offer', async () => {
    await client.start()
    const decision = {
      profile: 'default',
      scope: 'nova',
      handle: 'sam-rivera/nova',
      requestId: 'claude-permission:claudecode:4d6f8a1c-3e5b-4c7d-9f1a-6b8d0e2f4a35:1789800000000:1',
      outcome: 'allow_once',
    }
    expect(await client.run('decidePermission', decision)).toEqual({ decided: true })
    expect(fake.requests.at(-1)).toMatchObject({
      route: '/v1/decideRuntimePermission',
      body: {
        target: { profile: 'default', scope: 'nova', handle: 'sam-rivera/nova' },
        id: decision.requestId,
        outcome: 'allow_once',
      },
    })
    for (const bad of [
      { ...decision, outcome: 'allow_always' },
      { ...decision, outcome: 'cancelled' },
      { ...decision, requestId: 'a request; with spaces' },
      { ...decision, scope: 'Nova/..' },
    ]) {
      expect(await code(client.run('decidePermission', bad))).toBe('input')
    }
  })

  it("reads a local agent's sessions, sending its target, and refuses a target that is not one", async () => {
    await client.start()
    const target = { profile: 'default', scope: 'atlas', handle: 'sam-rivera/atlas' }
    const sessions = await client.run('agentSessions', target)
    expect(sessions.map((session) => session.room ?? null)).toEqual([null, CHECKOUT])
    expect(fake.requests.at(-1)).toMatchObject({
      route: '/v1/listSessions',
      body: { target: { profile: 'default', scope: 'atlas', handle: 'sam-rivera/atlas' } },
    })
    expect(JSON.stringify(sessions)).not.toMatch(/work\/atlas|runtime/)
    for (const bad of [
      { ...target, scope: '../atlas' },
      { ...target, handle: 'atlas' },
      { ...target, handle: 'sam-rivera/atlas/../x' },
    ]) {
      expect(await code(client.run('agentSessions', bad))).toBe('input')
    }
  })

  it('reports a room the account is not in as refused, so only that room degrades', async () => {
    await client.start()
    const stranger = { profile: 'default', roomId: '00000000-0000-4000-8000-000000000001' }
    expect(await code(client.run('roomParticipants', stranger))).toBe('rejected')
    expect(await client.run('roomFiles', stranger)).toMatchObject({ files: [] })
  })

  it('drops fields it does not know and keeps working', async () => {
    fake.setAnswer('/v1/logConfig', { config: { level: 'debug', sinks: ['file'] }, extra: true })
    await client.start()
    expect(await client.run('logConfig', undefined)).toEqual({ level: 'debug' })
  })

  it('refuses input the operation does not take, before anything is sent', async () => {
    await client.start()
    const sent = fake.requests.length
    expect(await code(client.run('rooms', { profile: '../../x' }))).toBe('input')
    expect(await code(client.run('rooms', undefined))).toBe('input')
    expect(await code(client.run('dashboard', { profile: 'default', range: '90d' }))).toBe('input')
    expect(await code(client.run('ping', { route: '/v1/deleteAccount' }))).toBe('input')
    for (const roomId of [undefined, '', 'not-a-uuid', '../deleteRoom', `${CHECKOUT}/x`, 42]) {
      expect(await code(client.run('roomPlan', { profile: 'default', roomId })), String(roomId)).toBe('input')
    }
    expect(await code(client.run('roomFiles', { roomId: CHECKOUT }))).toBe('input')
    expect(fake.requests.length).toBe(sent)
  })

  it('reports a route this daemon does not offer as unsupported (the screen degrades)', async () => {
    fake.removeRoute('/v1/listDiscovered')
    await client.start()
    expect(await code(client.run('discovered', undefined))).toBe('unsupported')
  })

  it('reports an answer whose shape changed as invalid, not as a crash', async () => {
    fake.setAnswer('/v1/accounts', { accounts: 'not a list' })
    await client.start()
    expect(await code(client.run('accounts', undefined))).toBe('invalid-answer')
  })

  it('reports the daemon offline when it stops answering, and finds it again', async () => {
    await client.start()
    await fake.pause()
    expect(await code(client.run('ping', undefined))).toBe('offline')
    expect(client.status()).toEqual({ state: 'offline', reason: 'not-answering' })
    await fake.resume()
    expect(await client.start()).toMatchObject({ state: 'connected' })
  })

  it('is offline when no daemon can be found', async () => {
    const lonely = new DaemonClient({ discover: () => [] })
    expect(await lonely.start()).toEqual({ state: 'offline', reason: 'not-found' })
    expect(await code(lonely.run('ping', undefined))).toBe('offline')
    lonely.stop()
  })

  it('sends nothing once stopped', async () => {
    await client.start()
    client.stop()
    const sent = fake.requests.length
    expect(await code(client.run('ping', undefined))).toBe('offline')
    expect(fake.requests.length).toBe(sent)
  })

  it('reports nothing after a stop that lands while it is still connecting', async () => {
    const statuses: unknown[] = []
    const racing = new DaemonClient({ endpoint: fake.endpoint, onStatus: (status) => statuses.push(status) })
    fake.setLatency(200)
    const starting = racing.start()
    racing.stop()
    await starting
    expect(statuses).toEqual([])
    expect(racing.status()).toEqual({ state: 'connecting' })
    expect(await code(racing.run('ping', undefined))).toBe('offline')
  })

  it('reports nothing after stop, even when a request already under way then fails', async () => {
    const statuses: string[] = []
    const closing = new DaemonClient({ endpoint: fake.endpoint, onStatus: (status) => statuses.push(status.state) })
    await closing.start()
    fake.setLatency(500)
    const pending = code(closing.run('logConfig', undefined))
    await new Promise((done) => setTimeout(done, 100))
    closing.stop()
    await fake.pause()
    expect(await pending).toBe('offline')
    expect(statuses).toEqual(['connected'])
  })

  it('gives a daemon that is slow to be found the longer allowance once', async () => {
    const slow = new DaemonClient({ endpoint: fake.endpoint, timings: { discoveryPingMs: 100, healthPingMs: 1_500 } })
    fake.setLatency(400)
    expect(await slow.start()).toMatchObject({ state: 'connected' })
    slow.stop()
  })

  it('reports a daemon that stays slow as not answering, not as absent', async () => {
    const slow = new DaemonClient({ endpoint: fake.endpoint, timings: { discoveryPingMs: 100, healthPingMs: 200 } })
    fake.setLatency(2_000)
    expect(await slow.start()).toEqual({ state: 'offline', reason: 'not-answering' })
    slow.stop()
  })

  it('reports an answer too large to hold as invalid, and stays connected', async () => {
    fake.setAnswer('/v1/logConfig', { config: { level: 'x'.repeat(33 * 1024 * 1024) } })
    await client.start()
    expect(await code(client.run('logConfig', undefined))).toBe('invalid-answer')
    expect(client.status()).toMatchObject({ state: 'connected' })
  })

  it('asks a busy daemon again before it counts as gone', async () => {
    // One health ping that times out is only asked again (after 1000 ms); the second one here answers in time.
    const statuses: string[] = []
    const patient = new DaemonClient({
      endpoint: fake.endpoint,
      onStatus: (status) => statuses.push(status.state),
      timings: { healthConnectedMs: 100, healthPingMs: 400, healthOfflineMs: 1_000 },
    })
    await patient.start()
    fake.setLatency(1_500)
    await new Promise((done) => setTimeout(done, 1_000))
    fake.setLatency(0)
    await new Promise((done) => setTimeout(done, 1_000))
    expect(statuses).toEqual(['connected'])
    expect(patient.status().state).toBe('connected')
    patient.stop()
  })

  it('still reports a daemon that stays unanswering', async () => {
    const statuses: string[] = []
    const watching = new DaemonClient({
      endpoint: fake.endpoint,
      onStatus: (status) => statuses.push(status.state),
      timings: { healthConnectedMs: 50, healthPingMs: 150, healthOfflineMs: 100 },
    })
    await watching.start()
    fake.setLatency(5_000)
    await expect.poll(() => watching.status().state, { timeout: 4_000 }).toBe('offline')
    expect(statuses).toEqual(['connected', 'offline'])
    watching.stop()
  })

  it('hands the page only an event’s name, never its unvalidated content', async () => {
    const events: unknown[] = []
    const listening = new DaemonClient({ endpoint: fake.endpoint, onEvent: (event) => events.push(event) })
    await listening.start()
    await expect.poll(() => fake.requests.some((r) => r.route === '/v1/events')).toBe(true)
    // The stream opens with the person's inbox, as the live daemon's does; then an event with content (invented).
    await expect.poll(() => events.length).toBe(1)
    fake.emit({ peer: 'human:default', kind: { kind: 'room_directory_snapshot', rooms: [{ title: '<b>hi</b>' }] } })
    await expect.poll(() => events.length).toBe(2)
    expect(events).toEqual([
      { receivedAt: expect.any(Number), kind: 'inbox_snapshot' },
      { receivedAt: expect.any(Number), kind: 'room_directory_snapshot' },
    ])
    listening.stop()
  })

  it("keeps the account's inbox from the stream, validated, and forgets it when the stream ends", async () => {
    const listening = new DaemonClient({ endpoint: fake.endpoint, onEvent: () => undefined })
    expect(listening.inbox('default')).toBeNull()
    await listening.start()
    await expect.poll(() => listening.inbox('default')).not.toBeNull()
    const read = listening.inbox('default')
    if (read?.state !== 'ready') throw new Error(`expected the fixture's inbox, got ${JSON.stringify(read)}`)
    expect(read.inbox.permissions.map((item) => item.record.request.action)).toEqual(['Write'])
    expect(read.inbox.questions.map((item) => [item.peerKey, item.roomId, item.question.answer_code])).toEqual([
      ['default/atlas', CHECKOUT, '7F3A21C9'],
    ])
    // Each direct mention is read on its own: it carries the room it was said in, and one in a form this app does not
    // know is left out and counted, never taking the rest of the inbox with it.
    expect(read.inbox.mentions.map((mention) => [mention.message.sender_name, mention.roomId, mention.done])).toEqual([
      ['Atlas', CHECKOUT, false],
    ])
    expect(read.inbox.unreadable).toBe(0)
    expect(listening.inbox('work')).toBeNull()
    // One mention the daemon sends in a form this app does not know is counted, and the others still show.
    const snapshot = JSON.parse(
      readFileSync(join(process.cwd(), 'tests/fake-daemon/fixtures/events/inbox_snapshot.json'), 'utf8'),
    ).kind.snapshot as {
      direct_mentions: unknown[]
      done_ids?: string[]
    }
    const good = snapshot.direct_mentions[0] as { message: { id: string } }
    fake.emit({
      peer: 'human/default',
      kind: {
        kind: 'inbox_snapshot',
        profile: 'default',
        snapshot: { ...snapshot, direct_mentions: [good, { message: { id: 'no-room' } }] },
      },
    })
    await expect
      .poll(() => (listening.inbox('default') as { inbox?: { unreadable: number } })?.inbox?.unreadable)
      .toBe(1)
    expect((listening.inbox('default') as { inbox: { mentions: unknown[] } }).inbox.mentions).toHaveLength(1)

    // A mention the person has dismissed is not kept for the page to list.
    fake.emit({
      peer: 'human/default',
      kind: {
        kind: 'inbox_snapshot',
        profile: 'default',
        snapshot: { ...snapshot, done_ids: [good.message.id] },
      },
    })
    await expect
      .poll(
        () => (listening.inbox('default') as { inbox?: { mentions: { done: boolean }[] } })?.inbox?.mentions[0]?.done,
      )
      .toBe(true)

    // An inbox in a changed format replaces the one kept as `changed`: an older inbox is never shown as current.
    fake.emit({ peer: 'human/default', kind: { kind: 'inbox_snapshot', profile: 'default', snapshot: 'changed' } })
    await expect.poll(() => listening.inbox('default')).toEqual({ state: 'changed' })
    fake.emitFirst()
    await expect.poll(() => listening.inbox('default')?.state).toBe('ready')
    await fake.pause()
    await expect.poll(() => listening.inbox('default')).toBeNull()
    await fake.resume()
    listening.stop()
  })

  it('forgets the inbox when it stops', async () => {
    const listening = new DaemonClient({ endpoint: fake.endpoint, onEvent: () => undefined })
    await listening.start()
    await expect.poll(() => listening.inbox('default')?.state).toBe('ready')
    listening.stop()
    expect(listening.inbox('default')).toBeNull()
  })
})

describe('teams (Band Desktop 0.4.14)', () => {
  it('reads the account’s teams, each with its agents and the roles a Library team carries', async () => {
    await client.start()
    const teams = await client.run('teams', { profile: 'default' })
    expect(teams.map((team) => team.id)).toEqual([CHECKOUT_CREW, RELEASE_CREW])
    expect(teams[0]).toMatchObject({ name: 'Checkout crew', agent_ids: [ATLAS, expect.any(String)], role_ids: [] })
    expect(teams[1]).toMatchObject({
      template_id: 'release-crew',
      role_ids: ['security-reviewer', 'technical-writer', 'release-engineer'],
    })
  })

  it('leaves out a team in a changed format and keeps the rest', async () => {
    fake.setAnswer('/v1/listTeams', {
      teams: [
        { id: CHECKOUT_CREW, name: 7 },
        { id: RELEASE_CREW, name: 'Release crew' },
      ],
    })
    await client.start()
    expect((await client.run('teams', { profile: 'default' })).map((team) => team.id)).toEqual([RELEASE_CREW])
  })

  it('sends a team as Band’s draft, and an edit keeps the team’s own roles', async () => {
    await client.start()
    await client.run('createTeam', { profile: 'default', draft: { ...TEAM_DRAFT, name: '  Docs crew  ' } })
    expect(fake.requests.filter((one) => one.route === '/v1/createTeam').at(-1)?.body).toEqual({
      profile: 'default',
      draft: {
        name: 'Docs crew',
        description: 'Keeps the guides true to the app.',
        guidelines: '',
        agent_ids: [ATLAS],
        role_ids: [],
      },
    })
    const roles = ['security-reviewer', 'technical-writer', 'release-engineer']
    await client.run('updateTeam', {
      profile: 'default',
      teamId: RELEASE_CREW,
      draft: { ...TEAM_DRAFT, roleIds: roles },
    })
    expect(fake.requests.filter((one) => one.route === '/v1/updateTeam').at(-1)?.body).toEqual({
      profile: 'default',
      team_id: RELEASE_CREW,
      draft: {
        name: 'Docs crew',
        description: 'Keeps the guides true to the app.',
        guidelines: '',
        agent_ids: [ATLAS],
        role_ids: roles,
      },
    })
  })

  it('refuses a team with no agent, no name or an id it cannot know, before anything is sent', async () => {
    await client.start()
    const refused = [
      client.run('createTeam', { profile: 'default', draft: { ...TEAM_DRAFT, agentIds: [] } }),
      client.run('createTeam', { profile: 'default', draft: { ...TEAM_DRAFT, name: '   ' } }),
      client.run('createTeam', { profile: 'default', draft: { ...TEAM_DRAFT, name: 'x'.repeat(201) } }),
      client.run('createTeam', { profile: 'default', draft: { ...TEAM_DRAFT, agentIds: ['not an id/..'] } }),
      client.run('updateTeam', {
        profile: 'default',
        teamId: RELEASE_CREW,
        draft: { ...TEAM_DRAFT, roleIds: ['a role'] },
      }),
      client.run('updateTeam', { profile: 'default', teamId: '../teams', draft: TEAM_DRAFT }),
    ]
    for (const attempt of refused) expect(await code(attempt)).toBe('input')
    await expect(
      client.run('createTeam', { profile: 'default', draft: { ...TEAM_DRAFT, agentIds: [] } }),
    ).rejects.toThrow('Choose at least one agent for the team.')
    // A name too long is told as that, not as a missing name.
    await expect(
      client.run('createTeam', { profile: 'default', draft: { ...TEAM_DRAFT, name: 'x'.repeat(201) } }),
    ).rejects.toThrow('A team’s name is at most 200 characters')
    expect(fake.requests.some((one) => one.route === '/v1/createTeam' || one.route === '/v1/updateTeam')).toBe(false)
  })

  it('sends a Library team’s roles back as Band gave them, whatever their form', async () => {
    await client.start()
    // No live team with a role has been read, so a role id with a colon, a dot or a slash is kept, not refused.
    const roles = ['library:security.reviewer', 'roles/technical-writer']
    await client.run('updateTeam', {
      profile: 'default',
      teamId: RELEASE_CREW,
      draft: { ...TEAM_DRAFT, roleIds: roles },
    })
    expect(fake.requests.filter((one) => one.route === '/v1/updateTeam').at(-1)?.body).toMatchObject({
      draft: { role_ids: roles },
    })
  })
})

describe('the operation table', () => {
  it('refuses exactly the routes docs/jam/routes.md marks never', () => {
    const table = readFileSync(join(process.cwd(), 'docs', 'jam', 'routes.md'), 'utf8')
    const never = [...table.matchAll(/^\| `(\/v1\/[^`]+)` \| \*\*never\*\* \|/gm)].map((match) => match[1])
    expect(never).toHaveLength(10)
    expect([...FORBIDDEN_ROUTES].toSorted()).toEqual(never.toSorted())
  })

  it('has exactly one row per named operation', () => {
    expect(Object.keys(OPERATIONS).toSorted()).toEqual([...DAEMON_OPERATION_NAMES].toSorted())
  })

  it('never points at a forbidden route', () => {
    for (const spec of Object.values(OPERATIONS)) expect(FORBIDDEN_ROUTES.has(spec.route)).toBe(false)
  })

  it('writes only what the person does: assign, send, decide, preselect, store, save or delete a file, stop a turn', () => {
    const writes = Object.entries(OPERATIONS)
      .filter(([, spec]) => spec.kind === 'write')
      .map(([name]) => name)
    expect(writes.toSorted()).toEqual([
      'addRoomParticipant',
      'createRoom',
      'createTeam',
      'decidePermission',
      'deleteRoom',
      'dismissMention',
      'fileDelete',
      'fileSaveCopy',
      'fileStore',
      'interruptTurn',
      'kickoffWork',
      'removeRoomParticipant',
      'renameRoom',
      'roomSend',
      'setDefaultAgent',
      'setNotifications',
      'setRoomOrg',
      'updateTeam',
    ])
    // Each write's row says what it changes (docs: "A write also says in its row's comment what it changes").
    const source = readFileSync(join(process.cwd(), 'src', 'main', 'daemon', 'operations.ts'), 'utf8')
    for (const name of writes) {
      expect(source).toMatch(new RegExp(`// Changes: [^\\n]+\\n(?:\\s*//[^\\n]*\\n)*\\s*${name}: \\{`))
    }
  })

  it('points each write at a route docs/jam/routes.md lists as a write', () => {
    const table = readFileSync(join(process.cwd(), 'docs', 'jam', 'routes.md'), 'utf8')
    const writes = new Set([...table.matchAll(/^\| `(\/v1\/[^`]+)` \| writes /gm)].map((match) => match[1]))
    for (const [name, spec] of Object.entries(OPERATIONS)) {
      if (spec.kind === 'write') expect(writes.has(spec.route), `${name} -> ${spec.route}`).toBe(true)
    }
  })

  /**
   * The README is what this project says about itself to anyone who receives it, and its "Act on its own" bullet is
   * the promise that nothing writes without the person doing something. It once said "the two writes" while there
   * were fourteen. This pins the two together: a new write has to be said out loud there before this passes.
   */
  it('names every write in the README, so that promise cannot go stale', () => {
    const SAID: Record<string, string> = {
      kickoffWork: 'assigning work from Home',
      roomSend: 'sending a message',
      decidePermission: "deciding an agent's permission request",
      interruptTurn: 'stopping the turn an agent is working on',
      dismissMention: 'dismissing a mention',
      setDefaultAgent: 'choosing the agent Home preselects',
      createRoom: 'making a room',
      renameRoom: 'renaming one',
      deleteRoom: 'deleting one',
      addRoomParticipant: 'adding or removing a participant',
      removeRoomParticipant: 'adding or removing a participant',
      fileSaveCopy: 'saving a copy of',
      fileDelete: "deleting one of a room's files",
      setNotifications: 'turning a notification category on or off',
      setRoomOrg: 'organising the room list',
      fileStore: 'attaching a file to a message',
      createTeam: 'making a team',
      updateTeam: 'editing a team',
    }
    const writes = Object.entries(OPERATIONS)
      .filter(([, spec]) => spec.kind === 'write')
      .map(([name]) => name)
    for (const name of writes) expect(Object.hasOwn(SAID, name), `${name} is not named in the README`).toBe(true)

    // The one write that lives outside the table: a room's plan file is set from the main process alone, because
    // its input is a path on this computer and no channel may carry one from the page. It is said out loud with the
    // rest, and a second write of that kind has to be added here by hand.
    const SAID_BESIDE_THE_TABLE: Record<string, string> = {
      setPlan: "setting a room's plan file",
    }

    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8')
    const bullet = readme.split('\n').find((line) => line.startsWith('- **Act on its own.**'))
    expect(bullet, 'the README has no "Act on its own" bullet').toBeDefined()
    for (const name of writes) expect(bullet, `${name}: ${SAID[name]}`).toContain(SAID[name])
    for (const [name, said] of Object.entries(SAID_BESIDE_THE_TABLE)) {
      expect(bullet, `${name}: ${said}`).toContain(said)
    }

    // What the client calls by hand, read off client.ts itself: every route there outside the table is a read (the
    // health check, a file's own route whose answer carries a path, the event stream) or one of the writes said above,
    // so a new write called by hand fails here until it is added to that list and to the README.
    const source = readFileSync(join(process.cwd(), 'src', 'main', 'daemon', 'client.ts'), 'utf8')
    const byHand = new Set([...source.matchAll(/'(\/v1\/[A-Za-z]+)'/g)].map((match) => match[1]!))
    expect(byHand.size, 'no route literal found in client.ts: the scan itself is broken').toBeGreaterThan(2)
    const READ_BY_HAND = new Set(['/v1/ping', '/v1/artifactGet', '/v1/events'])
    const WRITTEN_BY_HAND: Record<string, keyof typeof SAID_BESIDE_THE_TABLE> = { '/v1/setPlan': 'setPlan' }
    const tableRoutes = new Set<string>(Object.values(OPERATIONS).map((spec) => spec.route))
    for (const route of byHand) {
      if (tableRoutes.has(route) || READ_BY_HAND.has(route)) continue
      expect(Object.hasOwn(WRITTEN_BY_HAND, route), `${route} is called outside the table and named nowhere`).toBe(true)
    }
  })

  it('points each read at a route docs/jam/routes.md lists as a read, not only calls it one', () => {
    const table = readFileSync(join(process.cwd(), 'docs', 'jam', 'routes.md'), 'utf8')
    // Recorded reads only: a read known by its name alone (LEAD) is not yet a route the page may reach.
    const reads = new Set([...table.matchAll(/^\| `(\/v1\/[^`]+)` \| read · recorded /gm)].map((match) => match[1]))
    expect(reads.size).toBeGreaterThan(30)
    for (const [name, spec] of Object.entries(OPERATIONS)) {
      if (spec.kind === 'read') expect(reads.has(spec.route), `${name} -> ${spec.route}`).toBe(true)
    }
  })
})

describe('the transport', () => {
  it.each([
    '/v1/deleteAccount',
    '/v1/deleteLocalAccountData',
    '/v1/revealAgentApiKey',
    '/v1/replaceAgentApiKey',
    '/v1/signOutAccount',
    '/v1/shutdown',
    '/v1/removeAccount',
    '/v1/addAccount',
    '/v1/addOauthAccount',
    '/v1/update',
    '/v1/DeleteAccount',
    '/v1/deleteAccount?profile=default',
    '/v1/signOutAccount/',
    '/v1/%64eleteAccount',
    '/v1/./deleteAccount',
    '/v1//deleteAccount',
    '//v1/deleteAccount',
    '/v1/x/../deleteAccount',
    '/v1/deleteAccount#fragment',
    '/v1/deleteAccount ',
  ])('refuses %s before sending anything', async (path) => {
    const sent = fake.requests.length
    await expect(
      request(fake.endpoint, { method: 'POST', path: path as `/v1/${string}`, body: {}, timeoutMs: 2_000 }),
    ).rejects.toThrow(/never calls/)
    expect(fake.requests.length).toBe(sent)
  })

  it.each(['/v1/ping', '/v1/agent-list', '/v1/events', '/v1/dashboard?range=7d&profile=a%20b'])(
    'lets the route shape %s through',
    (path) => {
      expect(() => assertRouteAllowed(path)).not.toThrow()
    },
  )

  it('maps a refused route to an input error, never to "the daemon is offline"', async () => {
    const spec = OPERATIONS.ping as { route: string }
    const route = spec.route
    await client.start()
    try {
      spec.route = '/v1/deleteAccount'
      expect(await code(client.run('ping', undefined))).toBe('input')
      expect(client.status()).toMatchObject({ state: 'connected' })
    } finally {
      spec.route = route
    }
  })

  it('finds jam-<hash> pipes only, never another program named jam', () => {
    // An invented hash, built from parts so no pipe name appears whole in the source (scripts/check-identity.mjs).
    const hash = '0f'.repeat(16)
    const pipes = [`jam-${hash}`, 'jam-notes', 'jamr-fake-1234', 'other', 'JAM-ABCDEF0123456789']
    expect(candidateEndpoints('win32', {}, () => pipes)).toEqual([
      `\\\\.\\pipe\\jam-${hash}`,
      '\\\\.\\pipe\\JAM-ABCDEF0123456789',
    ])
  })
})
