// export-set.mjs - what goes out when this repository is handed over: a clean export of source, fixtures, tests and
// scripts, with no git history and none of the builder's process notes. The identity check scans exactly this set, and
// `pnpm export:clean` (scripts/export.mjs) copies it.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localFile } from './local-file.mjs'

/**
 * Process notes: they describe the builder's own setup, not the app, so they stay home. Everything else the repository holds (tracked
 * or new, but not ignored) goes out.
 */
export const PROCESS_NOTES = [
  /^CLAUDE\.md$/,
  /^RESUME\.md$/,
  /^AGENTS\.md$/,
  /^GEMINI\.md$/,
  /^docs\/decisions\//,
  /^docs\/research\//,
  /^design\/reference\//,
  /^\.claude\//,
]

export const isProcessNote = (path) => PROCESS_NOTES.some((pattern) => pattern.test(path))

/**
 * What a file that goes out never says: the name of a process note that stays home (the reference would dangle). A reason
 * belongs in the comment itself, or in a document that goes out: README, NOTICE, docs/DESIGN.md, docs/jam/. Each pattern
 * is written so its own source text does not match it, so this file passes its own check.
 */
export const PROCESS_REFERENCES = [
  // In any letter case and with either slash: Windows treats a file name in any case as the same file.
  {
    kind: 'a process note that stays home',
    pattern: /\b(?:claude|resume|evaluation)\.md\b|\bdocs[\\/](?:decisions|research)\b/i,
  },
  // Capitals only: a lower-case agents.md could be an ordinary document about Jam's Agents screen.
  { kind: 'a process note that stays home', pattern: /\b(?:AGENTS|GEMINI)\.md\b/ },
  // A decision record named by its number alone: the record stays home, so the reference has nothing to point at.
  // Only a four-digit number followed by a verb of authorship counts, so a number in a fixture is left alone.
  {
    kind: 'a process note that stays home',
    pattern: /\b0[01]\d{2}\b(?=\s+(?:made|makes|said|says|did|does|built|builds|added|adds|chose|settled|recorded)\b)/i,
  },
  // ...or cited: in brackets, or after a word that points at it ("see NNNN", "per NNNN", "in NNNN", "record NNNN").
  // A number inside an id or a field ("room-NNNN") has neither, and is left alone.
  {
    kind: 'a process note that stays home',
    pattern: /\((?:see\s+)?0[01]\d{2}\)|\b(?:see|per|in|record|decision)\s+0[01]\d{2}\b/i,
  },
]

/**
 * Words for the builder's own setup (his events, tools and other projects, his workspace folders, the room and agent the
 * build records with). The check treats them like the rules above, but they are listed in the gitignored
 * `.local/setup-words.json` - an array of `{pattern, flags}` regular expressions - so the repository never spells them out.
 * A copy handed over has no such file, and so no such words.
 */
export function setupReferences(root) {
  const file = localFile(root, 'setup-words.json')
  if (!file) return []
  return JSON.parse(readFileSync(file, 'utf8')).map(({ pattern, flags = 'i' }) => ({
    kind: "the builder's own setup",
    pattern: new RegExp(pattern, flags),
  }))
}

/** Files that would go out, relative to `root`, with forward slashes. */
export function exportSet(root) {
  return listed(root)
    .filter((path) => !isProcessNote(path))
    .toSorted()
}

/**
 * Whether `root` holds any process note. Every checkout of this repository does, since they are tracked (a fresh clone,
 * and one whose untracked folders were cleaned, included); a clean export never does.
 */
export const holdsProcessNotes = (root) => listed(root).some(isProcessNote)

/**
 * What git lists under `root`, with forward slashes: the files it tracks and the new ones no ignore rule covers. A folder
 * that is not the top of a work tree of its own (the clean export, as whoever receives it first has it, or a copy
 * unpacked inside a larger repository) is listed through an empty repository kept in a temporary folder, so the folder's
 * own .gitignore decides and nothing is written into it. There a file that was tracked although an ignore rule covers
 * it is not listed, since no index says it is tracked.
 */
function listed(root) {
  const args = ['ls-files', '--cached', '--others', '--exclude-standard', '-z']
  const options = { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  const split = (text) =>
    text
      .split('\0')
      .filter(Boolean)
      .map((path) => path.replaceAll('\\', '/'))
  if (isOwnWorkTree(root)) return split(execFileSync('git', args, options))
  const gitDir = mkdtempSync(join(tmpdir(), 'export-set-'))
  try {
    execFileSync('git', ['init', '--bare', '--quiet', gitDir], { stdio: 'ignore' })
    return split(execFileSync('git', [`--git-dir=${gitDir}`, `--work-tree=${root}`, ...args], options))
  } finally {
    rmSync(gitDir, { recursive: true, force: true })
  }
}

/**
 * Whether `root` is the top of a git work tree: a folder in no repository is not, nor is one inside another repository,
 * whose rules would otherwise decide what it holds (a copy unpacked where the larger repository ignores it would list
 * nothing). Any other refusal from git is not guessed at: it is thrown, so the check fails rather than looking at less.
 */
function isOwnWorkTree(root) {
  const answer = spawnSync('git', ['rev-parse', '--show-prefix'], { cwd: root, encoding: 'utf8' })
  if (answer.error) throw answer.error
  if (answer.status === 0) return answer.stdout.trim() === ''
  if (/not a git repository/i.test(answer.stderr)) return false
  throw new Error(`git could not say what ${root} holds: ${answer.stderr.trim()}`)
}
