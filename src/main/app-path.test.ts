import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppPath } from './app-path'

const root = resolve('out/renderer')

describe('resolveAppPath', () => {
  it('serves index.html for the root path', () => {
    expect(resolveAppPath(root, 'app://jam-redesign/')).toBe(join(root, 'index.html'))
  })

  it('maps nested assets inside the root', () => {
    expect(resolveAppPath(root, 'app://jam-redesign/assets/index-abc.js')).toBe(join(root, 'assets', 'index-abc.js'))
  })

  it.each([
    'app://jam-redesign/../../secret.txt',
    'app://jam-redesign/%2e%2e/%2e%2e/secret.txt',
    'app://jam-redesign/..%2F..%2Fsecret.txt',
    'app://jam-redesign/assets/..%5C..%5C..%5Csecret.txt',
  ])('never escapes the root: %s', (url) => {
    const target = resolveAppPath(root, url)
    expect(target === null || target.startsWith(root + sep)).toBe(true)
  })

  it.each(['app://evil/index.html', 'https://jam-redesign/index.html', 'app://jam-redesign/%E0%A4%A', 'not a url'])(
    'refuses %s',
    (url) => {
      expect(resolveAppPath(root, url)).toBeNull()
    },
  )
})
