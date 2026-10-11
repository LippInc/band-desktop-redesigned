// needles.mjs - the identity check's account needles only grow. A recording run that cannot read something (a room
// archived since, or a read that failed) keeps what earlier runs found, so a real id recorded then is still caught.

/** Every string needle of both caches, by kind, without duplicates; anything that is not a list of strings is dropped. */
export function mergeNeedles(previous, fresh) {
  const merged = {}
  for (const source of [previous, fresh]) {
    if (typeof source !== 'object' || source === null || Array.isArray(source)) continue
    for (const [kind, values] of Object.entries(source)) {
      if (!Array.isArray(values)) continue
      const strings = values.filter((value) => typeof value === 'string' && value)
      merged[kind] = [...new Set([...(merged[kind] ?? []), ...strings])]
    }
  }
  return merged
}
