import type { RuntimeDefaults } from '@shared/daemon'

/**
 * What Settings' Runtime page shows, in one place. Jam Desktop 0.4.10 was read on 2026-09-20 with nothing set on the
 * account, so every row was at its built-in value and Jam's own words for that state are known. Two of its help
 * lines and one of its values were cut off by the width of its own pane; only what was read whole is repeated here,
 * and `docs/jam/differences.md` says so.
 */

export interface RuntimeRow {
  key: keyof RuntimeDefaults & string
  /** Jam's own label for the field. */
  label: string
  /** Jam's own line under it, as far as its pane showed. */
  help: string
  /** What the account has set, or Jam's own words for the built-in. */
  value: string
  /** Nothing is set here, so the built-in applies. */
  builtIn: boolean
}

/** Jam's words where a field is unset. A combo box says which built-in applies; a number field is simply empty. */
const BUILT_IN: Partial<Record<string, string>> = {
  permission_timeout_secs: 'Built-in — wait indefinitely',
  room_activity: 'built-in default',
  room_owner_approvals: 'built-in default (on)',
  resume: 'built-in default (on)',
}

const ROWS: { key: RuntimeRow['key']; label: string; help: string }[] = [
  {
    key: 'compact_at_tokens',
    label: 'Compaction budget (input tokens)',
    help: 'Threads compact proactively at this context size. Built-in: 500k; 0 disables.',
  },
  {
    key: 'permission_timeout_secs',
    label: 'Human approval wait',
    help: 'Band keeps permission requests open until someone decides. Bounded presets auto-deny when their deadline passes.',
  },
  {
    key: 'question_timeout_secs',
    label: 'Overall question timeout (seconds)',
    help: 'Leave empty or use 0 to wait until someone answers. Enter a positive value to cancel unanswered questions.',
  },
  {
    key: 'idle_secs',
    label: 'Stop idle agents after (seconds)',
    help: 'Stops an idle agent after this long. It wakes when the next message arrives. Built-in: 600.',
  },
  {
    key: 'room_activity',
    label: 'Room activity feed',
    help: "Shows live tool calls and results in the agent's Band room. Individual agent settings take precedence.",
  },
  {
    key: 'room_owner_approvals',
    label: 'Room owners can approve permission asks',
    help: "Pending permission requests appear in the agent's room. A same-account room owner or human can approve them.",
  },
  {
    key: 'resume',
    label: 'Resume thread on wake',
    help: 'Keeps conversation context across idle/wake cycles.',
  },
]

/** Jam's line over the fields. */
export const AGENT_DEFAULTS_NOTE =
  'Defaults for new agents. Leave a field empty to use its built-in value. Settings on an individual agent take precedence.'

/**
 * Jam's Agent defaults rows, in its order, each showing what the account has set. A field the account has not set
 * reads as Jam's own words for its built-in, never as a number or a state this app chose: the daemon answers null
 * for "unset", and an unset field is not a field set to zero or to off.
 */
export function runtimeRows(defaults: RuntimeDefaults | null): RuntimeRow[] {
  return ROWS.map((row) => {
    const set = defaults?.[row.key]
    const builtIn = set === null || set === undefined || set === ''
    return {
      ...row,
      builtIn,
      value: builtIn ? (BUILT_IN[row.key] ?? 'Built-in') : String(set),
    }
  })
}
