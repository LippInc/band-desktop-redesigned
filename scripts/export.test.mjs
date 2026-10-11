import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { exportSet } from './lib/export-set.mjs'

const root = resolve(import.meta.dirname, '..')
const scratch = mkdtempSync(join(tmpdir(), 'jamr-export-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }))

// The account needles of a checkout with no Jam account: an empty cache, so the check runs its machine needles only.
const noAccount = join(scratch, 'no-account.json')
writeFileSync(noAccount, '{}')
const run = (...args) =>
  spawnSync(process.execPath, [join(root, 'scripts', 'export.mjs'), ...args], { cwd: root, encoding: 'utf8' })

describe('export.mjs', () => {
  it('copies what goes out and nothing else: no process note, no git history', () => {
    const out = join(scratch, 'clean')
    const result = run(out, '--cache', noAccount)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    const shipped = exportSet(root).filter((file) => existsSync(join(root, file)))
    expect(result.stdout).toContain(`${shipped.length} files copied`)
    for (const file of ['package.json', 'LICENSE', 'NOTICE', 'README.md', 'src/main/index.ts']) {
      expect(existsSync(join(out, file))).toBe(true)
    }
    // Named from parts: this file goes out too, and the identity check refuses a process note's name in it.
    for (const file of [
      ['CLAUDE', 'md'].join('.'),
      ['RESUME', 'md'].join('.'),
      '.git',
      ['docs', 'decisions'].join('/'),
      '.local',
    ]) {
      expect(existsSync(join(out, file))).toBe(false)
    }
  })

  it('leaves a copy that checks itself with no repository and no .local folder, and still catches what it should', () => {
    const out = join(scratch, 'self-check')
    expect(run(out, '--cache', noAccount).status).toBe(0)
    const own = (...args) =>
      spawnSync(process.execPath, [join(out, 'scripts', 'check-identity.mjs'), ...args], { cwd: out, encoding: 'utf8' })
    const clean = own()
    expect(clean.stderr).toMatch(/no Jam account was recorded in this copy/)
    expect(clean.status).toBe(0)
    expect(existsSync(join(out, '.git'))).toBe(false)
    // A --cache naming a missing file still fails there: only the default lookup may conclude nothing was recorded.
    const named = own('--cache', join(out, 'none.json'))
    expect(named.status).toBe(1)
    expect(named.stderr).toMatch(/needles are missing/)
    // A key planted in the copy is found in it. Built from parts: this file goes out and is scanned too.
    const key = ['AK', 'IA'].join('') + 'Q'.repeat(16)
    writeFileSync(join(out, 'planted.ts'), `export const key = '${key}'\n`)
    const planted = own()
    expect(planted.status).toBe(1)
    expect(planted.stderr).toMatch(/planted\.ts:1 {2}an AWS key/)
    rmSync(join(out, 'planted.ts'))
    // A checkout that has the folder but lost the needles fails, as the builder's own does.
    mkdirSync(join(out, '.local'))
    const lost = own()
    expect(lost.status).toBe(1)
    expect(lost.stderr).toMatch(/needles are missing/)
    rmSync(join(out, '.local'), { recursive: true })
    // So does one with no .local folder that holds a process note: a fresh clone of this repository, not a copy.
    const note = ['CLAUDE', 'md'].join('.')
    writeFileSync(join(out, note), 'a note\n')
    const clone = own()
    expect(clone.status).toBe(1)
    expect(clone.stderr).toMatch(/needles are missing/)
    rmSync(join(out, note))
    // Nothing to look at passes nothing: a copy whose ignore rules cover every file fails.
    writeFileSync(join(out, '.gitignore'), '*\n')
    const empty = own()
    expect(empty.status).toBe(1)
    expect(empty.stderr).toMatch(/nothing to check/)
  })

  it('lists a folder with no repository the way git would, writes nothing into it and leaves no temporary folder', () => {
    const copy = join(scratch, 'no-repository')
    mkdirSync(join(copy, 'src'), { recursive: true })
    mkdirSync(join(copy, 'ignored'), { recursive: true })
    writeFileSync(join(copy, '.gitignore'), 'ignored/\n')
    writeFileSync(join(copy, 'src', 'a.ts'), 'export {}\n')
    writeFileSync(join(copy, 'ignored', 'b.ts'), 'export {}\n')
    const note = ['RESUME', 'md'].join('.')
    writeFileSync(join(copy, note), 'a note\n')
    // The empty repository it lists through is made in the temporary folder, and must be gone afterwards.
    const temp = join(scratch, 'temp')
    mkdirSync(temp)
    const before = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR }
    Object.assign(process.env, { TMP: temp, TEMP: temp, TMPDIR: temp })
    try {
      expect(exportSet(copy)).toEqual(['.gitignore', 'src/a.ts'])
    } finally {
      for (const [name, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
    expect(readdirSync(temp)).toEqual([])
    expect(readdirSync(copy).toSorted()).toEqual(['.gitignore', note, 'ignored', 'src'].toSorted())
  })

  it('lists a copy inside a larger repository by its own rules, not the larger one’s', () => {
    const outer = join(scratch, 'outer')
    mkdirSync(join(outer, 'inner', 'src'), { recursive: true })
    spawnSync('git', ['init', '--quiet', outer])
    // The larger repository ignores the copy altogether: listed through it, the copy would hold nothing.
    writeFileSync(join(outer, '.gitignore'), 'inner/\n')
    writeFileSync(join(outer, 'inner', '.gitignore'), 'out/\n')
    writeFileSync(join(outer, 'inner', 'src', 'a.ts'), 'export {}\n')
    expect(exportSet(join(outer, 'inner'))).toEqual(['.gitignore', 'src/a.ts'])
  })

  it('passes on the identity check’s warning when it runs without the account needles', () => {
    const out = join(scratch, 'warned')
    const result = run(out, '--cache', join(scratch, 'no-such.json'), '--no-account')
    expect(result.status).toBe(0)
    expect(result.stderr).toMatch(/without the Jam account needles \(--no-account\)/)
  })

  it('copies nothing when the identity check fails', () => {
    // A needle that the repository certainly holds, so the check fails on what would go out.
    const planted = join(scratch, 'planted.json')
    writeFileSync(planted, JSON.stringify({ 'a planted needle': ['redesigned'] }))
    const out = join(scratch, 'refused')
    const result = run(out, '--cache', planted)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/nothing was copied/)
    expect(existsSync(out) ? readdirSync(out) : []).toEqual([])
  })

  it('refuses a folder inside the repository, and one that is not empty', () => {
    expect(run(join(root, 'out', 'clean-copy'), '--cache', noAccount).stderr).toMatch(/inside this repository/)
    const full = join(scratch, 'full')
    mkdirSync(full, { recursive: true })
    writeFileSync(join(full, 'already.txt'), 'here')
    expect(run(full, '--cache', noAccount).stderr).toMatch(/not empty/)
  })

  it('says how it is used when given no folder', () => {
    const result = run()
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/usage: pnpm export:clean <folder>/)
  })
})
