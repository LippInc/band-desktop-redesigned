import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { waitForAppPage } from './cdp.mjs'

const listen = (server) => new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port)))

describe('waitForAppPage', () => {
  let server = null
  const sockets = []

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy()
    if (server) await new Promise((done) => server.close(() => done()))
    server = null
  })

  it(
    'gives up on time when the app takes connections but never answers, as a hung main process does',
    {
      timeout: 20_000,
    },
    async () => {
      server = createServer((socket) => sockets.push(socket))
      const port = await listen(server)
      const started = Date.now()
      expect(await waitForAppPage(port, null, 2)).toBeNull()
      // Two seconds and one pause; not a try's full time limit past the deadline, nor more tries after it.
      expect(Date.now() - started).toBeLessThan(3_300)
    },
  )

  it('finds the app page among the targets when the app answers', async () => {
    server = createHttpServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify([
          { type: 'service_worker', url: 'app://jam/sw.js' },
          { type: 'page', url: 'devtools://devtools/inspector.html' },
          { type: 'page', url: 'app://jam/index.html' },
        ]),
      )
    })
    server.on('connection', (socket) => sockets.push(socket))
    const port = await listen(server)
    expect(await waitForAppPage(port, null, 2)).toMatchObject({ url: 'app://jam/index.html' })
  })
})
