import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isProcessNote, PROCESS_REFERENCES, setupReferences } from './lib/export-set.mjs'
import { holderLines } from './lib/holder.mjs'
import { gatherNeedles, GENERIC_USERS, PATTERNS, scanText } from './lib/identity.mjs'

// Needles, process-note names and setup words are built here from parts: this file goes out too, so it never holds a real
// identity, a whole key, or a word the check refuses in what goes out.
const needles = [
  { value: ['Plan', 'ted', 'person'].join(''), kind: 'the user name on this machine' },
  { value: ['planted', '.person', '@example', '.org'].join(''), kind: 'the git email' },
  { value: ['C:', 'Users', 'Plantedperson'].join('\\'), kind: 'the home folder on this machine' },
]
const note = (...parts) => parts.join('.')

describe('scanText', () => {
  it.each([
    ['a user name, in any case', 'author: PLANTEDPERSON'],
    ['an email', '{"email":"planted.person@example.org"}'],
    ['a home folder written with forward slashes', ['C:', 'Users', 'Plantedperson', 'Dev'].join('/')],
    ['a home folder written with doubled backslashes', ['C:', 'Users', 'Plantedperson', 'Dev'].join('\\\\')],
    ['anyone else’s Windows user folder', ['D:', 'Users', 'someone', 'AppData'].join('\\')],
    ['a macOS user folder', ['', 'Users', 'someone', 'Library', ''].join('/')],
    ['a Linux home folder', ['', 'home', 'someone', '.jam', ''].join('/')],
    ['a Jam pipe name', `\\\\.\\pipe\\jam-${'ab'.repeat(16)}`],
    ['an Anthropic-shaped key', 'sk-ant-' + 'x'.repeat(24)],
    ['a GitHub token', 'ghp_' + 'A'.repeat(36)],
    ['a Slack token', ['xo', 'xp-'].join('') + '1234567890-abcdef'],
    ['an AWS key id', ['AK', 'IA'].join('') + 'Q'.repeat(16)],
    ['a Band key', ['ba', 'nd-'].join('') + 'k'.repeat(30)],
    ['a Tavily key', ['tv', 'ly-'].join('') + 'k'.repeat(30)],
    ['a private key', ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' ')],
  ])('finds %s', (_label, text) => {
    expect(scanText(text, needles).length).toBeGreaterThan(0)
  })

  it.each([
    ['an invented fixture account', '{"email":"sam.rivera@example.com","handle":"sam-rivera"}'],
    ['a path written with a variable', '%LOCALAPPDATA%\\jam\\user-guide.md'],
    ['a placeholder user folder', 'C:\\Users\\<you>\\AppData'],
    ['the public Windows folder', 'C:\\Users\\Public\\Documents'],
    ['a UUID', '3f6c2a1e-8b7d-4c5e-9a10-2b3c4d5e6f70'],
    ['an ordinary word containing no needle', 'the planted seeds grew'],
  ])('passes %s', (_label, text) => {
    expect(scanText(text, needles)).toEqual([])
  })

  it('finds a name only as a whole word', () => {
    const surname = [{ value: 'Kress', kind: 'the Jam name' }]
    expect(scanText('by Kress, 2026', surname)).toHaveLength(1)
    expect(scanText("Kress's notes", surname)).toHaveLength(1)
    expect(scanText('Kressbronn and unKress', surname)).toEqual([])
  })

  it('reports the line and the kind, never the value', () => {
    const findings = scanText('ok\nby Plantedperson', needles)
    expect(findings).toEqual([{ line: 2, kind: 'the user name on this machine' }])
  })
})

describe('a needle in parts', () => {
  // Invented ids. The artifact id's hex is cut into pieces of eight, so only reading the pieces together finds it.
  const artifact = ['art-', '5f0c2d7e', '9a1b3c4d', '6e8f0a21']
  const hex = artifact.slice(1).join('')
  const uuid = ['9f2b7c41', '5d3e', '4a68', 'b0c9', '1e7f3a5d8b24'].join('-')
  const ids = [
    { value: artifact.join(''), kind: 'a recorded artifact id' },
    { value: uuid, kind: 'a recorded room id' },
  ]
  const kinds = (text, list = ids) => scanText(text, list).map((finding) => finding.kind)

  it.each([
    ['built from pieces', `const id = ['${artifact.join("', '")}'].join('')`],
    ['built from pieces in capitals', `const id = ['${artifact.join("', '").toUpperCase()}'].join('')`],
    ['held in three variables', `const a = '${artifact[1]}'\nconst b = '${artifact[2]}'\nconst c = '${artifact[3]}'`],
    [
      'cut into pieces of two',
      `[${hex
        .match(/../g)
        .map((piece) => `'${piece}'`)
        .join(', ')}]`,
    ],
    ['wrapped across lines', `id ${artifact.join('\n')}`],
    ['a UUID written without its dashes', `"${uuid.replaceAll('-', '')}"`],
    ['the head of a UUID, its dashes kept', `room ${uuid.slice(0, 23)}…`],
    ['twelve of its characters in a row, then others', `"${hex.slice(0, 12)}000000000000"`],
  ])('finds an id %s', (_label, text) => {
    expect(kinds(text)).toContainEqual(expect.stringMatching(/, in parts$/))
  })

  it('says which line a wrapped id starts on, even when its hex opens that line', () => {
    expect(scanText(`id ${artifact.join('\n')}`, ids)).toEqual([{ line: 2, kind: 'a recorded artifact id, in parts' }])
  })

  it('reports a wrapped id once, on the line it starts on', () => {
    const text = `ok\nid ${artifact[0]}${artifact[1]}\n${artifact[2]}\n${artifact[3]}`
    expect(scanText(text, ids)).toEqual([{ line: 2, kind: 'a recorded artifact id, in parts' }])
  })

  it('reports two copies on one line once', () => {
    const copy = `['${artifact.join("', '")}'].join('')`
    expect(scanText(`${copy} + ${copy}`, ids)).toEqual([{ line: 1, kind: 'a recorded artifact id, in parts' }])
  })

  it('reports an id found whole once, not a second time in parts or by its head', () => {
    expect(scanText(`room ${uuid}`, ids)).toEqual([{ line: 1, kind: 'a recorded room id' }])
  })

  it('reports an id inside a longer needle once, as the id', () => {
    const nested = [
      { value: uuid, kind: 'a user id' },
      { value: `inst-${uuid}-02`, kind: 'an account instance' },
    ]
    expect(scanText(`user ${uuid}`, nested)).toEqual([{ line: 1, kind: 'a user id' }])
    expect(scanText(`user ${uuid.split('-').join("' + '")}`, nested)).toEqual([
      { line: 1, kind: 'a user id, in parts' },
    ])
    expect(scanText(`room ${uuid.slice(0, 8)}`, nested)).toEqual([
      { line: 1, kind: 'a user id, its first eight characters' },
    ])
  })

  it('finds the first eight characters of a UUID needle standing alone, as a screen names a room', () => {
    expect(kinds(`room ${uuid.slice(0, 8)}…`)).toEqual(['a recorded room id, its first eight characters'])
    expect(kinds(`room ${uuid.slice(0, 7)}`)).toEqual([])
    expect(kinds(`build ${uuid.slice(0, 8)}ab`)).toEqual([])
  })

  it('finds a needle added to the same list after an earlier scan', () => {
    const list = [...ids]
    expect(scanText('nothing here', list)).toEqual([])
    list.push({ value: 'hash-0c1d2e3f4a5b6c7d8e9f0a1b', kind: 'a later needle' })
    expect(kinds("['0c1d2e3f', '4a5b6c7d', '8e9f0a1b']", list)).toEqual(['a later needle, in parts'])
  })

  it.each([
    ['another hash', '{"sha256": "4e07a1d9c3b85f26e1a7d04c9b3f58e2a6d1c7b04f9e3a58d2c6b1e7f40a9d35"}'],
    ['eleven of its characters in a row, then others', `"${hex.slice(0, 11)}000000000000"`],
  ])('passes %s', (_label, text) => {
    expect(scanText(text, ids)).toEqual([])
  })

  it('leaves a needle whose hex runs are shorter than 16 to the whole-word search', () => {
    const short = [{ value: 'tok-5f0c2d7e9a1b3', kind: 'a short id' }]
    expect(scanText("['tok-', '5f0c2d7e9a', '1b3'].join('')", short)).toEqual([])
  })
})

describe('references to the process notes and the setup', () => {
  const rules = { patterns: [...PATTERNS, ...PROCESS_REFERENCES] }

  it.each([
    ['a process note', `see ${note('CLAUDE', 'md')}, "Talking to Jam"`],
    ['a process note in lower case', `see ${note('claude', 'md')}`],
    ['another process note', `recorded in ${note('RESUME', 'md')}`],
    ['an agents note', `as ${note('AGENTS', 'md')} says`],
    ['a decision record', `(${['docs', 'decisions', '0001-foundation.md'].join('/')})`],
    ['a decision record with backslashes', ['docs', 'decisions', '0001-foundation.md'].join('\\')],
    ['an evaluation', `run-ons (${note('EVALUATION', 'md')})`],
    ['a decision record named by its number alone', `the same call ${['00', '12'].join('')} made`],
    ['the same in another tense', `as ${['00', '18'].join('')} says`],
  ])('finds %s', (_label, text) => {
    expect(scanText(text, [], rules).length).toBeGreaterThan(0)
  })

  it.each([
    ['a model id in a fixture', '{"model": "claude-sonnet-5-5"}'],
    ['a model name in a fixture', '{"name": "Claude Sonnet 5.5"}'],
    ['a document about the Agents screen', 'docs/jam/agents.md'],
    ['an ordinary sentence', 'The claude.ai app and a README.md stay as they are.'],
    ['the documents that go out', 'README, NOTICE, docs/DESIGN.md and docs/jam/routes.md'],
    ['a four-digit number that names nothing', 'page 0100 of 0200, id 0012'],
    ['an ordinary sentence about tests and agents', 'the latest agent, and testing a room with unit tests'],
    ['a version or a date beside a verb', '0.4.10 records the wire version, and 2026-09-21 recorded the rest'],
  ])('passes %s', (_label, text) => {
    expect(scanText(text, [], rules)).toEqual([])
  })

  it('does not flag its own rule list, so the file that defines it can go out', () => {
    expect(scanText(PROCESS_REFERENCES.map((rule) => rule.pattern.source).join('\n'), [], rules)).toEqual([])
  })
})

describe('the user name on this machine', () => {
  it('is never a needle on a CI or container account, whose name is an ordinary word here', () => {
    for (const name of ['root', 'node', 'runner']) expect(GENERIC_USERS.has(name)).toBe(true)
    expect(GENERIC_USERS.has('alex')).toBe(false)
  })
})

describe("the builder's own setup words", () => {
  const dir = mkdtempSync(join(tmpdir(), 'jamr-setup-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('come from .local/setup-words.json, and are found like any other rule', () => {
    const root = join(dir, 'with')
    mkdirSync(join(root, '.local'), { recursive: true })
    writeFileSync(join(root, '.local', 'setup-words.json'), JSON.stringify([{ pattern: '\\bglimmerfest\\b' }]))
    const rules = setupReferences(root)
    expect(rules).toHaveLength(1)
    expect(scanText('measured during the Glimmerfest', [], { patterns: rules }).length).toBeGreaterThan(0)
    expect(scanText('an ordinary festival', [], { patterns: rules })).toEqual([])
  })

  it('are none without that file, as in a copy handed over', () => {
    const root = join(dir, 'without')
    mkdirSync(root, { recursive: true })
    expect(setupReferences(root)).toEqual([])
  })
})

describe('the export set', () => {
  it.each([
    note('CLAUDE', 'md'),
    note('RESUME', 'md'),
    ['docs', 'decisions', '0001-foundation.md'].join('/'),
    'design/reference/README.md',
    '.claude/settings.json',
  ])('keeps the process note %s at home', (path) => {
    expect(isProcessNote(path)).toBe(true)
  })

  it.each([
    'src/main/index.ts',
    'tests/fake-daemon/fixtures/accounts.json',
    'docs/DESIGN.md',
    'README.md',
    'package.json',
  ])('sends %s out', (path) => {
    expect(isProcessNote(path)).toBe(false)
  })
})

/**
 * The account's own needles - its name, email, ids and a recorded room's item ids - reach the check through a recorded
 * cache file and through nothing else, so a cache branch that quietly stopped reading would leave every gate green
 * while the check went blind to the one thing only that file knows.
 */
describe('the account needles', () => {
  const root = resolve(import.meta.dirname, '..')
  const dir = mkdtempSync(join(tmpdir(), 'jamr-needles-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('takes each one from the cache, with its kind, and then finds it', () => {
    const planted = ['planted', '.account', '@example', '.org'].join('')
    const id = '9f2b7c41-5d3e-4a68-b0c9-1e7f3a5d8b24'
    const file = join(dir, 'identity-needles.json')
    writeFileSync(file, JSON.stringify({ "the account's email": [planted], "the account's user id": id }))

    const gathered = gatherNeedles({ root, cacheFile: file })
    expect(gathered.cache).toBe(file)
    expect(gathered.needles).toEqual(
      expect.arrayContaining([
        { value: planted, kind: "the account's email" },
        { value: id, kind: "the account's user id" },
      ]),
    )
    expect(scanText(`contact ${planted}`, gathered.needles)).toEqual([{ line: 1, kind: "the account's email" }])
    expect(scanText(`room ${id}`, gathered.needles)).toEqual([{ line: 1, kind: "the account's user id" }])
  })

  it('says it has no cache when the file is not there, rather than carrying on quietly', () => {
    expect(gatherNeedles({ root, cacheFile: join(dir, 'not-written.json') }).cache).toBeNull()
  })
})

/**
 * The copyright holder's name is the one name allowed in what goes out, and only on the lines that name the holder: a
 * rule that let it through on any other line, or let any holder through, would leave every gate green.
 */
describe('the copyright holder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jamr-holder-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const plant = (name, files) => {
    const folder = join(dir, name)
    mkdirSync(folder)
    for (const [file, text] of Object.entries(files)) writeFileSync(join(folder, file), text)
    return folder
  }
  const license = (holder) => `MIT License\n\nCopyright (c) 2026 ${holder}\n\nPermission is hereby granted\n`

  it('names the three lines that name the same holder', () => {
    const folder = plant('agree', {
      LICENSE: license('Planted Person'),
      'package.json': '{\n  "name": "x",\n  "author": "Planted Person",\n  "license": "MIT"\n}\n',
      'electron-builder.yml': 'appId: x\ncopyright: Copyright © 2026 Planted Person\n',
    })
    expect([...holderLines(folder)].toSorted()).toEqual(['LICENSE:3', 'electron-builder.yml:2', 'package.json:3'])
  })

  it('takes a company name with letters beyond ASCII', () => {
    expect([...holderLines(plant('company', { LICENSE: license('Plantedfirma OÜ') }))]).toEqual(['LICENSE:3'])
  })

  it.each([
    ['an email', 'email', ['planted.person', 'example.org'].join('@')],
    ['a path', 'path', ['C:', 'Users', 'someone'].join('\\')],
    ['an id', 'id', '0c9d8e7f-6a5b-4c3d-9e2f-1a0b9c8d7e6f'],
  ])('names no line when the holder is %s', (_label, slug, holder) => {
    expect([...holderLines(plant(`not-a-name-${slug}`, { LICENSE: license(holder) }))]).toEqual([])
  })

  it('leaves out a file that names someone else, and every other line', () => {
    const folder = plant('disagree', {
      LICENSE: `${license('Planted Person')}Planted Person\n`,
      'package.json': '{\n  "author": "Someone Else"\n}\n',
      'electron-builder.yml': 'copyright: Copyright © 2025 Planted Person\n',
    })
    expect([...holderLines(folder)]).toEqual(['LICENSE:3'])
  })

  it('names nothing without a LICENSE', () => {
    expect([...holderLines(plant('none', { 'package.json': '{ "author": "Planted Person" }' }))]).toEqual([])
  })
})

describe('check-identity.mjs', () => {
  const root = resolve(import.meta.dirname, '..')
  const run = (...args) =>
    spawnSync(process.execPath, [join(root, 'scripts', 'check-identity.mjs'), ...args], { cwd: root, encoding: 'utf8' })
  const missing = join(root, 'no-such-folder', 'identity-needles.json')

  it('passes its self-test: every planted known-bad caught, the clean files passed', () => {
    const result = run('--self-test')
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('fails when the Jam account needles are missing, instead of passing a weaker check', () => {
    const result = run('--cache', missing)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/needles are missing/)
  })

  it('runs without them only when told to', () => {
    const result = run('--cache', missing, '--no-account')
    expect(result.stderr).toMatch(/without the Jam account needles/)
    expect(result.status).toBe(0)
  })
})
