// holder.mjs - the copyright holder, named on purpose in the three places a name belongs in what goes out: LICENSE's
// copyright line, package.json's author and the installer's copyright line (electron-builder.yml). check-identity.mjs
// lets the holder's name pass on exactly those lines, and nowhere else.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A holder that reads as a name: letters of any alphabet, spaces, dots, apostrophes and hyphens; never an email, a path or an id. */
export const HOLDER_NAME = /^\p{L}[\p{L} .'-]*\p{L}\.?$/u

/**
 * The lines, as `file:line`, that name the copyright holder. The holder and the year come from LICENSE's copyright line;
 * package.json's author and the installer's copyright line count only when they name the same holder (the installer's in
 * the same year). Nothing counts when LICENSE has no such line, or its holder does not read as a name.
 */
export function holderLines(base) {
  const named = new Set()
  const read = (file) => {
    try {
      return readFileSync(join(base, file), 'utf8').split(/\r?\n/)
    } catch {
      return []
    }
  }
  const copyright = read('LICENSE')
    .map((line) => line.trim().match(/^Copyright \(c\) (\d{4}) (.+)$/))
    .find(Boolean)
  if (!copyright || !HOLDER_NAME.test(copyright[2])) return named
  const [, year, holder] = copyright
  const expected = {
    LICENSE: `Copyright (c) ${year} ${holder}`,
    'package.json': `"author": "${holder}"`,
    'electron-builder.yml': `copyright: Copyright © ${year} ${holder}`,
  }
  for (const [file, text] of Object.entries(expected)) {
    read(file).forEach((line, index) => {
      if (line.trim().replace(/,$/, '') === text) named.add(`${file}:${index + 1}`)
    })
  }
  return named
}
