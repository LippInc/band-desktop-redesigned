import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from './external-url'

describe('isSafeExternalUrl', () => {
  it.each(['https://band.ai/', 'mailto:someone@example.com'])('allows %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(true)
  })

  it.each([
    'http://band.ai/',
    'file:///C:/Windows/system32/calc.exe',
    'javascript:alert(1)',
    'jam://open-room',
    'app://jam-redesign/index.html',
    '',
    'not a url',
    42,
    null,
    `https://example.com/${'a'.repeat(2100)}`,
  ])('refuses %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(false)
  })
})
