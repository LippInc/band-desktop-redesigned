// check-identity.mjs - `pnpm check:identity` (part of `pnpm check`). Fails when anything that goes out (source, fixtures,
// tests, scripts: scripts/lib/export-set.mjs) holds the identity of the person on this machine, anything shaped like a key,
// or a reference to the builder's process notes or setup; in a file's text or in its name. A file it cannot read as
// UTF-8 text fails too: a binary not on the allowlist (by extension, or by a NUL byte anywhere in it: other tools, grep
// among them, then treat the whole file as binary and read none of it), a file with a UTF-16 mark, or one too large. The
// one name that passes is the copyright holder's, on the three lines that name the holder (scripts/lib/holder.mjs).
//   --no-account   run without the Jam account's needles (a checkout with no Jam account); a warning says so. A copy
//                  handed over (made by `pnpm export:clean`: no `.local/` folder and none of the process notes every
//                  checkout of this repository holds) runs that way by itself and says so, since no account was ever
//                  recorded in it; any checkout without the needles fails, a fresh clone included
//   --cache <file> read the account needles from this file (the tests use it)
//   --self-test    plant at least one known-bad file per rule in a temporary folder; fail unless every one is caught
//                  and the clean ones are not (the instrument check)
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { exportSet, holdsProcessNotes, PROCESS_REFERENCES, setupReferences } from './lib/export-set.mjs'
import { holderLines } from './lib/holder.mjs'
import { gatherNeedles, needleCacheFile, PATTERNS, scanText } from './lib/identity.mjs'
import { hasLocalFolder } from './lib/local-file.mjs'

const root = resolve(import.meta.dirname, '..')
const MAX_BYTES = 5 * 1024 * 1024
const BINARY = /\.(png|ico|icns|jpg|jpeg|gif|webp|woff2?|ttf|otf|zip|gz|exe|dll|pdf|mp4|webm)$/i
/** Binaries that were looked at and hold nothing personal: the app icon this repository draws itself (scripts/make-icon.py). */
const ALLOWED_BINARIES = ['build/icon.png', 'build/icon.ico']
const RULES = [...PATTERNS, ...PROCESS_REFERENCES, ...setupReferences(root)]
/** The self-test's own setup words, standing in for the ones in .local/setup-words.json. */
const SELF_SETUP = { kind: "the builder's own setup", pattern: /\bglimmerfest\b|\bzephyr-room\b/i }

/**
 * A NUL byte anywhere, or a UTF-16 byte-order mark: read as UTF-8, a name in it would never match, and a NUL deep in a
 * source file (the kind an editor writes when it decodes an escape) makes other tools skip the file as binary.
 */
function looksBinary(bytes) {
  const utf16 =
    bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  return utf16 || bytes.includes(0)
}

function scanFiles(
  base,
  files,
  needles,
  { maxBytes = MAX_BYTES, allowedBinaries = ALLOWED_BINARIES, rules = RULES } = {},
) {
  const findings = []
  // What the rules report (key shapes, paths, process references) is never let through, even on a line that names the
  // holder.
  const kinds = new Set(rules.map((rule) => rule.kind))
  const named = holderLines(base)
  for (const file of files) {
    // A file git still has in the index but the working tree no longer holds goes nowhere, so neither its name nor
    // its contents are checked. Existence is settled first, before the name, for that reason.
    const path = join(base, file)
    let size
    try {
      size = statSync(path).size
    } catch {
      continue // listed but deleted in the working tree
    }
    for (const finding of scanText(file, needles, { patterns: rules })) {
      findings.push({ file, line: 0, kind: `${finding.kind}, in the file name` })
    }
    if (size > maxBytes) {
      findings.push({ file, line: 0, kind: `a file too large to check (over ${maxBytes} bytes)` })
      continue
    }
    const bytes = readFileSync(path)
    if (BINARY.test(file) || looksBinary(bytes)) {
      if (!allowedBinaries.includes(file)) {
        findings.push({
          file,
          line: 0,
          kind: 'a file the check cannot read as UTF-8 text (look at it, then allow it here)',
        })
      }
      continue
    }
    for (const finding of scanText(bytes.toString('utf8'), needles, { patterns: rules })) {
      // The holder's own name, on a line that names the copyright holder (holder.mjs); a key shape or a process reference
      // on that line is still a finding.
      if (named.has(`${file}:${finding.line}`) && !kinds.has(finding.kind)) continue
      findings.push({ file, ...finding })
    }
  }
  return findings
}

if (process.argv.includes('--self-test')) {
  const planted = mkdtempSync(join(tmpdir(), 'jamr-identity-'))
  const needles = [
    { value: 'Plantedperson', kind: 'the user name on this machine' },
    { value: 'planted.person@example.org', kind: 'the git email' },
    { value: 'art-5f0c2d7e9a1b3c4d6e8f0a21', kind: 'a recorded artifact id' },
    { value: '0c9d8e7f-6a5b-4c3d-9e2f-1a0b9c8d7e6f', kind: 'a recorded room id' },
  ]
  const cases = {
    'name.txt': 'written by Plantedperson',
    'email.json': '{"email": "planted.person@example.org"}',
    // Built from parts, so this file holds no whole path, pipe name, token or process-note name for the real scan to find.
    'winpath.ts': `const p = "${['C:', 'Users', 'someone', 'AppData', 'Local', 'jam'].join('\\\\')}"`,
    'pipe.md': `the pipe was jam-${'01'.repeat(16)}`,
    'key.env': 'KEY=sk-ant-' + 'a'.repeat(30),
    'github.txt': 'token ' + ['gh', 'p_'].join('') + 'B'.repeat(36),
    'slack.txt': 'hook ' + ['xo', 'xb-'].join('') + '1234567890-abcdefghij',
    'aws.txt': 'id ' + ['AK', 'IA'].join('') + 'ABCDEFGHIJKLMNOP',
    'band.txt': 'key ' + ['ba', 'nd_'].join('') + 'x'.repeat(28),
    'jwt.txt': ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'sig'].join('.'),
    'private.pem': ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
    'mac.md': ['', 'Users', 'someone', 'Library', ''].join('/'),
    'linux.md': ['', 'home', 'someone', '.jam', ''].join('/'),
    'cites.ts': `// see ${['claude', 'md'].join('.')} and ${['docs', 'decisions'].join('\\')}`,
    'numbered.md': `the same call ${['00', '12'].join('')} made`,
    'cited.md': `fixed as said (${['00', '21'].join('')}), and see ${['00', '22'].join('')}`,
    'cited-see.ts': `// per ${['00', '18'].join('')}`,
    'ids.json': `{"room": "room-${['00', '21'].join('')}", "port": "${['01', '01'].join('')}"}`,
    // The recorded id above, cut into pieces the way a test once hid a real one, and wrapped across lines: no piece is
    // 12 hex characters long, so only reading them together finds it.
    'split-id.ts': "const id = ['art-', '5f0c2d7e', '9a1b3c4d', '6e8f0a21'].join('')",
    'wrapped-id.md': 'id art-5f0c2d7e\n9a1b3c4d\n6e8f0a21',
    'variables.ts': "const a = '5f0c2d7e'\nconst b = '9a1b3c4d'\nconst c = '6e8f0a21'",
    // The room id above by the first eight characters a screen names a room by.
    'head.md': 'the room 0c9d8e7f was open',
    // A long hex value that is no needle stays clean.
    'hash.json': '{"sha256": "4e07a1d9c3b85f26e1a7d04c9b3f58e2a6d1c7b04f9e3a58d2c6b1e7f40a9d35"}',
    // The builder's own setup words live in .local/setup-words.json; the self-test plants words of its own (SELF_SETUP).
    'setup.md': 'measured during the glimmerfest',
    'room.ts': "const room = 'zephyr-room'",
    'Plantedperson-notes.txt': 'nothing personal inside',
    'shot.png': 'not really an image',
    'data.db': 'SQLite format 3' + String.fromCharCode(0, 0) + ' Plantedperson',
    'utf16.txt': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('written by Plantedperson', 'utf16le')]),
    // Past the first 8 KB, where the check once stopped looking.
    'late-nul.ts': 'export const a = 1\n'.repeat(500) + `const s = '${String.fromCharCode(0)}'\n`,
    'huge.txt': 'x'.repeat(30_000),
    'clean.ts': 'export const fixture = { email: "sam.rivera@example.com", path: "%LOCALAPPDATA%\\\\jam" }',
    'allowed.png': 'an image that was looked at',
    'model.json': '{"model": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5"}',
    'agents.md': 'docs/jam/agents.md lists the agents screen',
    // The copyright holder, named where a name belongs (holder.mjs), passes; the same line in another file does not.
    LICENSE: 'MIT License\n\nCopyright (c) 2026 Plantedperson Example\n',
    'package.json': '{\n  "name": "planted",\n  "author": "Plantedperson Example",\n  "license": "MIT"\n}\n',
    'electron-builder.yml': 'appId: com.example.planted\ncopyright: Copyright © 2026 Plantedperson Example\n',
    NOTICE: 'Planted\n\nCopyright (c) 2026 Plantedperson Example\n',
  }
  const clean = [
    'clean.ts',
    'allowed.png',
    'model.json',
    'agents.md',
    'ids.json',
    'hash.json',
    'LICENSE',
    'package.json',
    'electron-builder.yml',
  ]
  for (const [name, text] of Object.entries(cases)) writeFileSync(join(planted, name), text)
  const findings = scanFiles(planted, Object.keys(cases), needles, {
    maxBytes: 20_000,
    allowedBinaries: ['allowed.png'],
    rules: [...PATTERNS, ...PROCESS_REFERENCES, SELF_SETUP],
  })
  rmSync(planted, { recursive: true, force: true })
  // A key shape as the holder reads as a name to holder.mjs (letters and hyphens), so the line is still checked for keys.
  const keyed = mkdtempSync(join(tmpdir(), 'jamr-identity-'))
  writeFileSync(join(keyed, 'LICENSE'), `Copyright (c) 2026 ${['sk', 'ant'].join('-')}-${'a'.repeat(30)}\n`)
  const keyCaught = scanFiles(keyed, ['LICENSE'], needles).length > 0
  rmSync(keyed, { recursive: true, force: true })
  const caught = new Set(findings.map((finding) => finding.file))
  const missed = Object.keys(cases).filter((name) => !clean.includes(name) && !caught.has(name))
  if (!keyCaught) missed.push('a key named as the holder')
  const falseAlarms = clean.filter((name) => caught.has(name))
  if (missed.length || falseAlarms.length) {
    console.error(
      `check-identity self-test FAILED: missed ${missed.join(', ') || 'nothing'}; clean files flagged: ${falseAlarms.join(', ') || 'none'}`,
    )
    process.exit(1)
  }
  console.log(
    `check-identity self-test ok: ${caught.size} known-bad files caught, ${clean.length} clean ones passed (${RULES.length} rules)`,
  )
  process.exit(0)
}

const cacheArg = process.argv.indexOf('--cache')
const cacheFile = cacheArg === -1 ? needleCacheFile(root) : resolve(process.argv[cacheArg + 1] ?? '')
const { needles, cache } = gatherNeedles({ root, cacheFile })
if (!cache) {
  // Only a copy handed over can conclude that nothing was ever recorded in it: it has no .local folder, and none of the
  // process notes a checkout of this repository always holds (so a fresh clone, or a checkout whose .local folder went
  // missing, still fails). Only the default lookup counts: a --cache that names a missing file fails.
  const handedOver = cacheArg === -1 && !hasLocalFolder(root) && !holdsProcessNotes(root)
  if (handedOver) {
    console.warn(
      'check-identity: no Jam account was recorded in this copy (it has no .local folder, and none of the notes a ' +
        'working checkout keeps): running without the Jam account needles',
    )
  } else if (process.argv.includes('--no-account')) {
    console.warn('check-identity: running without the Jam account needles (--no-account)')
  } else {
    console.error(
      'check-identity FAILED: the Jam account needles are missing (.local/identity-needles.json), so this check cannot see ' +
        "the account's name, email or user id. Run `pnpm fixtures:record` once in the main checkout (it reads the live " +
        'daemon), or pass --no-account where no Jam account applies.',
    )
    process.exit(1)
  }
}
const files = exportSet(root)
// Nothing to look at passes nothing: an empty listing (a folder whose ignore rules cover everything) is a failure.
if (files.length === 0) {
  console.error(`check-identity FAILED: nothing to check in ${root}: git lists no file that would go out`)
  process.exit(1)
}
const findings = scanFiles(root, files, needles)
if (findings.length) {
  for (const finding of findings) console.error(`${finding.file}:${finding.line}  ${finding.kind}`)
  console.error(`check-identity FAILED: ${findings.length} finding(s) in what goes out`)
  process.exit(1)
}
console.log(`check-identity ok: ${files.length} files that go out, ${needles.length} needles, ${RULES.length} rules`)
