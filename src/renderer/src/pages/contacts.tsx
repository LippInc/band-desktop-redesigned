import { useEffect, useMemo, useState } from 'react'
import type { ContactsOverview } from '@shared/daemon'
import { Page } from '@/components/page'
import { Cell, Table } from '@/components/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { unavailableFor, unavailableText } from '@/components/room/unavailable'
import {
  contactRows,
  EVERYONE,
  EVERYONE_SCOPE,
  NO_CONTACTS,
  requestCounts,
  scopeOptions,
  type ScopeOption,
} from '@/lib/contacts'
import { jam } from '@/lib/platform'
import { sectionById } from '@/lib/sections'
import { useDaemon } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'

/**
 * Contacts (Jam Desktop 0.4.10, read 2026-09-20) in ZCode's frame: Jam's title and line, its Filter by scope and its
 * search on the right of the header, then one card holding its request row, its CONNECTIONS heading with the count,
 * and its Name/Actions table.
 *
 * Every state that could be checked against Jam is an empty one: the account it was read on has no contacts, no
 * request in and none out, in any scope. What follows from the answer alone rather than from Jam's own screen is
 * listed in `docs/jam/differences.md`.
 */
export function ContactsPage() {
  const section = sectionById('contacts')
  const profile = useSettings((state) => state.settings.profile)
  const connected = useDaemon((state) => state.status.state === 'connected')
  const revision = useDaemon((state) => state.revision)
  const [overview, setOverview] = useState<ContactsOverview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [scope, setScope] = useState<string>(EVERYONE_SCOPE)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const api = jam()
    if (!api || !connected) return
    let current = true
    api.daemon
      .contactsOverview({ profile })
      .then((data) => {
        if (!current) return
        setOverview(data)
        setProblem(null)
      })
      .catch((error: unknown) => {
        if (!current) return
        setOverview(null)
        setProblem(unavailableFor(error, 'Contacts'))
      })
    return () => {
      current = false
    }
  }, [profile, connected, revision])

  const scopes = useMemo(() => scopeOptions(overview), [overview])
  const list = useMemo(() => contactRows(overview, scope, query), [overview, scope, query])
  const waiting = requestCounts(overview, scope)
  // Before the daemon has answered there is nothing to say about who this account can reach; an empty table would
  // report that it can reach no one.
  const away = connected
    ? overview === null && problem === null
      ? 'Reading who this account can reach…'
      : null
    : unavailableText('Contacts', 'offline')
  const note = away ?? problem

  return (
    <Page
      wide
      title={section.label}
      description={section.description}
      actions={
        note ? null : (
          <div className="flex items-center gap-2">
            <Select value={scope} onValueChange={(value) => setScope(String(value))}>
              <SelectTrigger aria-label="Filter by scope" className="w-40">
                <SelectValue>
                  {(value: string) => scopes.find((one) => one.value === value)?.label ?? EVERYONE}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {scopes.map((one) => (
                  <SelectItem key={one.value || 'you'} value={one.value}>
                    {one.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or @handle…"
              aria-label="Search name or @handle"
              className="w-56"
            />
          </div>
        )
      }
    >
      {note ? (
        <p className="text-ui-base text-foreground-subtle">{note}</p>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-line bg-card p-4">
          <RequestRow scopes={scopes} />
          {list.failed.length > 0 ? (
            <p className="text-ui-sm text-foreground-subtle">
              Band could not read the contacts of {list.failed.join(', ')}, so nothing of theirs is listed or counted
              here.
            </p>
          ) : null}
          <div className="flex flex-col gap-3">
            <h2 className="text-ui-sm font-medium tracking-wide text-foreground-subtle uppercase">
              Connections ({list.total})
            </h2>
            <Table head={['Name', 'Actions']} align="r" label="Connections">
              {list.rows.length === 0 ? (
                <tr className="border-t border-line">
                  <Cell colSpan={2} className="py-6 text-center text-foreground-subtle">
                    {/* A scope the daemon could not read says so; saying "no contacts" would report a nothing that
                        the answer never gave. */}
                    {list.allFailed
                      ? 'Nothing can be said about this scope until Band can read it.'
                      : query.trim() === ''
                        ? NO_CONTACTS
                        : 'No contact of this account matches that.'}
                  </Cell>
                </tr>
              ) : (
                list.rows.map((row) => (
                  <tr key={row.key} className="border-t border-line">
                    <Cell>
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="text-foreground">{row.name}</span>
                        {row.handle ? (
                          <span className="font-mono text-ui-sm text-foreground-subtle">{row.handle}</span>
                        ) : null}
                        {scope === EVERYONE_SCOPE ? (
                          <span className="text-ui-sm text-foreground-subtlest">{row.scopeLabel}</span>
                        ) : null}
                      </span>
                    </Cell>
                    {/* Jam's own actions on a row remove a contact, which writes; they arrive with that write. */}
                    <Cell className="text-right text-foreground-subtlest">—</Cell>
                  </tr>
                ))
              )}
            </Table>
            {/* What the answer holds but this app cannot name is counted, never invented. */}
            {list.unreadable > 0 ? (
              <p className="text-ui-sm text-foreground-subtlest">
                {list.unreadable} more {list.unreadable === 1 ? 'contact is' : 'contacts are'} listed in a form this app
                does not know yet, so {list.unreadable === 1 ? 'it is' : 'they are'} counted above but not shown.
              </p>
            ) : null}
            {list.truncated ? (
              <p className="text-ui-sm text-foreground-subtlest">
                Band sent only the first of this account&rsquo;s contacts.
              </p>
            ) : null}
            {waiting.received + waiting.sent > 0 ? (
              <p className="text-ui-sm text-foreground-subtlest">
                {waiting.truncated ? 'At least ' : ''}
                {waiting.received} request{waiting.received === 1 ? '' : 's'} waiting for an answer and {waiting.sent}{' '}
                sent. Answering one is not here yet: it writes to Band about a real person.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </Page>
  )
}

/**
 * Jam's request row: a handle, an optional message, who to send it as, and Send request. Jam leaves the first three
 * live and turns only Send request off until a handle is typed; so does this, because only the sending is unbuilt.
 * A request goes to a real person on Band - not to a room - so there is nowhere to exercise that write
 * (`docs/jam/differences.md`), and the button says so.
 */
function RequestRow({ scopes }: { scopes: readonly ScopeOption[] }) {
  const senders = scopes.filter((one) => one.value !== EVERYONE_SCOPE)
  const [handle, setHandle] = useState('')
  const [message, setMessage] = useState('')
  const [sender, setSender] = useState(senders[0]?.value ?? '')
  const nameOf = (value: string) => senders.find((one) => one.value === value)?.label ?? 'You'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={handle}
        onChange={(event) => setHandle(event.target.value)}
        placeholder="@handle or owner/agent…"
        aria-label="@handle or owner/agent"
        className="flex-1"
      />
      <Input
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Optional message…"
        aria-label="Optional message"
        className="flex-1"
      />
      <Select value={sender} onValueChange={(value) => setSender(String(value))}>
        <SelectTrigger aria-label="Send the request as" className="w-36">
          <SelectValue>{(value: string) => `as ${nameOf(value)}`}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {senders.map((one) => (
            <SelectItem key={one.value || 'you'} value={one.value}>
              as {one.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button size="sm" disabled>
              Send request
            </Button>
          }
        />
        <TooltipContent>Sending a contact request is not built yet</TooltipContent>
      </Tooltip>
    </div>
  )
}
