import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AgentStatusSchema,
  ArtifactStoreSchema,
  DaemonInfoSchema,
  ParticipantsSchema,
  PLAN_MAX_CHARS,
  ROOM_ID,
  RoomFilesSchema,
  RoomPlanSchema,
  RoomsSchema,
  toAgentStatus,
  toDiscovered,
  toHostPeers,
} from './daemon'

describe('the daemon schemas', () => {
  it('name every part still typed z.unknown() in their header', () => {
    // When a shape is recorded (or a new opaque part appears), this count changes: update the list in the header with it.
    const source = readFileSync(join(import.meta.dirname, 'daemon.ts'), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code.match(/z\.unknown\(\)/g)).toHaveLength(30)
    expect(source).toContain('(30 in all, counted by')
  })
})

/** Answers recorded from a room made for recording them (2026-09-19), with invented contents and paths shaped like this machine's. */
const HOME = ['C:', 'Users', 'someone'].join('\\')
const recordedPlan = {
  plan: {
    chat_id: 'a0000000-0000-4000-8000-000000000000',
    source: {
      raw: `${HOME.replaceAll('\\', '/')}/plan.md`,
      canonical: `${HOME}\\plan.md`,
      label: 'Test plan',
      attachment_id: 'b0000000-0000-4000-8000-000000000000',
      kind: 'markdown',
      event_profile: 'default',
      snapshot: true,
    },
    cache: { body: '# Plan', content_type: 'markdown', fetched_at: 1, bytes: 6 },
    last_error: '',
    live_source_state: 'snapshot',
    watch_error: '',
    overlay: { states: {}, focus: '' },
    updated_at: 1,
    doc_rev: 1,
  },
}
const recordedFile = {
  id: 'art-000000000000000000000001',
  local_artifact_id: 'art-000000000000000000000001',
  name: 'plan.md',
  mime: 'text/markdown',
  bytes: 6,
  sha256: '0'.repeat(64),
  path: `${HOME}\\AppData\\Local\\jam\\cfg\\artifacts\\plan.md`,
  has_thumb: false,
  uploader_id: '',
  uploader_type: 'Local',
  uploader_name: null,
  created_at: 1,
  expires_at: null,
  local_only: true,
}

describe("a room's schemas", () => {
  it('keep the room list as recorded, and refuse a room without an id or title', () => {
    const room = { id: 'a', title: 'New Session', task_id: '', updated_at: 'x', last_message_at: null }
    expect(RoomsSchema.parse({ rooms: [room] }).rooms).toEqual([room])
    expect(RoomsSchema.safeParse({ rooms: [{ id: 'a' }] }).success).toBe(false)
    expect(RoomsSchema.safeParse({ rooms: [{ title: 'x' }] }).success).toBe(false)
  })

  it("leave the plan's file paths out", () => {
    const plan = RoomPlanSchema.parse(recordedPlan).plan
    expect(JSON.stringify(plan)).not.toContain('someone')
    expect(plan.source).toEqual({ label: 'Test plan', kind: 'markdown', snapshot: true })
    expect(plan.cache?.body).toBe('# Plan')
  })

  it('refuse a plan too large to show', () => {
    const huge = structuredClone(recordedPlan)
    huge.plan.cache.body = 'x'.repeat(PLAN_MAX_CHARS + 1)
    expect(RoomPlanSchema.safeParse(huge).success).toBe(false)
  })

  it("leave a file's path and its uploader's id out", () => {
    const { files } = RoomFilesSchema.parse({ page: { files: [recordedFile], has_more: false, status: 'x' } }).page
    expect(JSON.stringify(files)).not.toContain('someone')
    expect(files[0]).not.toHaveProperty('path')
    expect(files[0]).not.toHaveProperty('uploader_id')
    expect(files[0]).not.toHaveProperty('local_artifact_id')
  })

  /** The store's answer is a whole artifact with its local path in it; only the id the send attaches may cross. */
  it("leaves a stored file's everything-but-the-id out", () => {
    // Invented values in the recorded answer's shape.
    const artifactId = 'art-000000000000000000000001'
    const stored = ArtifactStoreSchema.parse({
      artifact: {
        id: artifactId,
        profile: 'default',
        chat_id: 'a-room',
        name: 'plan.md',
        mime: 'text/markdown',
        bytes: 17,
        sha256: 'a-hash',
        path: `${HOME}\\AppData\\Local\\jam\\cfg\\artifacts\\plan.md`,
        remote_id: null,
        has_thumb: false,
        created_by: '',
        origin: 'plan',
        created_at: 1760000000000,
      },
    })
    expect(JSON.stringify(stored)).not.toContain('someone')
    expect(stored).toEqual({ artifact: { id: artifactId } })
  })

  it("leave a participant's avatar address out", () => {
    const owner = { id: 'u', handle: 'h', name: 'n', kind: 'User', role: 'owner', status: 'active', avatar_url: 'x' }
    expect(ParticipantsSchema.parse({ participants: [owner] }).participants[0]).not.toHaveProperty('avatar_url')
  })

  it('take only UUIDs for room ids', () => {
    expect(ROOM_ID.test('5b0f6c2e-8d1a-4c3b-9e7f-2a4d6b8c0e11')).toBe(true)
    for (const bad of [
      '',
      '5b0f6c2e',
      '../rooms',
      '5b0f6c2e-8d1a-4c3b-9e7f-2a4d6b8c0e11/x',
      'zzzzzzzz-8d1a-4c3b-9e7f-2a4d6b8c0e11',
    ]) {
      expect(ROOM_ID.test(bad), bad).toBe(false)
    }
  })
})

describe('DaemonInfoSchema (ping)', () => {
  it.each([
    [
      'nulls where the daemon has no value yet',
      { version: '0.4.11', wire: null, update: { latest: null, state: 'current' } },
    ],
    ['a malformed wire version and update', { version: '0.4.11', wire: 'twenty-four', update: 7 }],
    ['nothing but a version', { version: '0.4.11' }],
  ])('still identifies the daemon with %s', (_label, answer) => {
    const parsed = DaemonInfoSchema.safeParse(answer)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.version).toBe('0.4.11')
  })

  it('counts a malformed wire version as not stated', () => {
    expect(DaemonInfoSchema.parse({ version: '1', wire: 'x' }).wire).toBeNull()
  })

  it.each([
    ['no version', { wire: 24 }],
    ['a version that is not text', { version: 4, wire: 24 }],
    ['not an object', 'jamd'],
  ])('does not take an answer with %s for the daemon', (_label, answer) => {
    expect(DaemonInfoSchema.safeParse(answer).success).toBe(false)
  })
})

/**
 * The host peers behind Sessions (GET /v1/list), in the shape recorded on 2026-09-20 with invented contents. These
 * run the real validation boundary, which the screen's own tests cannot: they build rows the schema has already
 * passed, so nothing there would notice the schema being loosened or a nested read being hoisted out of its list.
 */
const recordedPeers = (over: Record<string, unknown> = {}, sessions?: unknown[]) => [
  {
    peer: {
      scope: 'atlas',
      profile: 'default',
      cwd: '/work/atlas',
      agent_id: '7a1d3c5e-2b4f-4a6c-8e0d-1f3a5c7e9b21',
      agent_name: 'Atlas',
      handle: 'someone/atlas',
      host: 'claudecode',
      started_at: 1789740000000,
      identity_class: 'owned',
      host_sessions: sessions ?? [
        { id: 'default', room: '', provider: 'claudecode', host_pid: 0, presence: 'unknown', binding: 'detached' },
        { id: 'default-a', room: 'a', provider: 'claudecode', host_pid: 24188, presence: 'live', binding: 'bound' },
      ],
    },
    state: 'connected',
    running: true,
    warning: '',
    ...over,
  },
]

describe('the host peers behind Sessions', () => {
  it('reads the recorded answer and keeps nothing the screen does not need', () => {
    const [peer] = toHostPeers(recordedPeers())
    expect(peer?.peer.agent_name).toBe('Atlas')
    expect(peer?.state).toBe('connected')
    expect(peer?.peer.host_sessions.map((one) => [one.id, one.host_pid, one.presence, one.binding])).toEqual([
      ['default', 0, 'unknown', 'detached'],
      ['default-a', 24188, 'live', 'bound'],
    ])
    // The machine's own working directory, and everything else the screen does not read, is dropped in the main
    // process and never reaches the page.
    for (const field of ['cwd', 'started_at', 'identity_class']) {
      expect(Object.hasOwn(peer?.peer ?? {}, field)).toBe(false)
    }
  })

  it("leaves out one session it cannot read and keeps the peer's others", () => {
    const [peer] = toHostPeers(
      recordedPeers({}, [
        { id: 'default', room: '', presence: 'unknown', binding: 'detached', host_pid: 0 },
        { room: 'a', presence: 'live' },
        { id: 'default-b', room: 'b', presence: 'live', binding: 'bound', host_pid: 9042 },
      ]),
    )
    expect(peer?.peer.host_sessions.map((one) => one.id)).toEqual(['default', 'default-b'])
  })

  it('leaves out one peer it cannot read and keeps the others', () => {
    const peers = toHostPeers([...recordedPeers(), { state: 'connected', running: true }])
    expect(peers).toHaveLength(1)
    expect(peers[0]?.peer.agent_name).toBe('Atlas')
  })

  // An answer of which nothing can be read is a changed answer, not an empty one: the screen must say so rather than
  // state that there are no sessions.
  it('refuses an answer whose every peer, or whose every session, has changed shape', () => {
    expect(() => toHostPeers([{ peer: { sessions: [] } }, { renamed_peer: {} }])).toThrow()
    expect(() => toHostPeers(recordedPeers({}, [{ room: 'a' }, { room: 'b' }]))).toThrow()
  })

  it('reads an answer with no peers at all, and a peer with no sessions, as exactly that', () => {
    expect(toHostPeers([])).toEqual([])
    expect(toHostPeers(recordedPeers({}, []))[0]?.peer.host_sessions).toEqual([])
  })
})

/**
 * The people Sonar discovers (GET /v1/listDiscovered), in the shape recorded on 2026-09-20 with an agent running.
 * These run the real validation boundary, which the screen's own tests cannot.
 */
const recordedSnapshot = (users: unknown[]) => ({
  snapshot: { discoverable: true, multicast: 'ok', share_room_titles: true, share_cost: true, users },
})

const recordedPerson = (over: Record<string, unknown> = {}, agents?: unknown[]) => ({
  deployment_scope: '3f5a7c9e1b3d4f5a8c7e9d1b3f5a7c9e',
  user_id: '1c3e5a79-2b4d-4f61-8a3c-5e7f9b1d3a52',
  owner_handle: 'someone',
  display_name: 'Someone',
  last_seen_ms: 1789763940000,
  online: true,
  origins: ['lan'],
  teams: [],
  agents: agents ?? [
    {
      agent_id: '7a1d3c5e-2b4f-4a6c-8e0d-1f3a5c7e9b21',
      handle: 'someone/atlas',
      name: 'Atlas',
      state: 'connected',
      activity: { kind: 'working' },
      tasks: { pending: 2, in_progress: 1, completed: 4 },
      cost: 1.82,
    },
  ],
  ...over,
})

describe('the people Sonar discovers', () => {
  it('reads the recorded answer and keeps nothing the screen does not need', () => {
    const snapshot = toDiscovered(recordedSnapshot([recordedPerson()]))
    expect(snapshot.discoverable).toBe(true)
    const [person] = snapshot.users
    expect(person?.display_name).toBe('Someone')
    expect(person?.agents[0]).toMatchObject({ name: 'Atlas', state: 'connected', cost: 1.82 })
    expect(person?.agentsOffered).toBe(1)
  })

  it('leaves out one agent it cannot read and counts what the answer held', () => {
    const snapshot = toDiscovered(
      recordedSnapshot([recordedPerson({}, [{ name: 'no id' }, { agent_id: 'a', name: 'Atlas' }])]),
    )
    expect(snapshot.users[0]?.agents.map((one) => one.name)).toEqual(['Atlas'])
    // The answer held two: a person whose agents this app cannot read has not advertised none.
    expect(snapshot.users[0]?.agentsOffered).toBe(2)
  })

  it('leaves out one person it cannot read, keeps the others, and counts what the answer held', () => {
    const snapshot = toDiscovered(recordedSnapshot([recordedPerson(), { display_name: 'No id' }]))
    expect(snapshot.users).toHaveLength(1)
    expect(snapshot.usersOffered).toBe(2)
  })

  // An answer of which nothing can be read is not an empty network. It is not refused either, because the
  // same answer still carries the settings Settings shows; what it held is counted so the screen can say so.
  it('counts the people it could not read rather than reporting an empty network', () => {
    const snapshot = toDiscovered(recordedSnapshot([{ renamed: true }, { renamed: true }]))
    expect(snapshot.users).toEqual([])
    expect(snapshot.usersOffered).toBe(2)
    // The settings the same answer carried are still readable.
    expect(snapshot.discoverable).toBe(true)
    expect(snapshot.share_room_titles).toBe(true)
  })

  it('reads an answer with nobody on the network as exactly that', () => {
    const snapshot = toDiscovered(recordedSnapshot([]))
    expect(snapshot.users).toEqual([])
    // Nobody nearby and nobody it could read are different things, and only this one is an empty network.
    expect(snapshot.usersOffered).toBe(0)
  })

  it('refuses an answer that is not a discovery snapshot at all', () => {
    expect(() => toDiscovered({ snapshot: { users: [] } })).toThrow()
    expect(() => toDiscovered({})).toThrow()
  })
})

/**
 * One agent's status (POST /v1/status), in the shape recorded on 2026-09-21 with invented contents. Its runtime block
 * is the one place the daemon hands over a command line, a working directory and an environment allow-list, so what
 * this app drops from it is what these tests are for.
 */
const recordedStatus = (over: Record<string, unknown> = {}) => ({
  status: {
    peer: {
      scope: 'atlas',
      profile: 'default',
      cwd: `${HOME}\\work\\atlas`,
      agent_id: '7a1d3c5e-2b4f-4a6c-8e0d-1f3a5c7e9b21',
      agent_name: 'Atlas',
      handle: 'someone/atlas',
      host: 'claudecode',
      started_at: 1789740000000,
      identity_class: 'owned',
      host_sessions: [
        {
          id: 'default',
          room: null,
          provider: 'claudecode',
          runtime: {
            template_id: 'owned/claude-code-cli',
            session_id: 'default',
            mode: 'owned',
            transport: 'stdio',
            spawn: {
              command: `${HOME}\\bin\\claude.exe`,
              args: ['--flag'],
              cwd: `${HOME}\\work\\atlas`,
              env_allowlist: ['SECRET_TOKEN'],
              auth_mode: 'subscription',
              runtime_version: '2.4.1',
              sandbox: { enabled: false, name: '', github_access: 'none', no_clone: true },
            },
            claude_code: {
              model: 'sonnet',
              reasoning_effort: 'medium',
              permission_mode: 'default',
              context_mode: 'local_config',
              strict_mcp_config: true,
              disallowed_tools: ['WebFetch'],
            },
            thread: { model: null, reasoning_effort: null, approval_policy: null, sandbox_mode: null },
          },
          presence: 'live',
          binding: 'bound',
        },
      ],
      ...over,
    },
    state: 'connected',
    running: true,
    warning: '',
  },
})

describe("one agent's status", () => {
  it('reads the recorded answer and keeps what the details show', () => {
    const status = toAgentStatus(AgentStatusSchema.parse(recordedStatus()))
    expect(status.name).toBe('Atlas')
    expect(status.state).toBe('connected')
    expect(status.running).toBe(true)
    expect(status.templates).toEqual(['owned/claude-code-cli'])
    expect(status.runtimes[0]?.runtime.claude_code?.model).toBe('sonnet')
  })

  it("leaves the machine's own path, command and environment out", () => {
    const status = toAgentStatus(AgentStatusSchema.parse(recordedStatus()))
    const json = JSON.stringify(status)
    // The handle is Jam's own and is shown, and it happens to carry the account name, so the check is on the paths
    // themselves rather than on that word.
    expect(json).not.toContain(HOME)
    expect(json).not.toContain('work')
    expect(json).not.toContain('claude.exe')
    expect(json).not.toContain('SECRET_TOKEN')
    expect(json).not.toContain('--flag')
    expect(status).not.toHaveProperty('cwd')
    expect(status.runtimes[0]?.runtime.spawn).not.toHaveProperty('command')
    expect(status.runtimes[0]?.runtime.spawn).not.toHaveProperty('cwd')
    expect(status.runtimes[0]?.runtime.spawn).not.toHaveProperty('args')
    expect(status.runtimes[0]?.runtime.spawn).not.toHaveProperty('env_allowlist')
  })

  it('leaves out one session it cannot read and keeps the rest of the agent', () => {
    const answer = recordedStatus()
    answer.status.peer.host_sessions = [{ room: 'a' }, ...answer.status.peer.host_sessions] as never
    const status = toAgentStatus(AgentStatusSchema.parse(answer))
    expect(status.runtimes).toHaveLength(1)
    expect(status.name).toBe('Atlas')
  })

  it('refuses an answer with no peer at all', () => {
    expect(AgentStatusSchema.safeParse({ status: { state: 'connected' } }).success).toBe(false)
  })
})
