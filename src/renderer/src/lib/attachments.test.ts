import { beforeEach, describe, expect, it } from 'vitest'
import { ATTACHMENT_LIMITS, type FileStoreInput } from '@shared/daemon-api'
import {
  AttachmentError,
  bytesToBase64,
  clearStaged,
  removeStaged,
  setStagingSending,
  stageFiles,
  STAGING_WHILE_SENDING,
  stagingProblem,
  storeStaged,
  useStaging,
} from './attachments'

/** Base64 written out the long way, three bytes at a time, to check the chunked encoder against something else. */
function referenceBase64(bytes: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const [a, b, c] = [bytes[at]!, bytes[at + 1], bytes[at + 2]]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += table[(n >> 18) & 63]! + table[(n >> 12) & 63]!
    out += b === undefined ? '=' : table[(n >> 6) & 63]!
    out += c === undefined ? '=' : table[n & 63]!
  }
  return out
}

const file = (name: string, size = 3, type = 'text/markdown') =>
  new File([new Uint8Array(size).fill(65)], name, { type })
const scopeOf = () => useStaging.getState().scopes.test!

beforeEach(() => {
  useStaging.setState({ scopes: {} })
})

describe('the files a message may carry', () => {
  /** Jam's own limits (user guide: "The attachment limit is ten files per message and 32 MB per file."). */
  it('takes a file of exactly 32 MB and refuses one byte more, by name', () => {
    const staged = [{ bytes: 1 }]
    expect(stagingProblem(staged, { name: 'at-the-limit.md', bytes: ATTACHMENT_LIMITS.bytes })).toBeNull()
    expect(stagingProblem(staged, { name: 'over.md', bytes: ATTACHMENT_LIMITS.bytes + 1 })).toBe(
      '“over.md” is larger than 32 MB.',
    )
  })

  it("takes the tenth file and refuses the eleventh, in the guide's own words", () => {
    const ten = Array.from({ length: ATTACHMENT_LIMITS.files }, () => ({ bytes: 1 }))
    expect(stagingProblem(ten.slice(0, -1), { name: 'tenth.md', bytes: 1 })).toBeNull()
    expect(stagingProblem(ten, { name: 'eleventh.md', bytes: 1 })).toBe(
      'The attachment limit is ten files per message.',
    )
  })

  it('refuses at staging what the store is never sent: an empty file and a name it will not take', () => {
    expect(stagingProblem([], { name: 'empty.md', bytes: 0 })).toBe('“empty.md” is empty.')
    expect(stagingProblem([], { name: '   ', bytes: 1 })).toBe('A file without a name cannot be attached.')
    expect(stagingProblem([], { name: 'x'.repeat(201), bytes: 1 })).toMatch(/has a name that cannot be attached/)
    expect(stagingProblem([], { name: '..', bytes: 1 })).toMatch(/has a name that cannot be attached/)
    expect(stagingProblem([], { name: `bell${String.fromCharCode(7)}.md`, bytes: 1 })).toMatch(/cannot be attached/)
    expect(stagingProblem([], { name: 'x'.repeat(200), bytes: 1 })).toBeNull()
  })

  it('encodes bytes as the store takes them, across the chunks they are read in', () => {
    expect(bytesToBase64(new TextEncoder().encode('hello').buffer as ArrayBuffer)).toBe('aGVsbG8=')
    // Bigger than the 8 KB step and not a multiple of three, so the joining of chunks and the padding are exercised,
    // checked against an encoder that reads no chunks at all.
    const big = new Uint8Array(20_001)
    for (let at = 0; at < big.length; at += 1) big[at] = (at * 7) % 256
    expect(bytesToBase64(big.buffer as ArrayBuffer)).toBe(referenceBase64(big))
  })
})

describe('a composer staging its files', () => {
  it('counts two drops close together against the limit of ten, and names what it refused', () => {
    stageFiles(
      'test',
      Array.from({ length: 8 }, (_, i) => file(`a${i}.md`)),
    )
    // No await between them: the second drop sees the first.
    stageFiles('test', [file('b1.md'), file('b2.md'), file('b3.md')])
    stageFiles('test', [file('c1.md')])
    expect(scopeOf().files.map((staged) => staged.name)).toHaveLength(10)
    expect(scopeOf().problem).toBe('The attachment limit is ten files per message.')
  })

  it('keeps staging the files after one it refused, and clears the refusal on the next staging or a removal', () => {
    stageFiles('test', [file('empty.md', 0), file('fine.md')])
    expect(scopeOf().files.map((staged) => staged.name)).toEqual(['fine.md'])
    expect(scopeOf().problem).toBe('“empty.md” is empty.')
    removeStaged('test', scopeOf().files[0]!.key)
    expect(scopeOf().problem).toBeNull()
    stageFiles('test', [file('empty.md', 0)])
    stageFiles('test', [file('next.md')])
    expect(scopeOf().problem).toBeNull()
  })

  it('changes nothing while a send carrying the files is on its way', () => {
    stageFiles('test', [file('one.md')])
    setStagingSending('test', true)
    stageFiles('test', [file('late.md')])
    removeStaged('test', scopeOf().files[0]!.key)
    expect(scopeOf().files.map((staged) => staged.name)).toEqual(['one.md'])
    expect(scopeOf().problem).toBe(STAGING_WHILE_SENDING)
    setStagingSending('test', false)
    clearStaged('test')
    expect(scopeOf().files).toEqual([])
  })
})

describe('storing the staged files', () => {
  it('stores each file once, in order, and a retry after a failure stores only what is not stored yet', async () => {
    stageFiles('test', [file('one.md'), file('two.md'), file('three.md')])
    const sent: FileStoreInput[] = []
    let failOn: string | null = 'two.md'
    const store = async (input: FileStoreInput) => {
      if (input.name === failOn)
        throw new Error(
          "Error invoking remote method 'jam:daemon': Error: [jam:rejected] The daemon did not store the file",
        )
      sent.push(input)
      return { id: `art-${input.name}` }
    }
    await expect(storeStaged('test', store, 'default', 'room-1')).rejects.toThrow(
      new AttachmentError('“two.md” could not be attached: The daemon did not store the file.'),
    )
    failOn = null
    expect(await storeStaged('test', store, 'default', 'room-1')).toEqual(['art-one.md', 'art-two.md', 'art-three.md'])
    expect(sent.map((input) => input.name)).toEqual(['one.md', 'two.md', 'three.md'])
    expect(sent[0]).toEqual({
      profile: 'default',
      roomId: 'room-1',
      name: 'one.md',
      mime: 'text/markdown',
      content: 'QUFB',
    })
    // Stored somewhere else (an assignment's unbound store), a file is stored again for that place.
    expect(await storeStaged('test', store, 'default', '')).toHaveLength(3)
    expect(sent).toHaveLength(6)
  })

  it('tells the store a kind it takes, and plain bytes for one it would refuse', async () => {
    stageFiles('test', [file('a.bin', 3, ''), file('b.txt', 3, 'text/plain')])
    const kinds: string[] = []
    await storeStaged('test', async (input) => (kinds.push(input.mime), { id: 'x' }), 'default', '')
    expect(kinds).toEqual(['application/octet-stream', 'text/plain'])
  })
})
