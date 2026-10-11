import type { ClipboardEvent, DragEvent } from 'react'
import { create } from 'zustand'
import {
  ATTACHMENT_LIMITS,
  ATTACHMENT_MIME,
  ATTACHMENT_MIME_MAX,
  isAttachmentName,
  type FileStoreInput,
} from '@shared/daemon-api'
import { daemonErrorText } from '@/lib/daemon-error'

/**
 * Files staged onto a message or an assignment (user guide, "Use attachments": "Paste a file into the composer or
 * drop it onto the composer. Staged files appear above the instruction. Remove a file before sending."). The page
 * keeps each file as the browser gave it - its name, its kind, its size and the bytes behind them - and reads the
 * bytes only when the file is stored, one file at a time, as the base64 the artifact store takes (`source: {kind:
 * "bytes"}`, recorded). No path is learned or sent.
 *
 * What is staged belongs to a composer, not to the component that draws it: Home's, or one room's. It is kept here,
 * so a room's composer that is taken off the screen (the Work view, a re-read of the room's participants) finds its
 * files again, and two drops close together count each other against Jam's limit.
 */

/** One staged file: the browser's own file, and what the strip shows of it. */
export interface StagedFile {
  /** A key the page gives it, so two files with one name can be staged and removed apart. */
  key: string
  file: File
  name: string
  mime: string
  bytes: number
  /** Once stored: the id the store answered and where it is bound ('' = unbound). A retry stores only the rest. */
  stored?: { id: string; roomId: string }
}

export interface Staging {
  files: StagedFile[]
  /** Why the last files could not be staged, naming each; cleared by the next staging or a removal. */
  problem: string | null
  /** True while a send or an assignment is on its way: the files it carries cannot change under it. */
  sending: boolean
}

const EMPTY: Staging = Object.freeze({ files: [], problem: null, sending: false }) as Staging

export const useStaging = create<{ scopes: Record<string, Staging> }>(() => ({ scopes: {} }))

/**
 * The composer a staging belongs to: Home's (one per profile), one room's, or Inbox's reply to one room. The reply keeps
 * its own, as it keeps its own draft: files staged in a room's composer do not go with a reply sent from Inbox.
 */
export const homeScope = (profile: string) => `home:${profile}`
export const roomScope = (profile: string, roomId: string) => `room:${profile}:${roomId}`
export const inboxScope = (profile: string, roomId: string) => `inbox:${profile}:${roomId}`

const current = (scope: string): Staging => useStaging.getState().scopes[scope] ?? EMPTY
const put = (scope: string, next: Partial<Staging>) =>
  useStaging.setState((state) => ({
    scopes: { ...state.scopes, [scope]: { ...(state.scopes[scope] ?? EMPTY), ...next } },
  }))

/** This app's own words for adding files while a send is on its way; Jam was never seen in that state. */
export const STAGING_WHILE_SENDING = 'Files can be added once this message has gone.'

/** A file's name as a refusal quotes it: whole if short, cut in the middle if long, so both ends still show. */
export const quoted = (name: string) => `“${name.length > 48 ? `${name.slice(0, 30)}…${name.slice(-14)}` : name}”`

/** The bytes of a staged file, as the artifact store takes them. Read in steps: `btoa` takes a string. */
export function bytesToBase64(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer)
  const parts: string[] = []
  for (let at = 0; at < view.length; at += 8192) {
    parts.push(String.fromCharCode(...view.subarray(at, at + 8192)))
  }
  return btoa(parts.join(''))
}

/**
 * Why this file cannot be staged, or null if it can. The limits are Jam's own (user guide: "The attachment limit is ten
 * files per message and 32 MB per file."; "Home rejects a file larger than 32 MB."), and so are the words for the ten
 * files; the rest are this app's own, and each names the file. A name the store is never sent (isAttachmentName) and
 * an empty file are refused here, where the person can see which file it was, rather than failing every send.
 */
export function stagingProblem(
  staged: readonly { bytes: number }[],
  candidate: { name: string; bytes: number },
): string | null {
  if (!candidate.name.trim()) return 'A file without a name cannot be attached.'
  if (!isAttachmentName(candidate.name)) return `${quoted(candidate.name)} has a name that cannot be attached.`
  if (candidate.bytes === 0) return `${quoted(candidate.name)} is empty.`
  if (candidate.bytes > ATTACHMENT_LIMITS.bytes) return `${quoted(candidate.name)} is larger than 32 MB.`
  if (staged.length >= ATTACHMENT_LIMITS.files) return 'The attachment limit is ten files per message.'
  return null
}

/** The kind the store is told: the browser's, if it is one the store takes, and otherwise plain bytes. */
const kindOf = (type: string) =>
  type.length <= ATTACHMENT_MIME_MAX && ATTACHMENT_MIME.test(type) ? type : 'application/octet-stream'

let stagedKey = 0

/**
 * Stages what a paste, a drop or the picker gave, in order. A file that cannot go on is refused by name and the ones
 * after it still stage. It runs at once, with nothing awaited, so a second drop right after the first is counted
 * against the limit with it; and while a send is on its way nothing changes.
 */
export function stageFiles(scope: string, given: FileList | readonly File[]): void {
  const now = current(scope)
  if (now.sending) {
    put(scope, { problem: STAGING_WHILE_SENDING })
    return
  }
  const files = [...now.files]
  const refusals: string[] = []
  for (const file of Array.from(given)) {
    const refusal = stagingProblem(files, { name: file.name, bytes: file.size })
    if (refusal) {
      if (!refusals.includes(refusal)) refusals.push(refusal)
      continue
    }
    stagedKey += 1
    files.push({ key: `staged-${stagedKey}`, file, name: file.name, mime: kindOf(file.type), bytes: file.size })
  }
  put(scope, { files, problem: refusals.length > 0 ? refusals.join(' ') : null })
}

/** Removes one staged file; nothing is removed while a send carrying it is on its way. */
export function removeStaged(scope: string, key: string): void {
  const now = current(scope)
  if (now.sending) return
  put(scope, { files: now.files.filter((file) => file.key !== key), problem: null })
}

/** After a successful send, in the guide's own words: "the staging strip clears". */
export function clearStaged(scope: string): void {
  put(scope, { files: [], problem: null })
}

export function setStagingSending(scope: string, sending: boolean): void {
  put(scope, { sending })
}

/** Something that stores one file: the bridge's daemon operation. */
export type FileStorer = (input: FileStoreInput) => Promise<{ id: string }>

/** A staged file that could not be read or stored. Its message names the file and is this app's own. */
export class AttachmentError extends Error {}

/**
 * Stores each staged file of a composer that is not stored there yet - bound to `roomId`, or unbound (`''`) for an
 * assignment, which opens its room only when it is sent - and answers the ids in the order the files were staged. A
 * file already stored in the same place is not stored again, so a send that failed after its files were stored does
 * not store them twice when it is tried again. The first file that fails stops it, and says which file it was.
 */
export async function storeStaged(
  scope: string,
  store: FileStorer,
  profile: string,
  roomId: string,
): Promise<string[]> {
  const ids: string[] = []
  for (const staged of current(scope).files) {
    if (staged.stored && staged.stored.roomId === roomId) {
      ids.push(staged.stored.id)
      continue
    }
    let content: string
    try {
      content = bytesToBase64(await staged.file.arrayBuffer())
    } catch {
      throw new AttachmentError(`${quoted(staged.name)} could not be read.`)
    }
    let id: string
    try {
      ;({ id } = await store({ profile, roomId, name: staged.name, mime: staged.mime, content }))
    } catch (error) {
      // What the main process says is its own wording: the daemon's words for this route never reach the page.
      throw new AttachmentError(`${quoted(staged.name)} could not be attached: ${daemonErrorText(error)}.`)
    }
    put(scope, {
      files: current(scope).files.map((file) => (file.key === staged.key ? { ...file, stored: { id, roomId } } : file)),
    })
    ids.push(id)
  }
  return ids
}

/** A composer's staging and its ways in and out. */
export function useStagedFiles(scope: string) {
  const staging = useStaging((state) => state.scopes[scope] ?? EMPTY)
  return {
    ...staging,
    stage: (given: FileList | readonly File[]) => stageFiles(scope, given),
    remove: (key: string) => removeStaged(scope, key),
  }
}

/**
 * A composer's drop target: a file dropped anywhere on it is staged, and a drag carrying files is taken, because a
 * drop that is not allowed to land becomes a navigation to the file.
 */
export function dropTarget(stage: (files: FileList) => void) {
  return {
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer.types.includes('Files')) event.preventDefault()
    },
    onDrop: (event: DragEvent) => {
      if (event.dataTransfer.files.length === 0) return
      event.preventDefault()
      stage(event.dataTransfer.files)
    },
  }
}

/**
 * A paste that carries files stages them. One that carries text as well pastes the text instead: a copy from a
 * spreadsheet or a document puts a picture of what was copied beside the text, and the text is what was meant.
 */
export function pasteFiles(stage: (files: FileList) => void) {
  return (event: ClipboardEvent) => {
    const data = event.clipboardData
    if (data.files.length === 0) return
    if (data.types.includes('text/plain') || data.types.includes('text/html')) return
    event.preventDefault()
    stage(data.files)
  }
}
