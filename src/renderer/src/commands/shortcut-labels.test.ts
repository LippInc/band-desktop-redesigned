import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// A shortcut is written once, in the command registry (use-commands.ts); every button that shows one reads it from there
// (`commandById`). A label written by hand would go stale the day the registry changes, so none may exist.
const HAND_WRITTEN = /\bshortcut=["'{]\s*['"`]?[A-Za-z]+\+/

function renderSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return renderSources(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

describe('shortcut labels', () => {
  const root = join(import.meta.dirname, '..')

  it('are never written by hand outside the command registry', () => {
    const found = renderSources(root).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) => (HAND_WRITTEN.test(line) ? [`${relative(root, file)}:${index + 1}`] : [])),
    )
    expect(found).toEqual([])
  })

  it.each([
    ['a quoted label', '<IconButton label="Toggle sidebar" shortcut="Ctrl+B" />'],
    ['a label in braces', "<NavLinkRow shortcut={'Ctrl+N'} />"],
    ['a template label', '<NavLinkRow shortcut={`Alt+Left`} />'],
  ])('catches %s (known-bad)', (_label, line) => {
    expect(HAND_WRITTEN.test(line)).toBe(true)
  })

  it('lets a label read from the registry through', () => {
    expect(HAND_WRITTEN.test('<IconButton shortcut={command.shortcut} />')).toBe(false)
  })
})
