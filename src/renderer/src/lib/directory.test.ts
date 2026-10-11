import { describe, expect, it } from 'vitest'
import type { DirectoryEntry, Participant } from '@shared/daemon'
import { addedText, candidateName, candidates, DIRECTORY_TABS } from '@/lib/directory'

const entry = (over: Partial<DirectoryEntry> = {}): DirectoryEntry =>
  ({ id: 'e1', kind: 'agent', name: 'Beacon', handle: 'orla-quinn/beacon', online: false, ...over }) as DirectoryEntry

const person = (id: string): Participant => ({ id }) as Participant

describe('Jam’s two tabs', () => {
  it('asks the daemon for the two kinds it accepts, in Jam’s order', () => {
    expect(DIRECTORY_TABS.map((tab) => tab.label)).toEqual(['Agents', 'People'])
    expect(DIRECTORY_TABS.map((tab) => tab.kind)).toEqual(['agent', 'user'])
  })
})

describe('who the picker offers', () => {
  /** Jam: "The picker omits people and agents who are already in the room." */
  it('leaves out anyone already in the room', () => {
    const found = [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })]
    expect(candidates(found, [person('b')]).map((one) => one.id)).toEqual(['a', 'c'])
    expect(candidates(found, [person('a'), person('b'), person('c')])).toEqual([])
  })

  it('offers the same identity once, however many times the answer holds it', () => {
    expect(candidates([entry({ id: 'a' }), entry({ id: 'a' })], []).map((one) => one.id)).toEqual(['a'])
  })

  it('leaves out an entry with no id, because the id is what adding one names', () => {
    const found = [entry({ id: '' }), entry({ id: 'b' })]
    expect(candidates(found, []).map((one) => one.id)).toEqual(['b'])
  })

  /**
   * `online` is the identity's own state, not whether it can be added: in a real reading every entry was offline,
   * this account's own agent included. Nothing is held back for it.
   */
  it('offers an identity that is not online, and carries the state through', () => {
    const shown = candidates([entry({ id: 'a', online: false }), entry({ id: 'b', online: true })], [])
    expect(shown.map((one) => one.id)).toEqual(['a', 'b'])
    expect(shown[0]?.online).toBe(false)
    expect(shown[1]?.online).toBe(true)
  })

  it('says nothing about a state the answer did not carry', () => {
    expect(candidates([entry({ id: 'a', online: null })], [])[0]?.online).toBeNull()
  })

  it('falls back to the handle when an identity has no name', () => {
    expect(candidateName(entry({ name: null }))).toBe('orla-quinn/beacon')
    expect(candidateName(entry({ name: '  ', handle: '  ' }))).toBe('Unnamed')
  })

  it('carries the tags it was given, and copes with none', () => {
    expect(candidates([entry({ tags: ['coding'] })], [])[0]?.tags).toEqual(['coding'])
    expect(candidates([entry({ tags: null })], [])[0]?.tags).toEqual([])
  })
})

/** Jam "keeps the successful additions and reports how many failed". */
describe('what is said after adding several', () => {
  it('says nothing when every one was added', () => {
    expect(addedText(3, 0)).toBeNull()
    expect(addedText(0, 0)).toBeNull()
  })

  it('reports how many failed, beside how many went in', () => {
    expect(addedText(2, 1)).toBe('2 added, 1 could not be.')
    expect(addedText(0, 1)).toBe('That one could not be added.')
    expect(addedText(0, 3)).toBe('None of the 3 could be added.')
  })
})
