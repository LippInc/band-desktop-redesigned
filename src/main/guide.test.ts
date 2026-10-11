import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readGuide, stateForError } from './guide'

const made: string[] = []

function install(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'jamr-guide-'))
  made.push(dir)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return join(dir, 'jamd.exe')
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("Jam's user guide, read from the install beside the daemon", () => {
  it('reads the guide that sits beside the daemon', async () => {
    const exe = install({ 'jamd.exe': '', 'user-guide.md': '# Jam user guide\n\nHello.\n' })
    await expect(readGuide(exe)).resolves.toEqual({ state: 'read', markdown: '# Jam user guide\n\nHello.\n' })
  })

  // Jam has not said where it is installed, which is a different thing from having no guide.
  it('says the daemon has not answered when there is no path', async () => {
    await expect(readGuide(null)).resolves.toEqual({ state: 'no-daemon' })
    await expect(readGuide('')).resolves.toEqual({ state: 'no-daemon' })
  })

  it('says there is none when no guide sits beside the daemon', async () => {
    const exe = install({ 'jamd.exe': '' })
    await expect(readGuide(exe)).resolves.toEqual({ state: 'not-found' })
  })

  // A file of nothing is not a guide: showing it would say Jam ships an empty one.
  it('refuses a guide of nothing at all', async () => {
    const exe = install({ 'jamd.exe': '', 'user-guide.md': '   \n\n' })
    await expect(readGuide(exe)).resolves.toEqual({ state: 'unreadable' })
  })

  it('reads no further than a guide could be', async () => {
    const exe = install({ 'jamd.exe': '', 'user-guide.md': 'x'.repeat(4_000_001) })
    await expect(readGuide(exe)).resolves.toEqual({ state: 'unreadable' })
  })

  it('looks only beside the daemon, and only for the file Jam ships', async () => {
    const exe = install({ 'jamd.exe': '', 'guide.md': '# Not the one\n', 'README.md': '# Nor this\n' })
    await expect(readGuide(exe)).resolves.toEqual({ state: 'not-found' })
  })

  it('never gives back where it read from', async () => {
    const exe = install({ 'jamd.exe': '', 'user-guide.md': '# Jam user guide\n' })
    const read = await readGuide(exe)
    expect(Object.keys(read).toSorted()).toEqual(['markdown', 'state'])
    expect(JSON.stringify(read)).not.toContain(exe.slice(0, 12))
  })
})

/**
 * The daemon's own answer is the one value that steers this read off the disk, and any local process answering the
 * pipe could have supplied it. These are the paths it must refuse.
 */
describe('where the guide is looked for', () => {
  it('refuses a path that names another computer', async () => {
    for (const named of ['\\\\host\\share\\jamd.exe', '//host/share/jamd', '\\\\?\\UNC\\host\\share\\jamd.exe']) {
      await expect(readGuide(named)).resolves.toEqual({ state: 'not-found' })
    }
  })

  it('refuses a relative path, which would be read from wherever the app happens to be running', async () => {
    // A guide of the right name really is in the folder the app is running in, so this fails if the check goes.
    const here = mkdtempSync(join(tmpdir(), 'jamr-cwd-'))
    made.push(here)
    writeFileSync(join(here, 'user-guide.md'), '# Not Jam\\u2019s guide\n')
    const was = process.cwd()
    process.chdir(here)
    try {
      for (const named of ['jamd', 'jamd.exe', './jamd.exe', '..\\jam\\jamd.exe', 'bin/jamd', '\\jam\\jamd.exe']) {
        await expect(readGuide(named)).resolves.toEqual({ state: 'not-found' })
      }
    } finally {
      process.chdir(was)
    }
  })

  // Nothing there is "no guide"; anything else is a guide that could not be read.
  it('tells nothing there from a guide it was not allowed to read', () => {
    expect(stateForError({ code: 'ENOENT' })).toEqual({ state: 'not-found' })
    for (const code of ['EACCES', 'EPERM', 'EISDIR', 'ELOOP', 'EINVAL', undefined]) {
      expect(stateForError({ code })).toEqual({ state: 'unreadable' })
    }
    expect(stateForError(null)).toEqual({ state: 'unreadable' })
  })

  it("takes Windows' long-path prefix off an absolute path rather than refusing it", async () => {
    const exe = install({ 'jamd.exe': '', 'user-guide.md': '# Jam user guide\n' })
    await expect(readGuide(`\\\\?\\${exe}`)).resolves.toEqual({
      state: 'read',
      markdown: '# Jam user guide\n',
    })
  })

  // Nothing there is "no guide". Anything else is a guide that could not be read, and saying "none" would state
  // something untrue about the Jam install.
  it('tells nothing there from something that is not a file', async () => {
    const exe = install({ 'jamd.exe': '' })
    await expect(readGuide(exe)).resolves.toEqual({ state: 'not-found' })
    const other = install({ 'jamd.exe': '' })
    mkdirSync(join(other, '..', 'user-guide.md'), { recursive: true })
    await expect(readGuide(other)).resolves.toEqual({ state: 'unreadable' })
  })
})
