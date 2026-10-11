import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const dialog = { showOpenDialog: vi.fn() }
vi.mock('electron', () => ({ dialog }))

const { choosePlanSource } = await import('./plan')

/**
 * A daemon that answers only setPlan, which is all this uses it for. What it was asked is kept, so a test can prove
 * a refused file never reached it.
 */
const daemonThat = (answer: true | 'unavailable') => {
  const sent: unknown[] = []
  return {
    sent,
    daemon: {
      setPlan: async (profile: string, roomId: string, source: string) => {
        sent.push({ profile, roomId, source })
        return answer
      },
    } as unknown as import('./daemon/client').DaemonClient,
  }
}

/** A picker that answers one path, as the dialog would; null is the dialog cancelled. */
const picked = (path: string | null) => async () => path

const ROOM = '5b0f6c2e-8d1a-4c3b-9e7f-2a4d6b8c0e11'
// Real files in a throwaway folder: the chooser checks the file is still there before it is sent.
const dir = mkdtempSync(join(tmpdir(), 'jamr-plan-'))
const LOCAL = (name: string) => join(dir, name)
const file = (name: string) => {
  const path = LOCAL(name)
  writeFileSync(path, '# A plan\n')
  return path
}

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('the file a room’s plan may be set from', () => {
  it('sends a chosen Markdown file to the daemon as the plan’s source', async () => {
    const { daemon, sent } = daemonThat(true)
    const path = file('chosen-plan.md')
    expect(await choosePlanSource(daemon, null, 'default', ROOM, picked(path))).toEqual({ done: true })
    expect(sent).toEqual([{ profile: 'default', roomId: ROOM, source: path }])
  })

  it('takes an uppercase .MD, because the system that picked it resolves case', async () => {
    const { daemon, sent } = daemonThat(true)
    const path = file('Plan.MD')
    expect(await choosePlanSource(daemon, null, 'default', ROOM, picked(path))).toEqual({ done: true })
    expect(sent).toHaveLength(1)
  })

  it('asks the system for one existing file, offering Markdown only', async () => {
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const { daemon, sent } = daemonThat(true)
    expect(await choosePlanSource(daemon, null, 'default', ROOM)).toEqual({ done: false, reason: 'canceled' })
    expect(dialog.showOpenDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] }),
    )
    expect(sent).toEqual([])
  })

  /**
   * The dialog offers Markdown, but a path can be typed into it; the daemon reads whatever it is sent. Each file here
   * exists, so it is the kind that refuses it and not its absence.
   */
  it('refuses a file of any other kind before anything is sent', async () => {
    for (const name of ['notes.txt', 'payload.exe', 'plan.md.txt', 'no-extension', 'archive.tar.gz']) {
      const { daemon, sent } = daemonThat(true)
      expect(await choosePlanSource(daemon, null, 'default', ROOM, picked(file(name)))).toEqual({
        done: false,
        reason: 'not-markdown',
      })
      expect(sent, name).toEqual([])
    }
  })

  it('refuses a file that is not on this computer, and a path that is not absolute', async () => {
    // The share's host cannot resolve, so a run with this guard broken fails fast instead of contacting a real host.
    for (const path of ['\\\\invalid.\\plans\\plan.md', 'chosen-plan.md', 'plans/plan.md']) {
      const { daemon, sent } = daemonThat(true)
      expect(await choosePlanSource(daemon, null, 'default', ROOM, picked(path))).toEqual({
        done: false,
        reason: 'elsewhere',
      })
      expect(sent, path).toEqual([])
    }
  })

  /** A typed path can name a file that is gone; that is this computer's fact, not Jam refusing. */
  it('refuses a path whose file is no longer there, without blaming Jam', async () => {
    const { daemon, sent } = daemonThat(true)
    expect(await choosePlanSource(daemon, null, 'default', ROOM, picked(LOCAL('deleted.md')))).toEqual({
      done: false,
      reason: 'missing',
    })
    expect(sent).toEqual([])
  })

  it('says nothing when the person closes the dialog, and sends nothing', async () => {
    const { daemon, sent } = daemonThat(true)
    expect(await choosePlanSource(daemon, null, 'default', ROOM, picked(null))).toEqual({
      done: false,
      reason: 'canceled',
    })
    expect(sent).toEqual([])
  })

  it('reports the daemon refusing, as Jam not taking the plan', async () => {
    const { daemon, sent } = daemonThat('unavailable')
    const path = file('p.md')
    expect(await choosePlanSource(daemon, null, 'default', ROOM, picked(path))).toEqual({
      done: false,
      reason: 'unavailable',
    })
    expect(sent).toEqual([{ profile: 'default', roomId: ROOM, source: path }])
  })
})
