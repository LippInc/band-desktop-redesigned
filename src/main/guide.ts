import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { GuideRead } from '@shared/guide'

/**
 * Jam's own user guide, read from the Jam install on this computer.
 *
 * The daemon says where it runs from (`executable`, in its ping answer), and Jam keeps `user-guide.md` beside it.
 * That is the one Jam file this app reads: never its configuration, never its state, never anything it would write.
 * The guide is never copied into this project - it is Jam's, and it stays in Jam's install (NOTICE).
 *
 * The path never leaves this process. The page is given the guide's text and nothing else, because a path from this
 * machine is not something a page needs, and everything a page is given can be read by anything the page renders.
 */

/** The guide Jam ships beside its daemon. */
const GUIDE_FILE = 'user-guide.md'

/** A guide larger than this is not one: it is read no further, so a wrong file cannot fill memory. */
const MAX_BYTES = 4_000_000

/**
 * The folder to look in, or null when the daemon named somewhere this app will not read from.
 *
 * Everything the daemon says is untrusted, and this is the one value of its answer that steers a read off the disk,
 * so it is checked before it is used. A relative path would be resolved against whatever folder the app happens to
 * be running in. A path on another computer (`\\host\share\…`) would send this machine's credentials to whoever
 * named the host, over a value any local process answering the pipe could have supplied. Only an absolute path on
 * this computer is read from; Windows' long-path prefix is taken off first, because it is one of those.
 */
function localDirectory(executable: string): string | null {
  const LONG_PATH = '\\\\?\\' // Windows' long-path prefix, which a real install path may carry
  const path = executable.startsWith(LONG_PATH) ? executable.slice(LONG_PATH.length) : executable
  // What is left must be an absolute path on this computer. A leading backslash is either another computer's share
  // or a Windows path with no drive, which resolves against whichever drive is current; a leading `//` is the same
  // share written the other way; and `UNC\…` is what a share looks like once the prefix above has been taken off.
  if (path.startsWith('//') || path[0] === '\\' || /^UNC[\\/]/i.test(path)) return null
  if (!isAbsolute(path)) return null
  return dirname(path)
}

/**
 * What a failed look at the guide means. Nothing there is "no guide"; anything else - a permission, a name the
 * filesystem will not take - is a guide that could not be read, and saying "none" would state something untrue
 * about the Jam install.
 */
export function stateForError(error: unknown): GuideRead {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? { state: 'not-found' } : { state: 'unreadable' }
}

/**
 * Reads the guide beside the running daemon. `executable` comes from the daemon's own ping answer, which this app
 * reads in full here rather than through the page's schema: the schema drops the path on purpose.
 */
export async function readGuide(executable: string | null): Promise<GuideRead> {
  if (!executable) return { state: 'no-daemon' }
  const install = localDirectory(executable)
  if (!install) return { state: 'not-found' }
  const path = join(install, GUIDE_FILE)
  try {
    const info = await stat(path)
    if (!info.isFile()) return { state: 'unreadable' }
    if (info.size > MAX_BYTES) return { state: 'unreadable' }
  } catch (error) {
    return stateForError(error)
  }
  try {
    const markdown = await readFile(path, 'utf8')
    // A file of nothing is not a guide, and a page that showed it would say Jam ships an empty one.
    return markdown.trim() === '' ? { state: 'unreadable' } : { state: 'read', markdown }
  } catch {
    return { state: 'unreadable' }
  }
}
