import { describe, expect, it } from 'vitest'
import { resolveDaemonMode } from './daemon-mode'

describe('resolveDaemonMode', () => {
  it('a packaged build always uses the live daemon and ignores every override', () => {
    expect(resolveDaemonMode(true, { JAMR_DAEMON_ENDPOINT: '\\\\.\\pipe\\fake', JAMR_DAEMON: 'none' })).toEqual({
      kind: 'live',
    })
  })

  it('an unpackaged run with an endpoint uses it (the fake daemon)', () => {
    expect(resolveDaemonMode(false, { JAMR_DAEMON_ENDPOINT: ' \\\\.\\pipe\\jamr-fake-1 ' })).toEqual({
      kind: 'fake',
      endpoint: '\\\\.\\pipe\\jamr-fake-1',
    })
  })

  it('an unpackaged run goes live only when asked to', () => {
    expect(resolveDaemonMode(false, { JAMR_DAEMON: 'live' })).toEqual({ kind: 'live' })
  })

  it.each([{}, { JAMR_DAEMON: 'LIVE' }, { JAMR_DAEMON: 'yes' }, { JAMR_DAEMON_ENDPOINT: '   ' }])(
    'an unpackaged run with %j talks to no daemon',
    (env) => {
      expect(resolveDaemonMode(false, env)).toEqual({ kind: 'none' })
    },
  )
})
