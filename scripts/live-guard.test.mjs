import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { assertLiveAllowed, liveBlackout, REFUSED_EXIT } from './lib/live-guard.mjs'

const dir = mkdtempSync(join(tmpdir(), 'jamr-guard-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => vi.restoreAllMocks())

function file(name, text) {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}

const periods = file('periods.json', JSON.stringify([{ from: '2026-03-10', to: '2026-03-12', why: 'busy' }]))
const on = (day) => new Date(`${day}T12:00:00`)

describe('liveBlackout', () => {
  it.each(['2026-03-10', '2026-03-11', '2026-03-12'])('blocks %s, inside the period (both ends included)', (day) => {
    expect(liveBlackout({ file: periods, today: on(day) })).toMatchObject({ from: '2026-03-10', why: 'busy' })
  })

  it.each(['2026-03-09', '2026-03-13', '2027-03-11'])('allows %s, outside it', (day) => {
    expect(liveBlackout({ file: periods, today: on(day) })).toBeNull()
  })

  it('allows everything when there is no file', () => {
    expect(liveBlackout({ file: null, today: on('2026-03-11') })).toBeNull()
  })

  it.each([
    ['text that is not JSON', 'not json'],
    ['a period without days', JSON.stringify([{ from: 'soon' }])],
    ['a period whose end comes before its start', JSON.stringify([{ from: '2026-03-12', to: '2026-03-10' }])],
    ['something that is not a list', JSON.stringify({ from: '2026-03-10', to: '2026-03-12' })],
  ])('treats %s as a blackout, never as permission', (_label, text) => {
    expect(liveBlackout({ file: file('bad.json', text), today: on('2027-01-01') })).not.toBeNull()
  })
})

const quiet = () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
}

describe('assertLiveAllowed', () => {
  it('refuses inside a blackout, with its own exit code', () => {
    quiet()
    const exit = vi.fn()
    expect(assertLiveAllowed('.', 'test', { argv: [], file: periods, today: on('2026-03-11'), exit })).toBe('refused')
    expect(exit).toHaveBeenCalledWith(REFUSED_EXIT)
    expect(REFUSED_EXIT).not.toBe(1)
  })

  it('lets --live-ok through a blackout, and anything through outside one', () => {
    quiet()
    const exit = vi.fn()
    const args = { file: periods, exit }
    expect(assertLiveAllowed('.', 'test', { ...args, argv: ['--live-ok'], today: on('2026-03-11') })).toBe('overridden')
    expect(assertLiveAllowed('.', 'test', { ...args, argv: [], today: on('2026-03-20') })).toBe('allowed')
    expect(exit).not.toHaveBeenCalled()
  })
})

describe('every script that reads the live daemon', () => {
  // The guard must run before the first thing that could reach the live daemon.
  it.each([
    ['dev.mjs', "assertLiveAllowed(root, 'dev:live')", "env.JAMR_DAEMON = 'live'"],
    ['record-shapes.mjs', "assertLiveAllowed(root, 'fixtures:record')", 'endpoint()\n'],
    ['packaged-smoke.mjs', "assertLiveAllowed(root, 'smoke:packaged')", 'spawn('],
  ])('%s passes the guard first', (script, guard, firstLiveStep) => {
    const source = readFileSync(join(import.meta.dirname, script), 'utf8')
    expect(source).toContain("from './lib/live-guard.mjs'")
    expect(source.indexOf(guard)).toBeGreaterThan(-1)
    expect(source.indexOf(firstLiveStep)).toBeGreaterThan(source.indexOf(guard))
  })
})
