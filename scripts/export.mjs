// export.mjs - `pnpm export:clean <folder>`: the clean copy of this repository that is handed over. It copies exactly
// what goes out (scripts/lib/export-set.mjs: the files git tracks or would track, without the builder's process notes),
// with no git history, into a folder outside the repository that is new or empty, and only once check-identity has passed
// on that same set: if it fails, nothing is copied. It says what it copied and how many process notes it left home.
//   --cache <file>   the account needles check-identity reads (the tests use it)
//   --no-account     check-identity without the account needles, where no Jam account applies
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { exportSet, isProcessNote } from './lib/export-set.mjs'

const root = resolve(import.meta.dirname, '..')

function fail(message) {
  console.error(`export: ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const passed = []
let target = null
for (let at = 0; at < args.length; at += 1) {
  if (args[at] === '--cache') {
    passed.push('--cache', args[at + 1] ?? '')
    at += 1
  } else if (args[at] === '--no-account') {
    passed.push('--no-account')
  } else if (target === null) {
    target = args[at]
  } else {
    fail(`unexpected argument: ${args[at]}`)
  }
}
if (!target) fail('usage: pnpm export:clean <folder>  (a new or empty folder outside this repository)')

const out = resolve(target)
const from = relative(root, out)
if (from === '' || (!from.startsWith('..') && !isAbsolute(from))) fail(`the folder is inside this repository: ${out}`)
if (existsSync(out) && readdirSync(out).length > 0) fail(`the folder is not empty: ${out}`)

// The identity check first, over the same set: a copy that holds someone's identity is never made.
const check = spawnSync(process.execPath, [join(root, 'scripts', 'check-identity.mjs'), ...passed], {
  cwd: root,
  encoding: 'utf8',
})
// Its warnings are shown as well as its failures: a check that ran without the account's needles must say so here too.
process.stderr.write(check.stderr)
if (check.status !== 0) fail('check-identity failed, so nothing was copied')

// A file git still lists but the working tree no longer holds goes nowhere, as the identity check skips it too.
const files = exportSet(root).filter((file) => existsSync(join(root, file)))
if (files.length === 0) fail('nothing to copy: the export set is empty')
for (const file of files) {
  const to = join(out, file)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(join(root, file), to)
}

const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
})
const home = listed.stdout.split(/\r?\n/).filter((file) => file && isProcessNote(file.replaceAll('\\', '/'))).length
console.log(`export: ${files.length} files copied to ${out}, with no git history; ${home} process notes left home`)
