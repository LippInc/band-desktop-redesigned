// local-file.mjs - finds a file in the gitignored `.local/` folder: this checkout's, or the main checkout's when this is a
// git worktree (worktrees share the repository but not `.local/`, so a parallel session still finds it).
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Whether this checkout, or the main one, has a `.local/` folder at all (a copy handed over never does). */
export const hasLocalFolder = (root) => localFile(root, '.') !== null

/** The path of `.local/<name>`, or null when neither this checkout nor the main one has it. */
export function localFile(root, name) {
  const own = join(root, '.local', name)
  if (existsSync(own)) return own
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const main = join(dirname(common), '.local', name)
    if (existsSync(main)) return main
  } catch {
    // not a git checkout
  }
  return null
}
