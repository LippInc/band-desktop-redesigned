import type { DirectoryEntry, DirectoryKind, Participant } from '@shared/daemon'

/**
 * What Jam's "Add participants" picker shows. Its own steps (user guide, "Add people and agents"):
 *
 * > 1. Open the right panel and select **Participants**. 2. Select **Add participants**. 3. Open **Agents** or
 * > **People**. 4. Search by name, handle, or email when needed. 5. Select one or more entries.
 * > 6. Select **Add participants**.
 *
 * and its two rules: "The picker omits people and agents who are already in the room", and "If a multi-person add
 * partly fails, Jam keeps the successful additions and reports how many failed."
 *
 * Jam also holds back identities that "cannot be added right now" behind **Show unavailable**, "greyed out and with
 * the reason on the card". Nothing in what this app reads says that: `/v1/searchDirectory` carries an `online` flag
 * and no reason, and in a real reading every entry was offline - this account's own agent included - so holding back
 * what is not online would hold back the whole list. `online` is shown as the identity's own state instead, and
 * `docs/jam/differences.md` says why Show unavailable is not here.
 */

/** Jam's two tabs, in Jam's order, with the kind each one asks the daemon for. */
export const DIRECTORY_TABS = [
  { label: 'Agents', kind: 'agent' },
  { label: 'People', kind: 'user' },
] as const satisfies readonly { label: string; kind: DirectoryKind }[]

export type DirectoryTab = (typeof DIRECTORY_TABS)[number]['label']

/** What one row of the picker shows. */
export interface Candidate {
  id: string
  name: string
  handle: string | null
  description: string | null
  tags: string[]
  online: boolean | null
}

/** Jam's own fallback when an identity has no name of its own: its handle, and failing that nothing to show. */
export const candidateName = (entry: DirectoryEntry): string => entry.name?.trim() || entry.handle?.trim() || 'Unnamed'

/**
 * The entries the picker offers: everyone the search found who is not already in the room. Anything without an id is
 * left out, because the id is what adding one names, and the same id twice is offered once.
 */
export function candidates(entries: readonly DirectoryEntry[], present: readonly Participant[]): Candidate[] {
  const already = new Set(present.map((person) => person.id))
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const entry of entries) {
    if (!entry.id || already.has(entry.id) || seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push({
      id: entry.id,
      name: candidateName(entry),
      handle: entry.handle?.trim() || null,
      description: entry.description?.trim() || null,
      tags: entry.tags ?? [],
      online: entry.online ?? null,
    })
  }
  return out
}

/**
 * What to say after adding several: Jam "keeps the successful additions and reports how many failed". A run that
 * added everyone says nothing, because the panel already shows them.
 */
export function addedText(added: number, failed: number): string | null {
  if (failed === 0) return null
  if (added === 0) return failed === 1 ? 'That one could not be added.' : `None of the ${failed} could be added.`
  return `${added} added, ${failed} could not be.`
}

/** The fewest characters worth asking Band about, so an empty field does not search the whole directory. */
export const DIRECTORY_MIN_QUERY = 2
