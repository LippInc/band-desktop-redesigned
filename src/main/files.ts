import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { shell } from 'electron'
import type { FileAction, FileResult, FileVerdict } from '@shared/ipc-contract'
import type { DaemonClient } from './daemon/client'

/**
 * What the app does with a room's file on this computer: open it, show it in the file manager, and check it against
 * the checksum the daemon recorded. The page never learns where a file is: it names the file by its artifact id and
 * this process asks the daemon for the path (`DaemonClient.artifactFile`), so a path the daemon gives never crosses
 * into the renderer.
 */

/**
 * Extensions this app will not hand to the system's default handler, because opening one of them runs it. A room's
 * files come from its participants, and a participant is not this app's to trust (README, "What this app never
 * does"): one click in a file list should never start a program. The file is shown in the file manager instead, where
 * opening it is the person's own deliberate act. This is a difference from Jam, with its reason
 * (`docs/jam/differences.md`).
 *
 * All three platforms this app runs from source on are covered, not only the one it is packaged for.
 */
const RUNNABLE = new Set([
  // Windows
  '.exe',
  '.com',
  '.scr',
  '.pif',
  '.msi',
  '.msp',
  '.msc',
  '.cpl',
  '.bat',
  '.cmd',
  '.ps1',
  '.psm1',
  '.ps1xml',
  '.vbs',
  '.vbe',
  '.vb',
  '.js',
  '.jse',
  '.ws',
  '.wsf',
  '.wsc',
  '.wsh',
  '.hta',
  '.reg',
  '.lnk',
  '.url',
  '.inf',
  '.scf',
  '.application',
  '.appref-ms',
  '.xll',
  '.chm',
  '.jar',
  '.gadget',
  // macOS
  '.app',
  '.pkg',
  '.scpt',
  '.scptd',
  '.workflow',
  '.terminal',
  '.dmg',
  '.command',
  // Linux
  '.desktop',
  '.run',
  '.appimage',
  // Windows runs these from Explorer too, and each is a documented way to carry a command line.
  '.settingcontent-ms',
  '.diagcab',
  '.wsb',
  '.appx',
  '.appxbundle',
  '.msix',
  '.msixbundle',
  '.msu',
  '.website',
  // An interpreter on any of them
  '.sh',
  '.bash',
  '.zsh',
  '.csh',
  '.fish',
  '.py',
  '.pyw',
  '.pl',
  '.rb',
  '.php',
])

/**
 * Whether the system would run this file rather than open it.
 *
 * Two ways a name gets past a careless check, and both are the only input this guard exists for - a name a room
 * participant chose:
 *
 * - **A trailing dot or space.** Windows strips both before it resolves a name, so `payload.exe.` and `payload.exe `
 *   reach `payload.exe`. A name that needs stripping at all counts as runnable here: nothing legitimate ends that way.
 * - **A leading dot.** `path.extname` treats a dotfile as having no extension at all, so it answers `''` for `.exe`
 *   - while Windows takes everything after the last dot and runs it. The extension is therefore taken from the last
 *   dot wherever it falls, including the first character, rather than with `extname`.
 */
export function isRunnable(name: string): boolean {
  const plain = basename(name)
  const trimmed = plain.replace(/[\s.]+$/, '')
  if (trimmed !== plain) return true
  const dot = trimmed.lastIndexOf('.')
  return dot === -1 ? false : RUNNABLE.has(trimmed.slice(dot).toLowerCase())
}

/**
 * Whether this app will hand a path to the system at all: an absolute path on this computer. A path with two leading
 * separators is a UNC path, which reaches another machine, and the daemon's answers are not this app's to trust.
 */
export function isLocalPath(path: string): boolean {
  if (!isAbsolute(path)) return false
  return !/^[\\/]{2}/.test(path)
}

/** How much of a file this app will hash for Verify. Past it, Verify says so rather than reading for minutes. */
export const VERIFY_MAX_BYTES = 2 * 1024 * 1024 * 1024

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/**
 * Opens a room's file, or shows it in the file manager. Neither ever receives a path from the page.
 *
 * `unavailable` and `missing` are kept apart on purpose: the daemon not answering is not the same as this computer
 * having no copy of a file, and saying the second would be a claim about the person's own files that nobody checked
 * (degrade, never break).
 */
export async function actOnFile(
  daemon: DaemonClient,
  action: FileAction,
  profile: string,
  id: string,
): Promise<FileResult> {
  const found = await daemon.artifactFile(profile, id)
  if (found === 'unavailable') return { done: false, reason: 'unavailable' }
  if (!found) return { done: false, reason: 'missing' }
  const { path } = found
  if (!isLocalPath(path)) return { done: false, reason: 'elsewhere' }
  try {
    await stat(path)
  } catch {
    return { done: false, reason: 'missing' }
  }
  if (action === 'reveal') {
    shell.showItemInFolder(path)
    return { done: true }
  }
  // Opening is what runs a program, so a runnable file is revealed instead and the page says why.
  if (isRunnable(path)) {
    shell.showItemInFolder(path)
    return { done: false, reason: 'runnable' }
  }
  // The system's own sentence for a refusal can name the path, so it stops here: the page is told only that the
  // copy is present and would not open, which is not the same as having no copy.
  const problem = await shell.openPath(path)
  return problem ? { done: false, reason: 'unopenable' } : { done: true }
}

/**
 * Checks a room's file against the checksum the daemon recorded for it. The checksum compared is the daemon's own, read
 * here rather than taken from the page, so the page cannot ask for a file to be checked against a checksum it chose.
 */
export async function verifyFile(
  daemon: DaemonClient,
  profile: string,
  id: string,
  /** How much will be read; a test lowers it, because a file the size of the real limit cannot be written in one. */
  maxBytes: number = VERIFY_MAX_BYTES,
): Promise<FileVerdict> {
  const found = await daemon.artifactFile(profile, id)
  if (found === 'unavailable') return 'unavailable'
  if (!found) return 'missing'
  if (!found.sha256) return 'unknown'
  const { path, sha256: recorded } = found
  if (!isLocalPath(path)) return 'missing'
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return 'missing'
  }
  if (size > maxBytes) return 'too-large'
  try {
    return (await sha256Of(path)) === recorded.toLowerCase() ? 'matches' : 'differs'
  } catch {
    return 'missing'
  }
}
