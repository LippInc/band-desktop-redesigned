import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SETTINGS_MIGRATIONS } from '../main/settings-schema'
import { getSchemaVersion, migrate, type Migration } from './db'

const tableNames = (db: DatabaseSync) =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]).map(
    (row) => row.name,
  )

const SAMPLE: Migration[] = [
  { version: 1, name: 'one', sql: 'CREATE TABLE one (x)' },
  { version: 2, name: 'two', sql: 'CREATE TABLE two (x)' },
]

describe('migrate', () => {
  it('applies every shipped settings.db migration to a fresh database', () => {
    const db = new DatabaseSync(':memory:')
    expect(migrate(db, SETTINGS_MIGRATIONS)).toBe(SETTINGS_MIGRATIONS.length)
  })

  it('brings a fresh database to the latest version', () => {
    const db = new DatabaseSync(':memory:')
    expect(migrate(db, SAMPLE)).toBe(2)
    expect(tableNames(db)).toEqual(['one', 'two'])
  })

  it('does nothing when the database is already current', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, SAMPLE)
    expect(() => migrate(db, SAMPLE)).not.toThrow()
    expect(getSchemaVersion(db)).toBe(2)
  })

  it('refuses settings written by a newer app', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA user_version = 3')
    expect(() => migrate(db, SAMPLE)).toThrow(/newer version of this app/)
  })

  it('refuses a migration list with gaps', () => {
    const gapped: Migration[] = [SAMPLE[0]!, { version: 3, name: 'three', sql: 'CREATE TABLE three (x)' }]
    expect(() => migrate(new DatabaseSync(':memory:'), gapped)).toThrow(/without gaps/)
  })

  it('rolls back a failing migration and keeps the earlier ones', () => {
    const db = new DatabaseSync(':memory:')
    const broken: Migration[] = [
      SAMPLE[0]!,
      { version: 2, name: 'broken', sql: 'CREATE TABLE half (x); INSERT INTO missing_table VALUES (1);' },
    ]
    expect(() => migrate(db, broken)).toThrow(/Migration 2 \(broken\) failed/)
    expect(getSchemaVersion(db)).toBe(1)
    expect(tableNames(db)).toEqual(['one'])
  })
})
