// live-guard.mjs - the gate every script passes before it reads the Jam daemon on this computer (`pnpm dev:live`,
// `pnpm fixtures:record`, `pnpm smoke:packaged`). The account's owner can name days when nothing may touch the live
// daemon, in a gitignored `.local/live-blackout.json`:
//   [{ "from": "2026-01-01", "to": "2026-01-10", "why": "the account is busy elsewhere" }]
// Both days are included, in this computer's local time. `--live-ok` overrides a blackout, on the owner's word only.
// Without the file there is no blackout; a file that cannot be read as such periods counts as one. A refusal exits with
// its own code, REFUSED_EXIT, so it is never mistaken for the failure a script's own known-bad expects.
import { readFileSync } from 'node:fs'
import { localFile } from './local-file.mjs'

const DAY = /^\d{4}-\d{2}-\d{2}$/
export const REFUSED_EXIT = 3

/** The blackout period `today` falls in, or null. A file that cannot be read as periods counts as a blackout. */
export function liveBlackout({ file, today = new Date() }) {
  if (!file) return null
  const day = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')
  let periods
  try {
    periods = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { from: '?', to: '?', why: `${file} could not be read` }
  }
  if (!Array.isArray(periods)) return { from: '?', to: '?', why: `${file} is not a list of periods` }
  for (const period of periods) {
    if (!DAY.test(period?.from ?? '') || !DAY.test(period?.to ?? '') || period.from > period.to) {
      return { from: '?', to: '?', why: `${file} has a period without from and to days in order` }
    }
    if (period.from <= day && day <= period.to) return period
  }
  return null
}

/**
 * Returns when a live read is allowed today (no blackout, or `--live-ok`); otherwise says why and exits with
 * REFUSED_EXIT. `file`, `today` and `exit` are there for the tests.
 */
export function assertLiveAllowed(
  root,
  what,
  { argv = process.argv, file = localFile(root, 'live-blackout.json'), today, exit = process.exit } = {},
) {
  const period = liveBlackout({ file, today })
  if (!period) return 'allowed'
  const when = `${period.from} to ${period.to}${period.why ? `: ${period.why}` : ''}`
  if (argv.includes('--live-ok')) {
    console.warn(`${what}: reading the live daemon during a blackout (${when}), allowed by --live-ok`)
    return 'overridden'
  }
  console.error(
    `${what} refused: no live daemon reads during this blackout (${when}). --live-ok overrides it, on the account owner's word only.`,
  )
  exit(REFUSED_EXIT)
  return 'refused'
}
