import type { ContactsOverview } from '@shared/daemon'

/**
 * What Contacts shows, in one place. Jam Desktop 0.4.10 was read on 2026-09-20 on an account that has no contacts at
 * all - none held, none received, none sent, in any scope - so every state that could be checked against Jam is an
 * empty one. What follows from the answer alone rather than from Jam's own screen is listed in
 * `docs/jam/differences.md`.
 */

/** Jam's own words on the screen. */
export const EVERYONE = 'Everyone'
export const NO_CONTACTS = 'No contacts yet. Send a request by handle above.'

/** The filter's value for Everyone. The account's own scope is the empty string, so Everyone needs one of its own. */
export const EVERYONE_SCOPE = '*'

export interface ScopeOption {
  /** The daemon's own scope key: the empty string for the account itself, an agent's id for an agent. */
  value: string
  label: string
}

/** One person or agent this account can reach, as far as the answer can be read. */
export interface ContactRow {
  key: string
  /** The name the answer gives; never one this app made up. */
  name: string
  handle: string | null
  /** Which of Jam's scopes this row came from, for a reader who has chosen Everyone. */
  scopeLabel: string
}

export interface ContactList {
  rows: ContactRow[]
  /** How many the answer holds in the scopes it could read, named or not: this is the number in Jam's heading. */
  total: number
  /** Contacts the answer holds that this app could not name. Counted, never invented. */
  unreadable: number
  /** The daemon cut the list short before this app saw all of it. */
  truncated: boolean
  /** The scopes whose own read failed, by their label. Nothing of theirs is listed or counted. */
  failed: string[]
  /** Every scope the filter chose failed its own read, so there is nothing this app can say about them. */
  allFailed: boolean
}

/** Jam's filter: Everyone first, then a scope per row of the answer, in the order the daemon gives them. */
export function scopeOptions(overview: ContactsOverview | null): ScopeOption[] {
  const scopes = overview?.scopes ?? []
  return [{ value: EVERYONE_SCOPE, label: EVERYONE }, ...scopes.map((one) => ({ value: one.scope, label: one.label }))]
}

/**
 * The fields a contact might be named by. No contact has ever been recorded - the account has none, and no read can
 * make one - so which field the daemon uses is not known. The first of these that holds text names the row, and a
 * contact none of them names is counted as unreadable rather than given a name this app invented.
 */
const NAME_FIELDS = ['display_name', 'name', 'label', 'title'] as const
const HANDLE_FIELDS = ['handle', 'owner_handle', 'peer_handle', 'address'] as const
/** The one level of nesting looked under, for an answer that wraps its contact in a peer or a user. */
const NESTS = ['peer', 'user', 'contact', 'identity', 'profile'] as const

function fieldAt(item: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = item[field]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

/**
 * The text naming a contact: its own fields first, then the same fields one level down. The depth is fixed at one on
 * purpose - everything the daemon sends is untrusted, and a search with no bound would walk whatever nesting an answer
 * arrived with.
 */
function textAt(item: Record<string, unknown>, fields: readonly string[]): string | null {
  const own = fieldAt(item, fields)
  if (own) return own
  for (const nest of NESTS) {
    const inner = item[nest]
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const found = fieldAt(inner as Record<string, unknown>, fields)
      if (found) return found
    }
  }
  return null
}

function chosenScopes(overview: ContactsOverview | null, scope: string) {
  return (overview?.scopes ?? []).filter((one) => scope === EVERYONE_SCOPE || one.scope === scope)
}

function failedRead(one: { error?: string }): boolean {
  return (one.error ?? '') !== ''
}

/**
 * The rows of Jam's CONNECTIONS table: the contacts of the chosen scope, or of every scope in the daemon's own order
 * when Everyone is chosen, narrowed by what has been typed into Jam's search. A scope whose own read failed is left
 * out of the rows AND out of the count, and named instead: counting a list the daemon could not read would report a
 * number the answer never gave. A contact listed under two scopes is listed twice under Everyone, because the answer
 * reports them per scope and no contact has ever been seen to know whether Jam merges them.
 */
export function contactRows(overview: ContactsOverview | null, scope: string, query: string): ContactList {
  const chosen = chosenScopes(overview, scope)
  const read = chosen.filter((one) => !failedRead(one))
  const rows: ContactRow[] = []
  let total = 0
  let unreadable = 0
  let truncated = false
  for (const one of read) {
    const contacts = one.snapshot.contacts
    total += contacts.length
    truncated ||= one.snapshot.contacts_truncated === true
    contacts.forEach((contact, index) => {
      const name = textAt(contact, NAME_FIELDS)
      const handle = textAt(contact, HANDLE_FIELDS)
      if (!name && !handle) {
        unreadable += 1
        return
      }
      rows.push({
        key: `${one.scope}/${index}`,
        name: name ?? (handle as string),
        handle: name ? handle : null,
        scopeLabel: one.label,
      })
    })
  }
  return {
    rows: rows.filter((row) => matches(row, query)),
    total,
    unreadable,
    truncated,
    failed: chosen.filter(failedRead).map((one) => one.label),
    allFailed: chosen.length > 0 && read.length === 0,
  }
}

/** Jam searches by name or handle; the leading @ a person types is not part of either. */
function matches(row: ContactRow, query: string): boolean {
  const needle = query.trim().replace(/^@/, '').toLowerCase()
  if (needle === '') return true
  return row.name.toLowerCase().includes(needle) || (row.handle ?? '').toLowerCase().includes(needle)
}

export interface RequestCounts {
  received: number
  sent: number
  /** The daemon cut one of the two lists short, so the counts are floors rather than totals. */
  truncated: boolean
}

/**
 * How many requests wait in the chosen scope, in and out: Jam keeps them apart from the contacts (user guide). A
 * scope whose own read failed is left out here too, and the daemon saying it cut either list short is carried, so a
 * count that is only a floor is never stated as a total.
 */
export function requestCounts(overview: ContactsOverview | null, scope: string): RequestCounts {
  const read = chosenScopes(overview, scope).filter((one) => !failedRead(one))
  return {
    received: read.reduce((sum, one) => sum + one.snapshot.received.length, 0),
    sent: read.reduce((sum, one) => sum + one.snapshot.sent.length, 0),
    truncated: read.some((one) => one.snapshot.received_truncated === true || one.snapshot.sent_truncated === true),
  }
}
