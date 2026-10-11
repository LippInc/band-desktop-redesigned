import { BUILT_AGAINST, DaemonInfoSchema, type DaemonInfo, type InboxRead } from '@shared/daemon'
import type {
  DaemonErrorCode,
  DaemonEvent,
  DaemonInput,
  DaemonOperationName,
  DaemonOutput,
  DaemonStatus,
} from '@shared/daemon-api'
import { EventLineParser } from './events'
import { ForbiddenRouteError } from './forbidden'
import { OPERATIONS, OperationInputError } from './operations'
import { candidateEndpoints, openStream, request, TransportError, type StreamHandle } from './transport'

/** An operation the daemon could not carry out, with a code the page turns into the right state (`[jam:<code>] text`). */
export class DaemonError extends Error {
  constructor(
    readonly code: DaemonErrorCode,
    message: string,
  ) {
    super(`[jam:${code}] ${message}`)
    this.name = 'DaemonError'
  }
}

export interface DaemonClientOptions {
  /**
   * A fixed endpoint instead of discovery: the fake daemon in dev runs and checks (JAMR_DAEMON_ENDPOINT). The main process
   * passes one only in unpackaged runs, so a packaged build always talks to the live daemon.
   */
  endpoint?: string
  onStatus?: (status: DaemonStatus) => void
  onEvent?: (event: DaemonEvent) => void
  log?: (line: string) => void
  /** Test seams. */
  discover?: () => string[]
  now?: () => number
  timings?: Partial<DaemonTimings>
}

export interface DaemonTimings {
  /** How long an endpoint being tried may take to answer /v1/ping before the next one is tried. */
  discoveryPingMs: number
  /** How long the connected daemon may take to answer the health check. A busy daemon can be slow; see #checkHealth. */
  healthPingMs: number
  /** The health check's interval while connected, and while no daemon answers. */
  healthConnectedMs: number
  healthOfflineMs: number
}

const TIMINGS: DaemonTimings = {
  discoveryPingMs: 1_500,
  healthPingMs: 5_000,
  healthConnectedMs: 15_000,
  healthOfflineMs: 4_000,
}
const DEFAULT_TIMEOUT_MS = 15_000
const EVENTS_RETRY_MAX_MS = 30_000

/**
 * The main process's handle on the Jam daemon. It finds the daemon (listing jam-* pipes or the socket and confirming each
 * with /v1/ping), runs named operations, follows the event stream and reports whether the daemon is there. It never
 * starts, stops or reconfigures the daemon: when none answers, the app says so and points to the official app.
 */
export class DaemonClient {
  readonly #options: DaemonClientOptions
  readonly #timings: DaemonTimings
  #status: DaemonStatus = { state: 'connecting' }
  #endpoint: string | null = null
  #connecting: Promise<string | null> | null = null
  #health: ReturnType<typeof setTimeout> | undefined
  #slowPings = 0
  /** Counts connections found and lost, so an answer that arrives late is never applied to a newer connection. */
  #connection = 0
  #stream: StreamHandle | null = null
  #streamRetry: ReturnType<typeof setTimeout> | undefined
  #streamBackoff = 1_000
  #stopped = false
  /**
   * Each account's inbox as the stream last sent it (the daemon sends one when the stream opens and whenever it
   * changes), or `changed` when the last one did not fit its schema. Forgotten when the stream ends or the daemon goes
   * away, so the page never shows a stale one.
   */
  readonly #inbox = new Map<string, InboxRead>()

  constructor(options: DaemonClientOptions = {}) {
    this.#options = options
    this.#timings = { ...TIMINGS, ...options.timings }
  }

  status(): DaemonStatus {
    return this.#status
  }

  /** The account's latest inbox from the stream, or null until the daemon has sent one on this connection. */
  inbox(profile: string): InboxRead | null {
    return this.#inbox.get(profile) ?? null
  }

  /** Finds the daemon now (again), then keeps checking on it. Resolves with the new status. */
  async start(): Promise<DaemonStatus> {
    this.#stopped = false
    await this.#connect()
    this.#scheduleHealth()
    return this.#status
  }

  /** Stops for good (until start): no request, status or event comes from this client afterwards. */
  stop(): void {
    this.#stopped = true
    this.#endpoint = null
    clearTimeout(this.#health)
    clearTimeout(this.#streamRetry)
    this.#stream?.close()
    this.#stream = null
    this.#inbox.clear()
  }

  /**
   * Where the running daemon says it is installed, from its own ping answer. This is the one value read outside the
   * page's schema, which drops it on purpose: a path from this machine is not something a page needs, so this never
   * crosses to the page and no IPC channel returns it. Only the main process uses it, to find Jam's user guide
   * beside the daemon (`src/main/guide.ts`).
   */
  async installPath(): Promise<string | null> {
    if (this.#stopped) return null
    const endpoint = this.#endpoint ?? (await this.#connect())
    if (!endpoint) return null
    try {
      const response = await request(endpoint, { method: 'GET', path: '/v1/ping', timeoutMs: DEFAULT_TIMEOUT_MS })
      if (response.status !== 200) return null
      const answer = JSON.parse(response.body) as { executable?: unknown }
      return typeof answer.executable === 'string' && answer.executable !== '' ? answer.executable : null
    } catch {
      return null
    }
  }

  /**
   * Where one of a room's files is stored on this computer, and the checksum the daemon recorded for it (POST
   * /v1/artifactGet), for the main process alone: Open, Reveal and Verify need them, and a path the daemon gives never
   * reaches the page. It is not a named operation for that reason: every named operation has a channel the page can
   * call, and this answer carries a path. `client.test.ts` pins the operation table's own routes, not this one.
   */
  async artifactFile(
    profile: string,
    id: string,
  ): Promise<{ path: string; sha256: string | null } | null | 'unavailable'> {
    if (this.#stopped) return 'unavailable'
    const endpoint = this.#endpoint ?? (await this.#connect())
    if (!endpoint) return 'unavailable'
    try {
      const response = await request(endpoint, {
        method: 'POST',
        path: '/v1/artifactGet',
        body: { profile, id },
        timeoutMs: DEFAULT_TIMEOUT_MS,
      })
      // 404 is the daemon saying it has no such artifact; anything else is the daemon not answering properly.
      if (response.status === 404) return null
      if (response.status !== 200) return 'unavailable'
      const answer = JSON.parse(response.body) as { artifact?: { path?: unknown; sha256?: unknown } }
      const path = answer.artifact?.path
      const sha256 = answer.artifact?.sha256
      if (typeof path !== 'string' || path === '') return null
      return { path, sha256: typeof sha256 === 'string' && sha256 !== '' ? sha256 : null }
    } catch {
      return 'unavailable'
    }
  }

  /**
   * Sets a room's plan from a local Markdown file (POST /v1/setPlan), for the main process alone: the plan's file
   * is chosen in a dialog here, so the path this app sends never comes from the page. It is not a named operation
   * for that reason - every named operation has a channel the page can call, and this one's input is a path - and
   * it is named in the README's own list of writes instead (`client.test.ts` pins the two together).
   */
  async setPlan(profile: string, roomId: string, source: string): Promise<true | 'unavailable'> {
    if (this.#stopped) return 'unavailable'
    const endpoint = this.#endpoint ?? (await this.#connect())
    if (!endpoint) return 'unavailable'
    try {
      const response = await request(endpoint, {
        method: 'POST',
        path: '/v1/setPlan',
        body: { profile, chat_id: roomId, source },
        timeoutMs: DEFAULT_TIMEOUT_MS,
      })
      // The daemon's answer for this write was never recorded; a 200 is all this app claims to know.
      return response.status === 200 ? true : 'unavailable'
    } catch {
      return 'unavailable'
    }
  }

  async run<K extends DaemonOperationName>(name: K, rawInput: unknown): Promise<DaemonOutput<K>> {
    const spec = OPERATIONS[name]
    if (!spec) throw new DaemonError('input', 'Unknown operation')
    let input: DaemonInput<K>
    try {
      input = spec.input(rawInput)
    } catch (error) {
      throw new DaemonError('input', error instanceof OperationInputError ? error.message : 'Invalid input')
    }
    if (this.#stopped) throw new DaemonError('offline', 'The connection to the Band daemon is closed')
    const endpoint = this.#endpoint ?? (await this.#connect())
    if (!endpoint) throw new DaemonError('offline', 'The Band daemon is not running')

    let response
    try {
      response = await request(endpoint, {
        method: spec.method,
        path: spec.route,
        body: spec.method === 'POST' ? (spec.body ? spec.body(input) : {}) : undefined,
        timeoutMs: spec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      })
    } catch (error) {
      if (error instanceof ForbiddenRouteError) throw new DaemonError('input', error.message)
      if (error instanceof TransportError && error.reason === 'timeout') {
        throw new DaemonError('timeout', 'The Band daemon took too long to answer')
      }
      // The daemon answered, but with more than this app holds in memory: that answer is unusable, the daemon is fine.
      if (error instanceof TransportError && error.reason === 'too-large') {
        throw new DaemonError('invalid-answer', `The daemon's answer to ${spec.route} is too large`)
      }
      if (this.#stopped) throw new DaemonError('offline', 'The connection to the Band daemon is closed')
      this.#lost('not-answering')
      throw new DaemonError('offline', 'The Band daemon stopped answering')
    }

    // 404 and 405: this daemon has no such route (older or newer than this app). The screen that needs it degrades.
    if (response.status === 404 || response.status === 405) {
      throw new DaemonError('unsupported', `This version of the Band daemon does not offer ${spec.route}`)
    }
    if (response.status < 200 || response.status >= 300) {
      throw new DaemonError('rejected', spec.rejection ?? rejectionText(response.body, response.status))
    }
    let json: unknown
    try {
      json = JSON.parse(response.body)
    } catch {
      throw new DaemonError('invalid-answer', `The daemon's answer to ${spec.route} was not JSON`)
    }
    try {
      return spec.output(json)
    } catch (error) {
      this.#options.log?.(`answer from ${spec.route} did not match its schema: ${summarise(error)}`)
      throw new DaemonError('invalid-answer', `The daemon's answer to ${spec.route} has changed`)
    }
  }

  #connect(): Promise<string | null> {
    this.#connecting ??= this.#discover().finally(() => {
      this.#connecting = null
    })
    return this.#connecting
  }

  /**
   * Tries every endpoint quickly. One that is there but slow may be a busy daemon, so each slow one gets the health check's
   * longer allowance once; if one stays slow the daemon is reported as not answering (it is there), otherwise as not found.
   */
  async #discover(): Promise<string | null> {
    const candidates = this.#options.endpoint
      ? [this.#options.endpoint]
      : (this.#options.discover ?? (() => candidateEndpoints()))()
    const slow: string[] = []
    for (const endpoint of candidates) {
      const answer = await ping(endpoint, this.#timings.discoveryPingMs)
      if (this.#stopped) return null
      if (answer === 'slow') slow.push(endpoint)
      else if (answer !== null) return this.#found(endpoint, answer)
    }
    for (const endpoint of slow) {
      const answer = await ping(endpoint, this.#timings.healthPingMs)
      if (this.#stopped) return null
      if (answer !== null && answer !== 'slow') return this.#found(endpoint, answer)
    }
    this.#endpoint = null
    this.#setStatus({ state: 'offline', reason: slow.length ? 'not-answering' : 'not-found' })
    return null
  }

  #found(endpoint: string, info: DaemonInfo): string {
    this.#endpoint = endpoint
    this.#connection += 1
    this.#slowPings = 0
    this.#connected(info)
    this.#openEvents()
    return endpoint
  }

  #connected(info: DaemonInfo): void {
    this.#setStatus({
      state: 'connected',
      version: info.version,
      wire: info.wire ?? null,
      wireMatches: info.wire === BUILT_AGAINST.wire,
    })
  }

  #lost(reason: 'not-answering' | 'not-found'): void {
    this.#endpoint = null
    this.#connection += 1
    this.#stream?.close()
    this.#stream = null
    this.#inbox.clear()
    this.#setStatus({ state: 'offline', reason })
  }

  #scheduleHealth(soon = false): void {
    clearTimeout(this.#health)
    if (this.#stopped) return
    const delay =
      this.#status.state === 'connected' && !soon ? this.#timings.healthConnectedMs : this.#timings.healthOfflineMs
    this.#health = setTimeout(() => void this.#checkHealth(), delay)
    this.#health.unref?.()
  }

  /**
   * Pings the connected daemon, or looks for one. A daemon that is busy can answer slowly without having gone away, so one
   * slow answer is only asked again soon; a second slow answer in a row, or no answer at all, counts as not answering.
   * An answer also carries the running version, so a daemon updated in the meantime is shown as it is now.
   */
  async #checkHealth(): Promise<void> {
    if (this.#stopped) return
    const endpoint = this.#endpoint
    const connection = this.#connection
    let soon = false
    if (endpoint) {
      const answer = await ping(endpoint, this.#timings.healthPingMs)
      if (this.#stopped) return
      // If the daemon was lost (and perhaps found again, at the same endpoint) while the ping was out, that newer state stands.
      const current = this.#connection === connection
      if (current && answer === 'slow' && this.#slowPings === 0) {
        this.#slowPings = 1
        soon = true
      } else if (current && (answer === null || answer === 'slow')) {
        this.#lost('not-answering')
      } else if (current && answer !== null && answer !== 'slow') {
        this.#slowPings = 0
        this.#connected(answer)
      }
    } else {
      await this.#connect()
    }
    this.#scheduleHealth(soon)
  }

  #openEvents(): void {
    if (this.#stopped || this.#stream || !this.#endpoint || !this.#options.onEvent) return
    const parser = new EventLineParser(this.#options.now ?? Date.now)
    const endpoint = this.#endpoint
    this.#stream = openStream(
      endpoint,
      '/v1/events',
      (text) => {
        if (this.#stopped) return
        this.#streamBackoff = 1_000
        for (const { inbox, ...event } of parser.push(text)) {
          // The inbox is kept here, before the page hears the event and reads it (getInbox); the page gets the name only.
          if (inbox) this.#inbox.set(inbox.profile, inbox.read)
          this.#options.onEvent?.(event)
        }
      },
      (reason) => {
        this.#stream = null
        this.#inbox.clear()
        if (this.#stopped) return
        this.#options.log?.(`event stream ended (${reason})`)
        // Reopen with backoff while the daemon is still there; the health check handles a daemon that went away.
        clearTimeout(this.#streamRetry)
        this.#streamRetry = setTimeout(() => this.#openEvents(), this.#streamBackoff)
        this.#streamRetry.unref?.()
        this.#streamBackoff = Math.min(this.#streamBackoff * 2, EVENTS_RETRY_MAX_MS)
      },
    )
  }

  #setStatus(next: DaemonStatus): void {
    if (this.#stopped || JSON.stringify(next) === JSON.stringify(this.#status)) return
    this.#status = next
    this.#options.onStatus?.(next)
  }
}

/** The daemon's answer to /v1/ping; 'slow' when it did not answer in time; null when nothing like Jam's daemon answered. */
async function ping(endpoint: string, timeoutMs: number): Promise<DaemonInfo | 'slow' | null> {
  try {
    const response = await request(endpoint, { method: 'GET', path: '/v1/ping', timeoutMs })
    if (response.status !== 200) return null
    const parsed = DaemonInfoSchema.safeParse(JSON.parse(response.body))
    return parsed.success ? parsed.data : null
  } catch (error) {
    return error instanceof TransportError && error.reason === 'timeout' ? 'slow' : null
  }
}

/** The daemon explains a refusal in its body (a 422 names the field; a 400 or 404 carries `error`). Keep it short. */
function rejectionText(body: string, status: number): string {
  let text = body
  try {
    const json = JSON.parse(body) as { error?: unknown }
    if (typeof json.error === 'string') text = json.error
  } catch {
    // plain text, as the daemon's 422 messages are
  }
  text = text.replace(/\s+/g, ' ').trim().slice(0, 300)
  return text || `The daemon refused the request (${status})`
}

function summarise(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
    return error.issues
      .slice(0, 5)
      .map((issue: { path?: unknown[]; message?: string }) => `${(issue.path ?? []).join('.')}: ${issue.message}`)
      .join('; ')
  }
  return error instanceof Error ? error.message : String(error)
}
