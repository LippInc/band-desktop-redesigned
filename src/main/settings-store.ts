import type { DatabaseSync } from 'node:sqlite'
import { resolveSettings, sanitizeSettingsPatch, type Settings } from '@shared/settings'

export type InternalKey = `internal.${string}`

/** Settings persisted in the local database. User-facing keys go through validation; internal keys are app bookkeeping. */
export class SettingsStore {
  readonly #db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.#db = db
  }

  getAll(): Settings {
    const rows = this.#db.prepare(`SELECT key, value FROM settings WHERE key NOT LIKE 'internal.%'`).all() as {
      key: string
      value: string
    }[]
    const stored: Record<string, unknown> = {}
    for (const { key, value } of rows) {
      try {
        stored[key] = JSON.parse(value)
      } catch {
        // a corrupt value falls back to its default in resolveSettings
      }
    }
    return resolveSettings(stored)
  }

  /** Validates and writes a patch atomically, then returns the full settings. Throws SettingsValidationError on bad input. */
  update(patch: unknown): Settings {
    this.#write(Object.entries(sanitizeSettingsPatch(patch)))
    return this.getAll()
  }

  getInternal<T>(key: InternalKey): T | undefined {
    const row = this.#db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return undefined
    try {
      return JSON.parse(row.value) as T
    } catch {
      return undefined
    }
  }

  setInternal(key: InternalKey, value: unknown): void {
    this.#write([[key, value]])
  }

  #write(entries: [string, unknown][]): void {
    if (entries.length === 0) return
    const upsert = this.#db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    const now = Date.now()
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      for (const [key, value] of entries) upsert.run(key, JSON.stringify(value), now)
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }
}
