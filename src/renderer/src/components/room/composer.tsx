import { ArrowUp, AtSign, Paperclip } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { Participant } from '@shared/daemon'
import { Initials } from '@/components/room/chat'
import { StagedFiles } from '@/components/room/staged-files'
import { IconButton } from '@/components/shell/icon-button'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { clearStaged, dropTarget, pasteFiles, setStagingSending, useStagedFiles } from '@/lib/attachments'
import { daemonErrorText } from '@/lib/daemon-error'

/** A participant the person can mention: its id, the name shown in the draft, and the handle the message carries. */
export interface Mentionable {
  id: string
  name: string
  handle: string | null
  kind: 'agent' | 'person'
}

const toMention = (participant: Participant, kind: Mentionable['kind']): Mentionable => ({
  id: participant.id,
  name: participant.name || participant.handle || 'Participant',
  handle: participant.handle ?? null,
  kind,
})

/** The room's participants the person can address: agents first, then people, never the person themselves. */
export function mentionablesOf(participants: readonly Participant[], selfId: string | null): Mentionable[] {
  const others = participants.filter((participant) => participant.id !== selfId)
  return [
    ...others.filter((p) => p.kind && p.kind !== 'User').map((p) => toMention(p, 'agent')),
    ...others.filter((p) => !p.kind || p.kind === 'User').map((p) => toMention(p, 'person')),
  ]
}

/**
 * The message as it goes out: each mention still in the draft written as `@<handle>` (the daemon turns a handle into a
 * mention, as the official app's messages show), and the ids of those mentions. A mention whose "@Name" was deleted from
 * the draft is not sent. The draft is read once, left to right: at each "@" the longest chosen name that ends there as a
 * whole word is the mention, so "@Alex" is never read as "@Al" and "ex", and a handle written in is never read again. Of
 * two chosen with the same name, the one chosen last is meant.
 */
export function outgoing(draft: string, chosen: readonly Mentionable[]): { content: string; mentions: string[] } {
  const longestFirst = chosen.toReversed().toSorted((a, b) => b.name.length - a.name.length)
  const mentions: string[] = []
  let content = ''
  let at = 0
  while (at < draft.length) {
    const sign = draft.indexOf('@', at)
    if (sign === -1) {
      content += draft.slice(at)
      break
    }
    content += draft.slice(at, sign)
    const mention = longestFirst.find(
      (item) => draft.startsWith(`@${item.name}`, sign) && endsWord(draft, sign + 1 + item.name.length),
    )
    if (!mention) {
      content += '@'
      at = sign + 1
      continue
    }
    content += `@${mention.handle || mention.name}`
    if (!mentions.includes(mention.id)) mentions.push(mention.id)
    at = sign + 1 + mention.name.length
  }
  return { content: content.trim(), mentions }
}

/** Whether a name that stops here stands as a whole word: nothing follows, or what follows is not a letter or digit. */
function endsWord(text: string, index: number): boolean {
  return index >= text.length || !/[\p{L}\p{N}_]/u.test(text[index]!)
}

/**
 * ZCode's composer docked under the conversation, with Jam's behaviour (user guide, "Send an addressed message"): type @
 * or select Mention to choose who the message is for; sending without a mention keeps the draft and opens the picker, as
 * Jam does. Enter sends, Shift+Enter adds a line. A file is attached by pasting it, dropping it, or choosing it with
 * Attach files beside Mention, as Jam's room composer offers (user guide, "Use attachments"); the page that sends
 * stores the staged files of `scope` and the message carries the ids the store answered.
 */
export function Composer({
  mentionables,
  scope,
  placeholder = 'Tag an agent and describe the task…',
  onSend,
}: {
  mentionables: readonly Mentionable[]
  /** The staging this composer's files are kept in (lib/attachments.ts): its room's, or Inbox's reply to that room. */
  scope: string
  /** Jam's words in the empty field: a room's composer's, unless given (Inbox's reply says "Reply..."). */
  placeholder?: string
  onSend(message: { content: string; mentions: string[] }): Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [chosen, setChosen] = useState<Mentionable[]>([])
  const [picking, setPicking] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const staged = useStagedFiles(scope)
  const statusId = useId()
  const field = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  // Where the picker's choice goes: at the caret, replacing an "@" just typed there.
  const insertAt = useRef<{ start: number; end: number } | null>(null)

  const choose = (mention: Mentionable) => {
    const at = insertAt.current ?? { start: draft.length, end: draft.length }
    const before = draft.slice(0, at.start)
    // A mention stands as its own word: after text that does not end in a space, it takes one.
    const token = `${before && !/\s$/.test(before) ? ' ' : ''}@${mention.name} `
    const next = `${before}${token}${draft.slice(at.end)}`
    setDraft(next)
    // Chosen again, it moves to the end: of two with one name, the one chosen last is meant (outgoing).
    setChosen((current) => [...current.filter((item) => item.id !== mention.id), mention])
    insertAt.current = null
    setPicking(false)
    requestAnimationFrame(() => {
      const caret = before.length + token.length
      field.current?.focus()
      field.current?.setSelectionRange(caret, caret)
    })
  }

  const send = async () => {
    if (sending || !draft.trim()) return
    const message = outgoing(draft, chosen)
    if (message.mentions.length === 0) {
      // Jam keeps the draft and opens the mention picker: a message is addressed to someone.
      insertAt.current = null
      setPicking(true)
      return
    }
    setSending(true)
    // The files go out with this message as they stand now: none can be removed or added until it has gone.
    setStagingSending(scope, true)
    setError(null)
    try {
      await onSend(message)
      setDraft('')
      setChosen([])
      // The guide's own words for what happens to the staged files: "the staging strip clears".
      clearStaged(scope)
    } catch (reason) {
      setError(daemonErrorText(reason))
    } finally {
      setStagingSending(scope, false)
      setSending(false)
    }
  }

  const agents = mentionables.filter((item) => item.kind === 'agent')
  const people = mentionables.filter((item) => item.kind === 'person')
  const addressed = outgoing(draft, chosen).mentions.length > 0
  // Two participants with one name are told apart in the picker by their handles.
  const shared = new Set(
    mentionables.map((item) => item.name).filter((name, index, all) => all.indexOf(name) !== index),
  )
  const option = (mention: Mentionable) => (
    <DropdownMenuItem key={mention.id} onClick={() => choose(mention)}>
      <Initials name={mention.name} className="size-5" />
      <span className="min-w-0 flex-1 truncate">{mention.name}</span>
      {shared.has(mention.name) && mention.handle ? (
        <span className="max-w-32 truncate font-mono text-ui-xs text-foreground-subtle">{mention.handle}</span>
      ) : null}
    </DropdownMenuItem>
  )

  return (
    <div
      className="mx-auto flex w-full max-w-[848px] flex-col gap-3 rounded-2xl border border-line-strong bg-card p-3"
      {...dropTarget(staged.stage)}
    >
      <StagedFiles
        files={staged.files}
        problem={staged.problem}
        sending={staged.sending}
        statusId={statusId}
        field={field}
        onRemove={staged.remove}
      />
      <textarea
        ref={field}
        aria-label="Message"
        aria-describedby={statusId}
        rows={2}
        value={draft}
        disabled={sending}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={pasteFiles(staged.stage)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === '@' && mentionables.length > 0) {
            // The @ goes in as typed and the picker opens: a choice replaces that @, and closing the picker keeps it.
            const { selectionStart } = event.currentTarget
            insertAt.current = { start: selectionStart, end: selectionStart + 1 }
            setPicking(true)
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void send()
          }
        }}
        className="max-h-40 min-h-10 w-full resize-none bg-transparent text-ui-base leading-5 text-foreground outline-none select-text placeholder:text-foreground-subtlest disabled:opacity-60"
      />
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          The message was not sent: {error}
        </p>
      ) : null}
      <div className="flex items-center gap-1.5">
        <DropdownMenu
          open={picking}
          onOpenChange={(open) => {
            // Opened from the button, the choice goes at the caret; closed without a choice, nothing is replaced.
            if (open && !picking) {
              const caret = field.current?.selectionStart ?? draft.length
              insertAt.current = { start: caret, end: caret }
            }
            if (!open) insertAt.current = null
            setPicking(open)
          }}
        >
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" disabled={mentionables.length === 0}>
                <AtSign />
                Mention
              </Button>
            }
          />
          <DropdownMenuContent side="top" align="start" className="w-64">
            {agents.length ? (
              <DropdownMenuGroup>
                <DropdownMenuLabel>Agents</DropdownMenuLabel>
                {agents.map(option)}
              </DropdownMenuGroup>
            ) : null}
            {people.length ? (
              <DropdownMenuGroup>
                <DropdownMenuLabel>People</DropdownMenuLabel>
                {people.map(option)}
              </DropdownMenuGroup>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Jam's room composer: Mention, then Attach files (its control tree names both, in that order). */}
        <IconButton label="Attach files" side="top" disabled={staged.sending} onClick={() => picker.current?.click()}>
          <Paperclip />
        </IconButton>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            if (event.target.files) staged.stage(event.target.files)
            // The same file can be chosen again after it was removed.
            event.target.value = ''
          }}
        />
        <span className="flex-1" />
        <Button
          size="icon-sm"
          aria-label="Send"
          disabled={sending || !draft.trim()}
          title={addressed ? undefined : 'Mention who the message is for'}
          onClick={() => void send()}
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  )
}
