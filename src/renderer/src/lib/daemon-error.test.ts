import { describe, expect, it } from 'vitest'
import { daemonErrorCode, daemonErrorText } from './daemon-error'

describe('daemonErrorCode', () => {
  it('finds the code inside the message Electron wraps', () => {
    const error = new Error(
      "Error invoking remote method 'daemon:op:rooms': Error: [jam:offline] The Band daemon is not running",
    )
    expect(daemonErrorCode(error)).toBe('offline')
    expect(daemonErrorText(error)).toBe('The Band daemon is not running')
  })

  it.each([new Error('plain failure'), new Error('[jam:made-up] x'), 'nothing', null])(
    'has no code for %s',
    (error) => {
      expect(daemonErrorCode(error)).toBeNull()
    },
  )
})
