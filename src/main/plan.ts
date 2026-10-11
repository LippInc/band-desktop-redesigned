import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import type { PlanChoiceResult } from '@shared/ipc-contract'
import type { DaemonClient } from './daemon/client'
import { isLocalPath } from './files'

/**
 * Setting a room's plan from a file on this computer (the CLI's own words: "Attach (or replace) the room's plan: a
 * local `.md` file, read now"). The file is chosen in a dialog this process opens and the path stays here: the page
 * asks by room and learns only what became of it, so no path from this machine can be named from the page.
 */

/** What the file dialog is asked for: one existing file, Markdown only. */
const PLAN_FILE_DIALOG: OpenDialogOptions = {
  title: 'Choose a plan file',
  properties: ['openFile'],
  filters: [{ name: 'Markdown', extensions: ['md'] }],
}

/** Asks for one file, Markdown only. What the dialog answers is this process's alone. */
const pickPlanFile = async (win: BrowserWindow | null): Promise<string | null> => {
  const chosen = win
    ? await dialog.showOpenDialog(win, PLAN_FILE_DIALOG)
    : await dialog.showOpenDialog(PLAN_FILE_DIALOG)
  return chosen.canceled ? null : (chosen.filePaths[0] ?? null)
}

/**
 * Makes one chosen Markdown file the room's plan source. The daemon derives the plan's label from the file's own
 * name (the CLI's default for `band plan set --label`), so nothing but the path is sent, and the daemon reads the
 * file itself.
 */
export async function choosePlanSource(
  daemon: DaemonClient,
  win: BrowserWindow | null,
  profile: string,
  roomId: string,
  /** The file to send, asked for here so a test can answer without opening a dialog. */
  pick: (win: BrowserWindow | null) => Promise<string | null> = pickPlanFile,
): Promise<PlanChoiceResult> {
  const source = await pick(win)
  if (source === null) return { done: false, reason: 'canceled' }
  if (!isLocalPath(source)) return { done: false, reason: 'elsewhere' }
  // The dialog offers Markdown, but a path can be typed into it; anything else is refused before it is sent.
  if (!basename(source).toLowerCase().endsWith('.md')) return { done: false, reason: 'not-markdown' }
  // A path can also be typed for a file that is gone, and that is not Jam refusing: this computer no longer has it.
  try {
    await stat(source)
  } catch {
    return { done: false, reason: 'missing' }
  }
  return (await daemon.setPlan(profile, roomId, source)) === true
    ? { done: true }
    : { done: false, reason: 'unavailable' }
}
