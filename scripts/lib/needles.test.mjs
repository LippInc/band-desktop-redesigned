import { describe, expect, it } from 'vitest'
import { mergeNeedles } from './needles.mjs'

describe('mergeNeedles', () => {
  it('keeps what an earlier run found when this run no longer sees it', () => {
    const earlier = { 'a Jam room id': ['room-1'], 'a Jam room item id': ['file-1'] }
    const now = { 'a Jam room id': [], 'a Jam room item id': [] }
    expect(mergeNeedles(earlier, now)).toEqual(earlier)
  })

  it('adds what this run found, once', () => {
    expect(mergeNeedles({ kind: ['a'] }, { kind: ['a', 'b'], other: ['c'] })).toEqual({
      kind: ['a', 'b'],
      other: ['c'],
    })
  })

  it.each([
    ['no earlier cache', undefined],
    ['an earlier cache that is not an object', 'broken'],
    ['an earlier cache that is a list', ['a']],
  ])('starts from this run alone with %s', (_label, earlier) => {
    expect(mergeNeedles(earlier, { kind: ['a'] })).toEqual({ kind: ['a'] })
  })

  it('drops values that are not strings, and empty ones', () => {
    expect(mergeNeedles({ kind: ['a', null, 7, ''] }, { kind: 'not a list' })).toEqual({ kind: ['a'] })
  })
})
