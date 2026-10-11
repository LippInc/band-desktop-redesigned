import { describe, expect, it } from 'vitest'
import type { RuntimeDefaults } from '@shared/daemon'
import { runtimeRows } from '@/lib/runtime'

const defaults = (over: Partial<RuntimeDefaults> = {}) =>
  ({
    compact_at_tokens: null,
    permission_timeout_secs: null,
    resume: null,
    idle_secs: null,
    question_timeout_secs: null,
    room_activity: null,
    room_owner_approvals: null,
    ...over,
  }) as RuntimeDefaults

describe("what Settings' Runtime page shows", () => {
  it("lists Jam's agent defaults in its own order, with its own labels", () => {
    expect(runtimeRows(defaults()).map((row) => row.label)).toEqual([
      'Compaction budget (input tokens)',
      'Human approval wait',
      'Overall question timeout (seconds)',
      'Stop idle agents after (seconds)',
      'Room activity feed',
      'Room owners can approve permission asks',
      'Resume thread on wake',
    ])
  })

  // The daemon answers null for a field the account has not set. An unset field is not a field set to zero or to
  // off, so it reads as the built-in in Jam's own words and never as a value this app chose.
  it("reads an unset field as the built-in, in Jam's own words", () => {
    const rows = runtimeRows(defaults())
    expect(rows.every((row) => row.builtIn)).toBe(true)
    const value = (label: string) => rows.find((row) => row.label === label)?.value
    expect(value('Human approval wait')).toBe('Built-in — wait indefinitely')
    expect(value('Room owners can approve permission asks')).toBe('built-in default (on)')
    expect(value('Resume thread on wake')).toBe('built-in default (on)')
    expect(value('Compaction budget (input tokens)')).toBe('Built-in')
  })

  it('shows what the account has set, where it has set something', () => {
    const rows = runtimeRows(defaults({ compact_at_tokens: 120000, idle_secs: 900, resume: false }))
    const row = (label: string) => rows.find((one) => one.label === label)
    expect(row('Compaction budget (input tokens)')).toMatchObject({ value: '120000', builtIn: false })
    expect(row('Stop idle agents after (seconds)')).toMatchObject({ value: '900', builtIn: false })
    // False is a value the account chose, not an unset field: it must not read as the built-in "on".
    expect(row('Resume thread on wake')).toMatchObject({ value: 'false', builtIn: false })
  })

  // Zero is a value with a meaning of its own in two of these fields - it disables compaction, and it waits for an
  // answer forever - so it must never be read as "nothing set".
  it('treats a zero as a value the account chose, never as an unset field', () => {
    const rows = runtimeRows(defaults({ compact_at_tokens: 0, question_timeout_secs: 0 }))
    const row = (label: string) => rows.find((one) => one.label === label)
    expect(row('Compaction budget (input tokens)')).toMatchObject({ value: '0', builtIn: false })
    expect(row('Overall question timeout (seconds)')).toMatchObject({ value: '0', builtIn: false })
  })

  it('reads every row as the built-in when the daemon has not answered at all', () => {
    const rows = runtimeRows(null)
    expect(rows).toHaveLength(7)
    expect(rows.every((row) => row.builtIn)).toBe(true)
  })

  it("carries Jam's own line under each field, and none of its own", () => {
    const rows = runtimeRows(defaults())
    expect(rows.every((row) => row.help.length > 0)).toBe(true)
    expect(rows.find((row) => row.label === 'Resume thread on wake')?.help).toBe(
      'Keeps conversation context across idle/wake cycles.',
    )
  })
})
