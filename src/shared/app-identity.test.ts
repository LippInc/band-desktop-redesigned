import { describe, expect, it } from 'vitest'
import { APP_HOST, APP_PRODUCT_NAME, APP_USER_MODEL_ID } from './app-identity'

// The official app's own names, before and since Band Desktop 0.4.14: this app's identity is never one of them.
const THEIRS = ['jam', 'jam desktop', 'band', 'band desktop']
const isTheirs = (name: string) => THEIRS.includes(name.trim().toLowerCase())

describe("this app's identity", () => {
  it('is never the official app’s own name, old or new', () => {
    // The check itself fires on a known-bad.
    expect(isTheirs(' Band Desktop ')).toBe(true)
    for (const name of [APP_PRODUCT_NAME, APP_USER_MODEL_ID, APP_HOST]) expect(isTheirs(name)).toBe(false)
  })
})
