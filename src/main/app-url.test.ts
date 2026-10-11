import { describe, expect, it } from 'vitest'
import { createAppUrlGuard } from './app-url'

describe('createAppUrlGuard', () => {
  it('accepts the app protocol on our host', () => {
    expect(createAppUrlGuard()('app://jam-redesign/index.html#/settings/general')).toBe(true)
  })

  it('refuses other hosts on the app protocol', () => {
    expect(createAppUrlGuard()('app://other/index.html')).toBe(false)
    expect(createAppUrlGuard()('app://jam/index.html')).toBe(false)
  })

  it('accepts the dev server origin only when one is given', () => {
    expect(createAppUrlGuard('http://localhost:5173')('http://localhost:5173/#/')).toBe(true)
    expect(createAppUrlGuard()('http://localhost:5173/')).toBe(false)
  })

  it.each([
    'http://localhost:5174/',
    'https://example.com/',
    'https://app.band.ai/',
    'file:///C:/index.html',
    '',
    'nonsense',
  ])('refuses %s', (url) => {
    expect(createAppUrlGuard('http://localhost:5173')(url)).toBe(false)
  })
})
