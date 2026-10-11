import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const shell = { showItemInFolder: vi.fn(), openPath: vi.fn(async () => '') }
vi.mock('electron', () => ({ shell }))

const { actOnFile, isLocalPath, isRunnable, verifyFile, VERIFY_MAX_BYTES } = await import('./files')
type Found = Awaited<ReturnType<import('./daemon/client').DaemonClient['artifactFile']>>

/** A daemon that answers only artifactFile, which is all these two use it for. */
const daemonThat = (found: Found) =>
  ({ artifactFile: async () => found }) as unknown as import('./daemon/client').DaemonClient

const dir = mkdtempSync(join(tmpdir(), 'jamr-files-'))
const file = (name: string, text: string) => {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}
// "hello" hashed with SHA-256, so Verify is checked against a real digest rather than one this test made up.
const HELLO = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => {
  shell.showItemInFolder.mockClear()
  shell.openPath.mockClear()
})

/**
 * The one rule this app adds to Jam's Open: a file the system would run is never handed to the system's default
 * handler. A room's files come from its participants, so one click in a file list must not start a program.
 */
describe('a file this app will not open', () => {
  it('refuses the things Windows runs', () => {
    for (const name of ['setup.exe', 'run.bat', 'go.cmd', 'task.ps1', 'thing.vbs', 'install.msi', 'link.lnk']) {
      expect(isRunnable(name)).toBe(true)
    }
  })

  it('refuses the things a shell, a browser or an interpreter runs', () => {
    for (const name of ['start.sh', 'bundle.js', 'page.hta', 'app.jar', 'Thing.app', 'keys.reg', 'go.py', 'x.rb']) {
      expect(isRunnable(name)).toBe(true)
    }
  })

  it('refuses what the other two platforms run, not only Windows', () => {
    for (const name of ['launcher.desktop', 'install.pkg', 'thing.scpt', 'a.AppImage', 'open.terminal']) {
      expect(isRunnable(name)).toBe(true)
    }
  })

  /** path.extname answers an empty string for a dotfile, while Windows takes everything after the last dot. */
  it('refuses a name that is nothing but a runnable extension', () => {
    for (const name of ['.exe', '.bat', '.cmd', '.ps1', '.desktop', '.hta', '.lnk', '.settingcontent-ms']) {
      expect(isRunnable(name), name).toBe(true)
    }
    expect(isRunnable(join('C:', 'docs', '.exe'))).toBe(true)
  })

  it('still opens an ordinary dotfile', () => {
    for (const name of ['.gitignore', '.env.example', '.prettierrc']) expect(isRunnable(name), name).toBe(false)
  })

  it('refuses the Windows file types that carry a command line', () => {
    for (const name of ['invoice.settingcontent-ms', 'fix.diagcab', 'box.wsb', 'app.msix', 'u.msu', 'p.website']) {
      expect(isRunnable(name), name).toBe(true)
    }
  })

  /**
   * Windows strips a trailing dot or space before it resolves a name, so `payload.exe.` runs `payload.exe`. A check
   * that asked Node for the extension would see `.` and `.exe ` and let both through.
   */
  it('refuses a name that the system would strip back to a runnable one', () => {
    for (const name of ['payload.exe.', 'payload.exe ', 'payload.exe..', 'payload.exe. ', 'notes.txt.', 'notes.txt ']) {
      expect(isRunnable(name), name).toBe(true)
    }
  })

  it('does not care about the case of the extension', () => {
    expect(isRunnable('SETUP.EXE')).toBe(true)
    expect(isRunnable('Run.Bat')).toBe(true)
  })

  it('opens an ordinary file, which is the whole point', () => {
    for (const name of ['plan.md', 'notes.txt', 'shot.png', 'report.pdf', 'sheet.csv', 'data.json', 'code.ts']) {
      expect(isRunnable(name)).toBe(false)
    }
  })

  it('does not mistake a name that merely contains an extension for one that ends in it', () => {
    expect(isRunnable('exe')).toBe(false)
    expect(isRunnable('notes.exe.txt')).toBe(false)
    expect(isRunnable('my.bat.notes')).toBe(false)
  })

  it('looks at the name, not the folders above it', () => {
    expect(isRunnable(join('C:', 'bin.exe', 'notes.txt'))).toBe(false)
    expect(isRunnable(join('C:', 'docs', 'setup.exe'))).toBe(true)
  })

  it('opens a file with no extension at all', () => {
    expect(isRunnable('LICENSE')).toBe(false)
    expect(isRunnable('Makefile')).toBe(false)
  })
})

describe('a path this app will hand to the system', () => {
  it('takes an absolute path on this computer', () => {
    expect(isLocalPath(join(dir, 'plan.md'))).toBe(true)
  })

  it('refuses a path that reaches another machine, and a relative one', () => {
    expect(isLocalPath('\\\\host\\share\\doc.txt')).toBe(false)
    expect(isLocalPath('//host/share/doc.txt')).toBe(false)
    expect(isLocalPath('notes.txt')).toBe(false)
    expect(isLocalPath('')).toBe(false)
  })
})

describe('opening and revealing a room’s file', () => {
  it('opens an ordinary file', async () => {
    const path = file('plan.md', 'hello')
    expect(await actOnFile(daemonThat({ path, sha256: HELLO }), 'open', 'default', 'a')).toEqual({ done: true })
    expect(shell.openPath).toHaveBeenCalledWith(path)
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('shows a runnable file in its folder and never opens it', async () => {
    const path = file('payload.exe', 'MZ')
    expect(await actOnFile(daemonThat({ path, sha256: null }), 'open', 'default', 'a')).toEqual({
      done: false,
      reason: 'runnable',
    })
    expect(shell.openPath).not.toHaveBeenCalled()
    expect(shell.showItemInFolder).toHaveBeenCalledWith(path)
  })

  it('shows a runnable file in its folder even when the system would strip its name back', async () => {
    const path = file('sneaky.exe. ', 'MZ')
    expect((await actOnFile(daemonThat({ path, sha256: null }), 'open', 'default', 'a')).reason).toBe('runnable')
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('reveals whatever it is asked to reveal, runnable or not', async () => {
    const path = file('payload2.exe', 'MZ')
    expect(await actOnFile(daemonThat({ path, sha256: null }), 'reveal', 'default', 'a')).toEqual({ done: true })
    expect(shell.showItemInFolder).toHaveBeenCalledWith(path)
  })

  it('says the daemon did not answer rather than claiming the file is not here', async () => {
    expect(await actOnFile(daemonThat('unavailable'), 'open', 'default', 'a')).toEqual({
      done: false,
      reason: 'unavailable',
    })
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('says a file is missing only when the daemon said there is no such file, or it is gone', async () => {
    expect(await actOnFile(daemonThat(null), 'open', 'default', 'a')).toEqual({ done: false, reason: 'missing' })
    const gone = join(dir, 'never-written.md')
    expect(await actOnFile(daemonThat({ path: gone, sha256: null }), 'open', 'default', 'a')).toEqual({
      done: false,
      reason: 'missing',
    })
  })

  /**
   * The system refuses to open a file for its own reasons - no program for that kind of file, no permission - and
   * says so in a sentence that can name the path. A present copy that would not open is never called a missing one.
   */
  it('says a file that is here would not open, rather than calling it missing', async () => {
    const path = file('unknown-kind.qqq', 'hello')
    shell.openPath.mockResolvedValueOnce('no application is associated with this file')
    expect(await actOnFile(daemonThat({ path, sha256: null }), 'open', 'default', 'a')).toEqual({
      done: false,
      reason: 'unopenable',
    })
    expect(shell.openPath).toHaveBeenCalledWith(path)
  })

  it('refuses a path that reaches another machine', async () => {
    const unc = '\\\\host\\share\\doc.txt'
    expect(await actOnFile(daemonThat({ path: unc, sha256: null }), 'open', 'default', 'a')).toEqual({
      done: false,
      reason: 'elsewhere',
    })
    expect(shell.openPath).not.toHaveBeenCalled()
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })
})

describe('checking a file against its checksum', () => {
  it('matches a file whose contents still hash to what the daemon recorded', async () => {
    const path = file('same.md', 'hello')
    expect(await verifyFile(daemonThat({ path, sha256: HELLO }), 'default', 'a')).toBe('matches')
  })

  it('takes the checksum in either case', async () => {
    const path = file('upper.md', 'hello')
    expect(await verifyFile(daemonThat({ path, sha256: HELLO.toUpperCase() }), 'default', 'a')).toBe('matches')
  })

  it('reports a file whose contents have changed', async () => {
    const path = file('changed.md', 'hello, and more')
    expect(await verifyFile(daemonThat({ path, sha256: HELLO }), 'default', 'a')).toBe('differs')
  })

  it('keeps apart no checksum, no copy, and no answer', async () => {
    const path = file('nohash.md', 'hello')
    expect(await verifyFile(daemonThat({ path, sha256: null }), 'default', 'a')).toBe('unknown')
    expect(await verifyFile(daemonThat(null), 'default', 'a')).toBe('missing')
    expect(await verifyFile(daemonThat('unavailable'), 'default', 'a')).toBe('unavailable')
    expect(await verifyFile(daemonThat({ path: join(dir, 'gone.md'), sha256: HELLO }), 'default', 'a')).toBe('missing')
  })

  it('refuses to read a file larger than it will hash, and says so rather than guessing', async () => {
    const path = file('huge.md', 'hello')
    // The real limit cannot be written in a test, so the limit itself is lowered: the branch is what is under test.
    expect(await verifyFile(daemonThat({ path, sha256: HELLO }), 'default', 'a', 1)).toBe('too-large')
    // And the same file under the limit still answers properly, so the check above is not passing for another reason.
    expect(await verifyFile(daemonThat({ path, sha256: HELLO }), 'default', 'a', 1024)).toBe('matches')
  })

  it('reads a file up to a size a person would wait for', () => {
    expect(VERIFY_MAX_BYTES).toBeGreaterThan(100 * 1024 * 1024)
  })
})
