import { existsSync, readdirSync } from 'node:fs'
import http from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { assertRouteAllowed } from './forbidden'

/**
 * HTTP over the daemon's local endpoint: the named pipe `\\.\pipe\jam-<hash>` on Windows, `~/.jam/jam.sock` on macOS and
 * Linux (README). Node reaches both through `socketPath`, so there is one transport for all
 * three platforms. Only the main process loads this file.
 */

export interface DaemonResponse {
  status: number
  contentType: string
  body: string
}

/** Answers larger than this are refused rather than held in memory. */
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

/** A pipe is jam- plus the install's hash (32 hex digits on 2026-09-18); the hash is never hard-coded. */
const JAM_PIPE = /^jam-[0-9a-f]{8,64}$/i

export class TransportError extends Error {
  constructor(
    message: string,
    readonly reason: 'unreachable' | 'timeout' | 'too-large',
  ) {
    super(message)
    this.name = 'TransportError'
  }
}

/**
 * Every endpoint a daemon could be listening on right now, most likely first. On macOS and Linux that is the socket in
 * $JAM_CONFIG_DIR (Jam's own variable, which its CLI honours too), then ~/.jam; every one is still confirmed with a ping.
 */
export function candidateEndpoints(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  listPipes: () => string[] = () => readdirSync('\\\\.\\pipe\\'),
): string[] {
  if (platform === 'win32') {
    let names: string[]
    try {
      names = listPipes()
    } catch {
      return []
    }
    return names.filter((name) => JAM_PIPE.test(name)).map((name) => `\\\\.\\pipe\\${name}`)
  }
  const dirs = [env.JAM_CONFIG_DIR, join(homedir(), '.jam')].filter((dir): dir is string => Boolean(dir))
  return [...new Set(dirs.map((dir) => join(dir, 'jam.sock')))].filter((socket) => existsSync(socket))
}

export interface RequestOptions {
  method: 'GET' | 'POST'
  path: `/v1/${string}`
  body?: unknown
  timeoutMs: number
}

/** One request/response exchange. Refuses a forbidden route before anything is sent. */
export function request(endpoint: string, { method, path, body, timeoutMs }: RequestOptions): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    // Inside the executor, so a forbidden route rejects like any other failure instead of throwing at the caller.
    assertRouteAllowed(path)
    const data = body === undefined ? undefined : JSON.stringify(body)
    const headers: Record<string, string | number> = { Host: 'jamd', Accept: 'application/json' }
    if (data !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(data)
    }
    const req = http.request({ socketPath: endpoint, path, method, headers }, (res) => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new TransportError(`The daemon's answer to ${path} was larger than allowed`, 'too-large'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          contentType: String(res.headers['content-type'] ?? ''),
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      )
      res.on('error', (error) => reject(asTransportError(error)))
    })
    req.setTimeout(timeoutMs, () =>
      req.destroy(new TransportError(`The daemon did not answer ${path} within ${timeoutMs} ms`, 'timeout')),
    )
    req.on('error', (error) => reject(asTransportError(error)))
    if (data !== undefined) req.write(data)
    req.end()
  })
}

function asTransportError(error: unknown): TransportError {
  if (error instanceof TransportError) return error
  return new TransportError(error instanceof Error ? error.message : String(error), 'unreachable')
}

export interface StreamHandle {
  close(): void
}

/**
 * Opens a long-lived GET (the daemon's /v1/events) and hands each chunk of text to `onText`. `onEnd` runs once when the
 * stream ends, fails or is closed.
 */
export function openStream(
  endpoint: string,
  path: `/v1/${string}`,
  onText: (text: string) => void,
  onEnd: (reason: string) => void,
): StreamHandle {
  assertRouteAllowed(path)
  let ended = false
  const end = (reason: string) => {
    if (ended) return
    ended = true
    onEnd(reason)
  }
  const req = http.request(
    {
      socketPath: endpoint,
      path,
      method: 'GET',
      headers: { Host: 'jamd', Accept: 'text/event-stream, application/json' },
    },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        end(`status ${res.statusCode}`)
        return
      }
      res.setEncoding('utf8')
      res.on('data', (text: string) => onText(text))
      res.on('end', () => end('ended'))
      res.on('error', (error) => end(error.message))
    },
  )
  req.on('error', (error) => end(error.message))
  req.end()
  return {
    close: () => {
      end('closed')
      req.destroy()
    },
  }
}
