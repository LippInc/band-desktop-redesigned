import type { Migration } from '../node/db'

/** settings.db: app preferences and window state, owned by the main process. Append-only. */
export const SETTINGS_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'settings',
    sql: `CREATE TABLE settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;`,
  },
]
