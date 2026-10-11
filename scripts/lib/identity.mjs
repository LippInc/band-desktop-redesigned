// identity.mjs - finds a person's identity or a secret in text. The needles are gathered at run time from the machine it
// runs on and from a gitignored cache (.local/identity-needles.json, written by `pnpm fixtures:record` from the live
// daemon), so this file and its tests never hold anyone's identity themselves.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { localFile } from './local-file.mjs'

/** Shapes that are secrets or machine paths wherever they appear. */
export const PATTERNS = [
  { kind: 'a Windows user folder', pattern: /\b[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|<)[A-Za-z0-9._ -]{2,}/ },
  { kind: 'a macOS user folder', pattern: /\/Users\/(?!Shared\b|<)[A-Za-z0-9._-]{2,}\// },
  { kind: 'a Linux home folder', pattern: /\/home\/(?!<)[A-Za-z0-9._-]{2,}\// },
  { kind: 'a Jam pipe name', pattern: /\bjam-[0-9a-f]{32}\b/i },
  { kind: 'an API key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/ },
  { kind: 'a GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { kind: 'a Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: 'an AWS key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'a JSON web token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./ },
  { kind: 'a private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'a Band or Tavily key', pattern: /\b(?:band|tvly)[_-][A-Za-z0-9]{24,}/ },
]

/** Needles shorter than this would match ordinary words, so they are left out (the patterns still apply). */
const MIN_NEEDLE = 4

/**
 * The accounts containers and CI machines run as. Each is an ordinary word in this repository (node_modules, root,
 * runner), so as a needle it would fail every file; such a machine has no one's identity to keep out anyway.
 */
export const GENERIC_USERS = new Set([
  'root',
  'node',
  'runner',
  'runneradmin',
  'user',
  'admin',
  'administrator',
  'ubuntu',
  'vscode',
  'codespace',
  'gitpod',
  'docker',
  'jenkins',
  'circleci',
  'builder',
  'app',
])

/** The cached account needles (`.local/identity-needles.json`, a worktree's main checkout included), or null. */
export const needleCacheFile = (root) => localFile(root, 'identity-needles.json')

/**
 * Everything that identifies the person on this machine: their Windows or Unix user name and home folder, their git name and
 * email, the Jam pipe hashes present now, and what the live daemon said about their account (cached; `cache` is the file
 * read, or null when there was none).
 */
export function gatherNeedles({ root, cacheFile = needleCacheFile(root) } = {}) {
  const needles = []
  const add = (value, kind) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed.length >= MIN_NEEDLE) needles.push({ value: trimmed, kind })
  }
  try {
    const name = userInfo().username
    if (!GENERIC_USERS.has(name.toLowerCase())) add(name, 'the user name on this machine')
  } catch {
    // no user record (a container); the patterns still catch home folders
  }
  add(homedir(), 'the home folder on this machine')
  for (const [key, kind] of [
    ['user.email', 'the git email'],
    ['user.name', 'the git name'],
  ]) {
    try {
      add(execFileSync('git', ['config', key], { cwd: root, encoding: 'utf8' }), kind)
    } catch {
      // not set
    }
  }
  if (process.platform === 'win32') {
    try {
      for (const name of readdirSync('\\\\.\\pipe\\')) {
        const hash = /^jam-([0-9a-f]{16,64})$/i.exec(name)?.[1]
        if (hash) add(hash, 'the Jam pipe hash')
      }
    } catch {
      // pipes cannot be listed
    }
  }
  const cache = cacheFile && existsSync(cacheFile) ? cacheFile : null
  if (cache) {
    for (const [kind, values] of Object.entries(JSON.parse(readFileSync(cache, 'utf8')))) {
      for (const value of Array.isArray(values) ? values : [values]) add(value, kind)
    }
  }
  return { needles: dedupe(needles), cache }
}

function dedupe(needles) {
  const seen = new Set()
  return needles.filter((needle) => {
    const key = needle.value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * How a needle is looked for. A name-like needle (letters, digits, `_`, `-`, spaces) must stand as a whole word, so a
 * surname never matches inside an ordinary word ("flipped"); anything with punctuation (an email, a path) is a plain
 * substring, also with its backslashes written as slashes or doubled.
 */
function matcher(value) {
  const lower = value.toLowerCase()
  if (/^[a-z0-9_ -]+$/i.test(value)) return new RegExp(`(?<![a-z0-9])${escape(lower)}(?![a-z0-9])`)
  const forms = [lower, lower.replaceAll('\\', '/'), lower.replaceAll('\\', '\\\\')]
  return { test: (line) => forms.some((form) => line.includes(form)) }
}

/**
 * Every finding in one text: which line, and what was found (never the value itself, so logs stay clean). A needle is
 * reported once per line: found whole, else in parts, else by its head; an id that is part of a longer needle counts as
 * found with it.
 */
export function scanText(text, needles, { patterns = PATTERNS } = {}) {
  const findings = []
  const matchers = needles.map((needle) => ({ kind: needle.kind, match: matcher(needle.value) }))
  const seen = new Set()
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const lower = line.toLowerCase()
    matchers.forEach(({ kind, match }, needle) => {
      if (!match.test(lower)) return
      findings.push({ line: index + 1, kind })
      seen.add(`${index + 1}:${needle}`)
    })
    for (const { kind, pattern } of patterns) {
      if (pattern.test(line)) findings.push({ line: index + 1, kind })
    }
  })
  for (const { line, needles: along } of inParts(lines, needles)) {
    if (along.some((needle) => seen.has(`${line}:${needle}`))) continue
    findings.push({ line, kind: `${needles[along[0]].kind}, in parts` })
    for (const needle of along) seen.add(`${line}:${needle}`)
  }
  const heads = new Map()
  needles.forEach((needle, index) => {
    for (const head of uuidHeads(needle.value)) heads.set(head, [...(heads.get(head) ?? []), index])
  })
  lines.forEach((line, index) => {
    const lower = line.toLowerCase()
    for (const [head, along] of heads) {
      if (along.some((needle) => seen.has(`${index + 1}:${needle}`)) || !standsAlone(lower, head)) continue
      findings.push({ line: index + 1, kind: `${needles[along[0]].kind}, its first eight characters` })
      for (const needle of along) seen.add(`${index + 1}:${needle}`)
    }
  })
  return findings
}

/** How many of a needle's hex characters in a row, with anything but hex between them, still count as that needle. */
export const RUN_IN_PARTS = 12

/** A needle's hex runs long enough to be an id or a hash, with the dashes inside a run (a UUID's) dropped. */
const hexRuns = (value) =>
  (value.toLowerCase().match(/[0-9a-f]+(?:-[0-9a-f]+)*/g) ?? [])
    .map((run) => run.replaceAll('-', ''))
    .filter((run) => run.length >= 16)

/**
 * Every 12-character stretch of every long hex run, to the needles it came from: an id inside a longer needle (a user id
 * inside an account's instance) belongs to both. Kept for the last list of needle values seen.
 */
let cached = { key: '', stretches: new Map() }
function stretches(needles) {
  const key = JSON.stringify(needles.map((needle) => needle.value))
  if (key === cached.key) return cached.stretches
  const found = new Map()
  needles.forEach((needle, index) => {
    for (const run of hexRuns(needle.value)) {
      for (let at = 0; at + RUN_IN_PARTS <= run.length; at += 1) {
        const stretch = run.slice(at, at + RUN_IN_PARTS)
        const along = found.get(stretch) ?? []
        if (!along.includes(index)) along.push(index)
        found.set(stretch, along)
      }
    }
  })
  cached = { key, stretches: found }
  return found
}

/** Two ways to read a line's hex in order: every hex character, or only its runs of four or more. */
const EVERY_HEX = (line) => line.replace(/[^0-9a-f]/g, '')
const RUNS_ONLY = (line) => (line.match(/[0-9a-f]{4,}/g) ?? []).join('')

/**
 * An id is still that id with other characters between its pieces: built from parts
 * (`['art-', 'ab12…', 'cd34…'].join('')`), held in several variables, or wrapped across lines, which the whole-needle
 * search never sees. The text's hex is read in order twice: every hex character (pieces of two or three survive), and
 * only its runs of four or more (so the hex letters in the words between the pieces - `const`, `a`, `bed` - drop out).
 * Any 12 of a needle's hex characters in a row there count as that needle. A random id's 12-character stretch turns up
 * by chance about once in 16^12 (3 × 10^14) places, so a UUID's 21 stretches about once in 10^13; ordinary words give
 * runs of the letters a-f, where a random id's stretches mix in digits. An id is found on the line its first stretch
 * starts on, however many stretches follow it; scanText reports it once per line, whichever reading found it.
 */
function inParts(lines, needles) {
  const known = stretches(needles)
  if (known.size === 0) return []
  const found = []
  for (const read of [EVERY_HEX, RUNS_ONLY]) {
    const starts = []
    let text = ''
    for (const line of lines) {
      starts.push(text.length)
      text += read(line.toLowerCase())
    }
    const last = new Map()
    let line = 0
    for (let at = 0; at + RUN_IN_PARTS <= text.length; at += 1) {
      const along = known.get(text.slice(at, at + RUN_IN_PARTS))
      if (!along) continue
      const fresh = along.filter((needle) => last.get(needle) !== at - 1)
      for (const needle of along) last.set(needle, at)
      if (fresh.length === 0) continue
      while (line + 1 < starts.length && starts[line + 1] <= at) line += 1
      found.push({ line: line + 1, needles: along })
    }
  }
  return found
}

/**
 * A UUID needle's first eight characters: the head a screen shows for an id (a room named by the start of its id), too
 * short to count in parts. It counts only standing alone, with no hex character on either side.
 */
const uuidHeads = (value) =>
  [
    ...value
      .toLowerCase()
      .matchAll(/(?<![0-9a-f])([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/g),
  ].map((match) => match[1])
const standsAlone = (line, head) => {
  for (let at = line.indexOf(head); at !== -1; at = line.indexOf(head, at + 1)) {
    if (!/[0-9a-f]/.test(line[at - 1] ?? '') && !/[0-9a-f]/.test(line[at + head.length] ?? '')) return true
  }
  return false
}
