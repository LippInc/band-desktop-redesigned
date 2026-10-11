import { describe, expect, it } from 'vitest'
import type { ContactsOverview } from '@shared/daemon'
import { contactRows, EVERYONE, EVERYONE_SCOPE, requestCounts, scopeOptions } from '@/lib/contacts'

const scope = (key: string, label: string, snapshot: Partial<Record<string, unknown>> = {}, error = '') => ({
  scope: key,
  label,
  error,
  snapshot: {
    contacts: [],
    received: [],
    sent: [],
    contacts_truncated: false,
    received_truncated: false,
    sent_truncated: false,
    ...snapshot,
  },
})

const overview = (...scopes: unknown[]) => ({ scopes }) as unknown as ContactsOverview

describe('what Contacts shows', () => {
  it("offers Everyone first, then a scope per row of the answer in the daemon's order", () => {
    const options = scopeOptions(overview(scope('', 'You'), scope('id-a', 'Atlas')))
    expect(options).toEqual([
      { value: EVERYONE_SCOPE, label: EVERYONE },
      { value: '', label: 'You' },
      { value: 'id-a', label: 'Atlas' },
    ])
    // Everyone needs a value of its own: the account's own scope is the empty string.
    expect(options[0]?.value).not.toBe('')
    expect(scopeOptions(null)).toEqual([{ value: EVERYONE_SCOPE, label: EVERYONE }])
  })

  it('lists the chosen scope only, and every scope under Everyone', () => {
    const answer = overview(
      scope('', 'You', { contacts: [{ display_name: 'Robin Vale' }] }),
      scope('id-a', 'Atlas', { contacts: [{ display_name: 'Kit Marlow' }] }),
    )
    expect(contactRows(answer, '', '').rows.map((row) => row.name)).toEqual(['Robin Vale'])
    expect(contactRows(answer, 'id-a', '').rows.map((row) => row.name)).toEqual(['Kit Marlow'])
    expect(contactRows(answer, EVERYONE_SCOPE, '').rows.map((row) => [row.name, row.scopeLabel])).toEqual([
      ['Robin Vale', 'You'],
      ['Kit Marlow', 'Atlas'],
    ])
  })

  // No contact has ever been recorded, so which field names one is not known. A contact none of the candidates names
  // is counted, never given a name this app made up.
  it('names a contact by what the answer calls it, and counts one it cannot name', () => {
    const answer = overview(
      scope('', 'You', {
        contacts: [
          { display_name: 'Robin Vale', handle: 'robin' },
          { peer: { name: 'Kit Marlow' } },
          { handle: 'someone/agent' },
          { opaque: 7 },
          { display_name: '   ' },
        ],
      }),
    )
    const list = contactRows(answer, '', '')
    expect(list.rows.map((row) => [row.name, row.handle])).toEqual([
      ['Robin Vale', 'robin'],
      ['Kit Marlow', null],
      ['someone/agent', null],
    ])
    expect(list.unreadable).toBe(2)
    // Jam's heading counts what the answer holds, named or not.
    expect(list.total).toBe(5)
  })

  it('searches by name or handle, and takes the @ a person types as no part of either', () => {
    const answer = overview(
      scope('', 'You', {
        contacts: [
          { display_name: 'Robin Vale', handle: 'robin/dev' },
          { display_name: 'Kit Marlow', handle: 'kit/ops' },
        ],
      }),
    )
    expect(contactRows(answer, '', 'kit').rows.map((row) => row.name)).toEqual(['Kit Marlow'])
    expect(contactRows(answer, '', '@robin').rows.map((row) => row.name)).toEqual(['Robin Vale'])
    expect(contactRows(answer, '', 'VALE').rows.map((row) => row.name)).toEqual(['Robin Vale'])
    expect(contactRows(answer, '', '  ').rows).toHaveLength(2)
    expect(contactRows(answer, '', 'nobody').rows).toEqual([])
    // A search narrows the rows; it does not change how many the answer holds.
    expect(contactRows(answer, '', 'nobody').total).toBe(2)
  })

  it('carries the daemon saying it cut a list short', () => {
    const answer = overview(scope('', 'You', { contacts: [], contacts_truncated: true }))
    expect(contactRows(answer, '', '').truncated).toBe(true)
    expect(contactRows(overview(scope('', 'You')), '', '').truncated).toBe(false)
  })

  it('counts the requests waiting in and out, apart from the contacts, and says when a count is only a floor', () => {
    const answer = overview(
      scope('', 'You', { received: [{}, {}], sent: [{}] }),
      scope('id-a', 'Atlas', { received: [{}], sent: [] }),
    )
    expect(requestCounts(answer, '')).toEqual({ received: 2, sent: 1, truncated: false })
    expect(requestCounts(answer, EVERYONE_SCOPE)).toEqual({ received: 3, sent: 1, truncated: false })
    expect(requestCounts(null, EVERYONE_SCOPE)).toEqual({ received: 0, sent: 0, truncated: false })
    // The daemon saying it cut either list short must reach the screen, or a floor reads as a total.
    const cut = overview(scope('', 'You', { received: [{}], received_truncated: true }))
    expect(requestCounts(cut, '').truncated).toBe(true)
    const cutSent = overview(scope('', 'You', { sent: [{}], sent_truncated: true }))
    expect(requestCounts(cutSent, '').truncated).toBe(true)
  })

  // A scope the daemon could not read must say so, and nothing of its own may be listed or counted: counting a list
  // the daemon could not read would report a number the answer never gave.
  it('names the scopes whose own read failed, and leaves them out of the rows and the count', () => {
    const answer = overview(
      scope('', 'You', { contacts: [{ display_name: 'Robin Vale' }] }),
      scope('id-a', 'Atlas', { contacts: [{ display_name: 'Kit Marlow' }], received: [{}] }, 'peer not found'),
    )
    const everyone = contactRows(answer, EVERYONE_SCOPE, '')
    expect(everyone.failed).toEqual(['Atlas'])
    expect(everyone.rows.map((row) => row.name)).toEqual(['Robin Vale'])
    expect(everyone.total).toBe(1)
    expect(everyone.allFailed).toBe(false)
    // A request waiting in a scope that could not be read is not counted either.
    expect(requestCounts(answer, EVERYONE_SCOPE)).toEqual({ received: 0, sent: 0, truncated: false })
    const only = contactRows(answer, 'id-a', '')
    expect(only.failed).toEqual(['Atlas'])
    expect(only.total).toBe(0)
    expect(only.allFailed).toBe(true)
    expect(contactRows(answer, '', '').failed).toEqual([])
    expect(contactRows(null, EVERYONE_SCOPE, '').failed).toEqual([])
    expect(contactRows(null, EVERYONE_SCOPE, '').allFailed).toBe(false)
  })

  // Everything from the daemon is untrusted, so the search for a name has a fixed depth rather than walking whatever
  // nesting an answer arrived with.
  it('looks for a name one level down and no further', () => {
    const answer = overview(
      scope('', 'You', {
        contacts: [{ peer: { name: 'Kit Marlow' } }, { peer: { profile: { name: 'Robin Vale' } } }],
      }),
    )
    const list = contactRows(answer, '', '')
    expect(list.rows.map((row) => row.name)).toEqual(['Kit Marlow'])
    expect(list.unreadable).toBe(1)
  })

  // Every candidate field is one the answer might use; each must be able to name a row on its own.
  it('names a contact by any of the fields it looks under, at either level', () => {
    const named = (contact: Record<string, unknown>) =>
      contactRows(overview(scope('', 'You', { contacts: [contact] })), '', '').rows[0]
    expect(named({ name: 'By name' })?.name).toBe('By name')
    expect(named({ label: 'By label' })?.name).toBe('By label')
    expect(named({ title: 'By title' })?.name).toBe('By title')
    expect(named({ user: { display_name: 'In user' } })?.name).toBe('In user')
    expect(named({ identity: { title: 'In identity' } })?.name).toBe('In identity')
    expect(named({ owner_handle: 'owner' })?.name).toBe('owner')
    expect(named({ contact: { address: 'someone@example.test' } })?.name).toBe('someone@example.test')
    // Its own field wins over the same field one level down.
    expect(named({ display_name: 'Own', peer: { display_name: 'Nested' } })?.name).toBe('Own')
  })

  it('gives each row a key of its own, so two contacts of one scope never share one', () => {
    const answer = overview(scope('', 'You', { contacts: [{ name: 'A' }, { name: 'A' }] }))
    const keys = contactRows(answer, '', '').rows.map((row) => row.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has nothing to list for an answer with no scopes at all', () => {
    expect(contactRows(overview(), EVERYONE_SCOPE, '')).toEqual({
      rows: [],
      total: 0,
      unreadable: 0,
      truncated: false,
      failed: [],
      allFailed: false,
    })
    expect(contactRows(null, EVERYONE_SCOPE, '').rows).toEqual([])
  })
})
