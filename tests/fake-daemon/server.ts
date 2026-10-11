// The fake Jam daemon: an HTTP server on its own named pipe (Windows) or Unix socket, answering the routes this app uses from
// fixture files. Dev runs, the e2e suite and ui:check talk to it by default (README, "Develop"); nothing here reaches the
// live daemon or Band. It mirrors what the live daemon was seen to do while each fixture was recorded: an unknown route
// answers 404 with an empty body, a wrong method 405, a body missing a field 422 with serde's message, a room's reads
// answer per room (and as the daemon does for a room the account is not in), and /v1/events holds a chunked stream open,
// one JSON event per line.
// Node runs this file directly (type stripping), so it uses only erasable TypeScript.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

// Resolved from the repository root, the working directory of every runner (pnpm scripts, vitest, Playwright): Playwright
// loads this file as CommonJS, where import.meta does not exist.
export const FIXTURES_DIR = resolve(process.cwd(), 'tests', 'fake-daemon', 'fixtures')

interface RouteSpec {
  method: 'GET' | 'POST'
  /** Top-level fields a POST body must carry, in the order serde reports them missing. */
  required?: string[]
  /**
   * A room's read: the answer comes from `fixtures/room/<chat_id>/<route>.json`. For a room without one, `empty` answers
   * the route's own fixture (the live daemon answers such a room with empty lists) and `band-404` answers 500 with Band's
   * not-found error, as the live daemon did for a room its account is not in (2026-09-19).
   */
  room?: 'empty' | 'band-404'
  /**
   * A local agent's read (`{target: {profile, scope, handle}}`): the answer comes from
   * `fixtures/agent/<scope>/<route>.json`, or the route's own fixture for an agent without one.
   */
  agent?: true
}

/** The routes the fake answers, with the methods and required fields recorded from the live daemon. */
export const ROUTES: Record<string, RouteSpec> = {
  '/v1/ping': { method: 'GET' },
  '/v1/accounts': { method: 'GET' },
  '/v1/listExperiments': { method: 'GET' },
  '/v1/rooms': { method: 'POST', required: ['profile'] },
  '/v1/roomOrg': { method: 'POST', required: ['profile'] },
  '/v1/searchDirectory': { method: 'POST', required: ['profile', 'kind', 'q'] },
  '/v1/runtimePermissions': { method: 'POST', required: ['target', 'host_session'], agent: true },
  '/v1/agent-list': { method: 'POST', required: ['profile'] },
  '/v1/listTeams': { method: 'POST', required: ['profile'] },
  '/v1/list': { method: 'GET' },
  '/v1/listDiscovered': { method: 'GET' },
  '/v1/notificationPreferences': { method: 'POST' },
  '/v1/logConfig': { method: 'POST' },
  '/v1/runtimeDefaults': { method: 'POST' },
  '/v1/contactsOverview': { method: 'POST', required: ['profile'] },
  '/v1/dashboard': { method: 'POST', required: ['profile', 'range'] },
  '/v1/usageReport': { method: 'POST', required: ['req'] },
  '/v1/usageSessions': { method: 'POST', required: ['req'] },
  '/v1/roomParticipants': { method: 'POST', required: ['profile', 'chat_id'], room: 'band-404' },
  '/v1/roomMessageSnapshot': { method: 'POST', required: ['profile', 'chat_id'], room: 'empty' },
  '/v1/roomMessages': { method: 'POST', required: ['profile', 'chat_id', 'query'], room: 'empty' },
  '/v1/getRoomPlan': { method: 'POST', required: ['chat_id'], room: 'empty' },
  '/v1/roomFileList': { method: 'POST', required: ['profile', 'chat_id'], room: 'empty' },
  '/v1/roomWorkLanes': { method: 'POST', required: ['profile', 'chat_id'], room: 'empty' },
  '/v1/getRoomBoard': { method: 'POST', required: ['profile', 'chat_id'], room: 'empty' },
  '/v1/roomWorkSnapshot': { method: 'POST', required: ['profile'] },
  '/v1/listSessions': { method: 'POST', required: ['target'], agent: true },
  '/v1/status': { method: 'POST', required: ['target'], agent: true },
  '/v1/defaultAgent': { method: 'POST', required: ['profile'] },
  '/v1/artifactDeletePreview': { method: 'POST', required: ['profile', 'id'] },
  // Writes: the fake records the request (the tests read it) and answers as the live daemon did. None of them changes
  // what a read answers afterwards, with four exceptions, marked below.
  '/v1/roomSend': { method: 'POST', required: ['profile', 'chat_id', 'content', 'mentions'] },
  '/v1/decideRuntimePermission': { method: 'POST', required: ['target', 'id', 'outcome'] },
  '/v1/kickoffWork': { method: 'POST', required: ['profile', 'agent', 'message'] },
  '/v1/setDefaultAgent': { method: 'POST', required: ['profile', 'peer'] },
  '/v1/artifactSaveCopy': { method: 'POST', required: ['profile', 'id'] },
  '/v1/artifactDelete': { method: 'POST', required: ['profile', 'id', 'impact_token'] },
  '/v1/interruptRuntimeTurn': { method: 'POST', required: ['target', 'host_session'] },
  '/v1/setInboxItemState': { method: 'POST', required: ['profile', 'item_id', 'read', 'done'] },
  '/v1/setPlan': { method: 'POST', required: ['profile', 'chat_id', 'source'] },
  '/v1/artifactStore': { method: 'POST', required: ['profile', 'source', 'name'] },
  '/v1/createRoom': { method: 'POST', required: ['profile'] },
  '/v1/renameRoom': { method: 'POST', required: ['profile', 'chat_id', 'title'] },
  '/v1/deleteRoom': { method: 'POST', required: ['profile', 'chat_id'] },
  '/v1/addRoomParticipant': { method: 'POST', required: ['profile', 'chat_id', 'participant_id'] },
  '/v1/removeRoomParticipant': { method: 'POST', required: ['profile', 'chat_id', 'participant_id'] },
  '/v1/setRoomOrg': { method: 'POST', required: ['profile', 'org'] },
  '/v1/setNotificationPreferences': { method: 'POST', required: ['preferences'] },
  '/v1/createTeam': { method: 'POST', required: ['profile', 'draft'] },
  '/v1/updateTeam': { method: 'POST', required: ['profile', 'team_id', 'draft'] },
}

/** Band's answer, through the daemon, for a room the account is not in (the request id is invented). */
const BAND_NOT_FOUND_TEXT =
  'band api: HTTP 404: {"error":{"code":"not_found","message":"Resource not found","request_id":"0f1e2d3c4b5a69788796a5b4c3d2e1f0"}}'
const BAND_NOT_FOUND = JSON.stringify({ error: BAND_NOT_FOUND_TEXT, control_error: { Internal: BAND_NOT_FOUND_TEXT } })

export interface FakeRequest {
  method: string
  route: string
  body: unknown
}

export interface FakeDaemon {
  endpoint: string
  /** Every request received, oldest first. */
  requests: FakeRequest[]
  /** Replaces a route's answer (the JSON body), or restores the fixture file with undefined. */
  setAnswer(route: string, body: unknown): void
  /** Replaces one room's answer for a room route, or restores its fixture (if any) with undefined. */
  setRoomAnswer(roomId: string, route: string, body: unknown): void
  /** Replaces one local agent's answer for an agent route (by its scope), or restores its fixture with undefined. */
  setAgentAnswer(scope: string, route: string, body: unknown): void
  /** Makes the route answer 404, as a daemon without it would. setAnswer brings it back. */
  removeRoute(route: string): void
  /** Makes the route refuse with this status and JSON body, as a daemon that fails would. setAnswer brings it back. */
  failRoute(route: string, status: number, body: unknown): void
  /** Turns an experiment on or off in the listExperiments answer. */
  setExperiment(key: string, state: 'enabled' | 'disabled'): void
  /** Sends one event to every open /v1/events stream, as a JSON line. */
  emit(event: Record<string, unknown>): void
  /** Sends the events a new stream receives first (the person's inbox) to every open stream again. */
  emitFirst(): void
  /** Delays every answer by this long (0: none), as a busy daemon would; the event stream is not delayed. */
  setLatency(ms: number): void
  /** Stops answering (the app should report the daemon offline) until resume(). */
  pause(): Promise<void>
  resume(): Promise<void>
  close(): Promise<void>
}

export function loadFixtures(dir: string = FIXTURES_DIR): Map<string, unknown> {
  if (!existsSync(dir)) throw new Error(`no fixtures at ${dir}: run the fake daemon from the repository root`)
  const answers = new Map<string, unknown>()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    answers.set(`/v1/${file.slice(0, -'.json'.length)}`, JSON.parse(readFileSync(join(dir, file), 'utf8')))
  }
  // The daemon says where it is installed, and the app reads Jam's user guide from beside it. Jam's own guide is
  // never in this project, so the fake daemon points at a fixture guide of invented text instead.
  const ping = answers.get('/v1/ping') as { executable?: string } | undefined
  if (ping) ping.executable = join(dir, 'guide', 'jamd')
  return answers
}

/** Each room's own answers, from `fixtures/room/<room id>/<route>.json`, keyed `<room id> <route>`. */
export function loadRoomFixtures(dir: string = join(FIXTURES_DIR, 'room')): Map<string, unknown> {
  const answers = new Map<string, unknown>()
  if (!existsSync(dir)) return answers
  for (const roomId of readdirSync(dir)) {
    for (const file of readdirSync(join(dir, roomId))) {
      if (!file.endsWith('.json')) continue
      const route = `/v1/${file.slice(0, -'.json'.length)}`
      answers.set(`${roomId} ${route}`, JSON.parse(readFileSync(join(dir, roomId, file), 'utf8')))
    }
  }
  return answers
}

/** Each local agent's own answers, from `fixtures/agent/<scope>/<route>.json`, keyed `<scope> <route>`. */
export function loadAgentFixtures(dir: string = join(FIXTURES_DIR, 'agent')): Map<string, unknown> {
  return loadRoomFixtures(dir)
}

/**
 * The events the stream sends as soon as a client opens it, from `fixtures/events/*.json` in name order: the live
 * daemon sends the person's inbox then (recorded 2026-09-19), before anything changes.
 */
export function loadEventFixtures(dir: string = join(FIXTURES_DIR, 'events')): Record<string, unknown>[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .toSorted()
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>)
}

function newEndpoint(): string {
  const id = randomUUID().slice(0, 8)
  return process.platform === 'win32' ? `\\\\.\\pipe\\jamr-fake-${id}` : join(tmpdir(), `jamr-fake-${id}.sock`)
}

export interface FakeDaemonOptions {
  /** Answers to use instead of the fixture files, by route. */
  answers?: Record<string, unknown>
  /** The events a new stream receives first, instead of `fixtures/events/`. */
  events?: Record<string, unknown>[]
  /** A fixed endpoint (dev runs keep one across restarts); a fresh one by default. */
  endpoint?: string
}

export async function startFakeDaemon(options: FakeDaemonOptions = {}): Promise<FakeDaemon> {
  const fixtures = loadFixtures()
  const answers = new Map(fixtures)
  for (const [route, body] of Object.entries(options.answers ?? {})) answers.set(route, body)
  const roomFixtures = loadRoomFixtures()
  const roomAnswers = new Map(roomFixtures)
  const agentFixtures = loadAgentFixtures()
  const agentAnswers = new Map(agentFixtures)
  const firstEvents = options.events ?? loadEventFixtures()
  /** Routes made to answer 404, as a daemon without them would (removeRoute), until setAnswer brings them back. */
  const removed = new Set<string>()
  /** Routes made to refuse (failRoute): the status and the body they answer with, until setAnswer clears them. */
  const failing = new Map<string, { status: number; body: unknown }>()
  const endpoint = options.endpoint ?? newEndpoint()
  const requests: FakeRequest[] = []
  const streams = new Set<ServerResponse>()
  let server: Server | null = null
  let latency = 0
  const delayed = new Set<ReturnType<typeof setTimeout>>()

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    if (latency > 0 && !(req.url ?? '').startsWith('/v1/events')) {
      req.pause()
      const timer = setTimeout(() => {
        delayed.delete(timer)
        if (!res.destroyed) answer(req, res)
      }, latency)
      delayed.add(timer)
      return
    }
    answer(req, res)
  }

  const answer = (req: IncomingMessage, res: ServerResponse) => {
    const route = (req.url ?? '').split('?')[0] ?? ''
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => (raw += chunk))
    req.on('end', () => {
      let body: unknown = undefined
      if (raw) {
        try {
          body = JSON.parse(raw)
        } catch {
          body = raw
        }
      }
      requests.push({ method: req.method ?? '', route, body })

      if (route === '/v1/events') {
        if (req.method !== 'GET') return end(res, 405)
        res.writeHead(200, { 'transfer-encoding': 'chunked' })
        res.flushHeaders()
        streams.add(res)
        res.on('close', () => streams.delete(res))
        for (const event of firstEvents) res.write(`${JSON.stringify(event)}\n`)
        return
      }
      const spec = ROUTES[route]
      if (!spec || removed.has(route) || (!answers.has(route) && spec.room !== 'band-404')) return end(res, 404)
      if (req.method !== spec.method) return end(res, 405)
      const failure = failing.get(route)
      if (failure) return end(res, failure.status, 'application/json', JSON.stringify(failure.body))
      if (spec.method === 'POST') {
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          return end(res, 400, 'text/plain; charset=utf-8', 'Failed to parse the request body as JSON')
        }
        const missing = (spec.required ?? []).find((field) => !(field in (body as Record<string, unknown>)))
        if (missing) {
          return end(
            res,
            422,
            'text/plain; charset=utf-8',
            `Failed to deserialize the JSON body into the target type: missing field \`${missing}\` at line 1 column ${raw.length}`,
          )
        }
      }
      // The first write the fake keeps: the app reads the room organisation back the moment it has written it, so a fake
      // that dropped the write would show the app undoing what the person just did, which the live daemon does not.
      if (route === '/v1/setRoomOrg') answers.set('/v1/roomOrg', { org: (body as Record<string, unknown>).org })
      // The second: a room's plan changes the moment a file is set as its source. The label is the chosen file's own
      // name, which is the daemon's own default; the paths are whatever the chooser sent and the app's schema drops
      // them on the read, as it does the daemon's.
      if (route === '/v1/setPlan') {
        const source = String((body as Record<string, unknown>).source)
        roomAnswers.set(`${String((body as Record<string, unknown>).chat_id)} /v1/getRoomPlan`, {
          plan: {
            chat_id: (body as Record<string, unknown>).chat_id,
            source: { raw: source, canonical: source, label: basename(source), kind: 'markdown' },
            cache: { body: '# The chosen plan\n\nRead from the file the person set.', content_type: 'markdown' },
            last_error: '',
            watch_error: '',
            updated_at: 1,
            doc_rev: 1,
          },
        })
      }
      if (spec.room) {
        const roomId = String((body as Record<string, unknown>).chat_id)
        const key = `${roomId} ${route}`
        if (roomAnswers.has(key)) return end(res, 200, 'application/json', JSON.stringify(roomAnswers.get(key)))
        if (spec.room === 'band-404') return end(res, 500, 'application/json', BAND_NOT_FOUND)
      }
      // A write with an answer of its own, which changes no read: storing a file answers the artifact's id, and the
      // id is what the send then attaches, so a fake that answered a fixture's id for every file would let the wrong
      // wiring pass. The id is derived from the bytes sent, so each distinct content has its own id and a test can
      // name the id it expects. The answer carries no path: the real one does, and the app's schema drops it.
      if (route === '/v1/artifactStore') {
        const source = (body as Record<string, unknown>).source
        const value =
          typeof source === 'object' && source !== null ? String((source as Record<string, unknown>).value) : ''
        const id = 'art-' + createHash('sha256').update(value).digest('hex').slice(0, 24)
        return end(
          res,
          200,
          'application/json',
          JSON.stringify({
            artifact: { id, name: (body as Record<string, unknown>).name, bytes: Buffer.from(value, 'base64').length },
          }),
        )
      }
      // The third and fourth writes the fake keeps: a team made or saved shows in Teams at once, as it does live, so a
      // fake that dropped it would show New team doing nothing. Band refuses a team with no agent, in its own words.
      if (route === '/v1/createTeam' || route === '/v1/updateTeam') {
        const sent = body as Record<string, unknown>
        const draft = (typeof sent.draft === 'object' && sent.draft !== null ? sent.draft : {}) as Record<
          string,
          unknown
        >
        const agentIds = Array.isArray(draft.agent_ids) ? draft.agent_ids : []
        if (agentIds.length === 0) {
          const said = 'Choose at least one agent for the team.'
          return end(res, 400, 'application/json', JSON.stringify({ error: said, control_error: { Invalid: said } }))
        }
        const listed = answers.get('/v1/listTeams') as { teams: Record<string, unknown>[] }
        const id =
          route === '/v1/updateTeam'
            ? String(sent.team_id)
            : createHash('sha256')
                .update(String(draft.name))
                .digest('hex')
                .slice(0, 32)
                .replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-')
        const before = listed.teams.find((team) => team.id === id)
        if (route === '/v1/updateTeam' && !before) return end(res, 404)
        const team = {
          ...(before ?? { template_id: null, created_at_ms: 1790000000000 }),
          id,
          profile: sent.profile,
          name: draft.name,
          description: draft.description,
          guidelines: draft.guidelines,
          agent_ids: agentIds,
          role_ids: Array.isArray(draft.role_ids) ? draft.role_ids : [],
          updated_at_ms: 1790000000000,
        }
        answers.set('/v1/listTeams', {
          teams: before ? listed.teams.map((one) => (one.id === id ? team : one)) : [...listed.teams, team],
        })
        return end(res, 200, 'application/json', JSON.stringify({ team }))
      }
      if (spec.agent) {
        const target = (body as Record<string, unknown>).target
        const scope = typeof target === 'object' && target !== null ? (target as Record<string, unknown>).scope : null
        const key = `${String(scope)} ${route}`
        if (agentAnswers.has(key)) return end(res, 200, 'application/json', JSON.stringify(agentAnswers.get(key)))
      }
      end(res, 200, 'application/json', JSON.stringify(answers.get(route)))
    })
    req.resume() // a delayed request was paused until now
  }

  const listen = () =>
    new Promise<void>((done, reject) => {
      if (process.platform !== 'win32') rmSync(endpoint, { force: true })
      server = createServer(handle)
      server.once('error', reject)
      server.listen(endpoint, () => done())
    })

  const stop = () =>
    new Promise<void>((done) => {
      for (const timer of delayed) clearTimeout(timer)
      delayed.clear()
      for (const stream of streams) stream.destroy()
      streams.clear()
      if (!server) return done()
      server.close(() => done())
      server.closeAllConnections()
      server = null
    })

  await listen()

  return {
    endpoint,
    requests,
    setAnswer: (route, body) => {
      removed.delete(route)
      failing.delete(route)
      if (body === undefined) {
        if (fixtures.has(route)) answers.set(route, fixtures.get(route))
        else answers.delete(route)
      } else answers.set(route, body)
    },
    setRoomAnswer: (roomId, route, body) => {
      const key = `${roomId} ${route}`
      if (body === undefined) {
        if (roomFixtures.has(key)) roomAnswers.set(key, roomFixtures.get(key))
        else roomAnswers.delete(key)
      } else roomAnswers.set(key, body)
    },
    setAgentAnswer: (scope, route, body) => {
      const key = `${scope} ${route}`
      if (body === undefined) {
        if (agentFixtures.has(key)) agentAnswers.set(key, agentFixtures.get(key))
        else agentAnswers.delete(key)
      } else agentAnswers.set(key, body)
    },
    removeRoute: (route) => {
      removed.add(route)
    },
    failRoute: (route, status, body) => {
      failing.set(route, { status, body })
    },
    setExperiment: (key, state) => {
      const current = answers.get('/v1/listExperiments') as {
        snapshot: { revision?: number; experiments: { key: string; state: string }[] }
      }
      const next = structuredClone(current)
      const experiment = next.snapshot.experiments.find((item) => item.key === key)
      if (!experiment) throw new Error(`no experiment ${key} in the fixture`)
      experiment.state = state
      next.snapshot.revision = (next.snapshot.revision ?? 0) + 1
      answers.set('/v1/listExperiments', next)
    },
    emit: (event) => {
      const line = `${JSON.stringify(event)}\n`
      for (const stream of streams) stream.write(line)
    },
    emitFirst: () => {
      for (const event of firstEvents) for (const stream of streams) stream.write(`${JSON.stringify(event)}\n`)
    },
    setLatency: (ms) => {
      latency = ms
    },
    pause: stop,
    resume: listen,
    close: async () => {
      await stop()
      if (process.platform !== 'win32') rmSync(endpoint, { force: true })
    },
  }
}

function end(res: ServerResponse, status: number, contentType?: string, text?: string): void {
  if (contentType) res.writeHead(status, { 'content-type': contentType })
  else res.writeHead(status)
  res.end(text ?? '')
}
