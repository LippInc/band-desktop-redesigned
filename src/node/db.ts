import { DatabaseSync } from 'node:sqlite'

export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * Opens (or creates) a SQLite database and migrates it. node:sqlite ships inside Electron's Node, so the app has no native
 * module to rebuild. The only database is settings.db: everything Jam knows lives in the Jam daemon, never here.
 */
export function openDatabase(location: string, migrations: readonly Migration[]): DatabaseSync {
  const db = new DatabaseSync(location)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 3000')
  migrate(db, migrations)
  return db
}

export function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
  return row?.user_version ?? 0
}

/** Brings a database to the latest schema, one transaction per migration. Returns the resulting version. */
export function migrate(db: DatabaseSync, migrations: readonly Migration[]): number {
  assertNumbered(migrations)
  const latest = migrations.at(-1)?.version ?? 0
  const current = getSchemaVersion(db)
  if (current > latest) {
    throw new Error(
      `These settings were written by a newer version of this app (schema v${current}, this one knows v${latest}). Update the app before opening it.`,
    )
  }
  for (const migration of migrations) {
    if (migration.version <= current) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${(error as Error).message}`, {
        cause: error,
      })
    }
  }
  return getSchemaVersion(db)
}

function assertNumbered(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migrations must be numbered 1..n without gaps; found v${migration.version} at position ${index + 1}`,
      )
    }
  })
}
