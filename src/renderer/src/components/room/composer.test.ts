import { describe, expect, it } from 'vitest'
import type { Participant } from '@shared/daemon'
import { mentionablesOf, outgoing, type Mentionable } from './composer'

const ME = 'a1000000-0000-4000-8000-000000000001'
const ATLAS = 'a2000000-0000-4000-8000-000000000002'
const NOVA = 'a3000000-0000-4000-8000-000000000003'
const participants: Participant[] = [
  { id: ME, name: 'Maria Tamm', handle: 'maria', kind: 'User' },
  { id: ATLAS, name: 'Atlas', handle: 'maria/atlas', kind: 'Agent' },
  { id: NOVA, name: 'Nova', handle: 'maria/nova', kind: 'Agent' },
]

describe('who a message can mention', () => {
  it('lists the agents first, then the people, and never the person writing', () => {
    expect(mentionablesOf(participants, ME).map((item) => [item.name, item.kind])).toEqual([
      ['Atlas', 'agent'],
      ['Nova', 'agent'],
    ])
  })
})

describe('the message as it goes out', () => {
  const [atlas, nova] = mentionablesOf(participants, ME) as [Mentionable, Mentionable]

  it("writes each mention as the participant's handle, and lists its id once", () => {
    expect(outgoing('@Atlas please look, @Atlas', [atlas])).toEqual({
      content: '@maria/atlas please look, @maria/atlas',
      mentions: [ATLAS],
    })
  })

  it('leaves out a mention whose name was deleted from the draft', () => {
    expect(outgoing('@Nova only', [atlas, nova])).toEqual({ content: '@maria/nova only', mentions: [NOVA] })
    expect(outgoing('nobody here', [atlas])).toEqual({ content: 'nobody here', mentions: [] })
  })

  it('keeps the name when the handle is not known, and still mentions the id', () => {
    const nameless: Mentionable = { id: ATLAS, name: 'Atlas', handle: null, kind: 'agent' }
    expect(outgoing('@Atlas hi', [nameless])).toEqual({ content: '@Atlas hi', mentions: [ATLAS] })
  })

  it('reads a name that starts another one as the longer name, and a name inside a word as no mention', () => {
    const al: Mentionable = { id: ATLAS, name: 'Al', handle: 'maria/al', kind: 'agent' }
    const alex: Mentionable = { id: NOVA, name: 'Alex', handle: 'maria/alex', kind: 'agent' }
    expect(outgoing('@Al @Alex hi', [al, alex])).toEqual({
      content: '@maria/al @maria/alex hi',
      mentions: [ATLAS, NOVA],
    })
    // Al was chosen, then deleted, then Alex chosen: the message goes to Alex alone.
    expect(outgoing('@Alex hi', [al, alex])).toEqual({ content: '@maria/alex hi', mentions: [NOVA] })
    expect(outgoing('@Alfred, @Al.', [al])).toEqual({ content: '@Alfred, @maria/al.', mentions: [ATLAS] })
    // A name followed by a space can start a longer name: the longer one is read first.
    const sam: Mentionable = { id: ATLAS, name: 'Sam', handle: 'sam', kind: 'person' }
    const samRivera: Mentionable = { id: NOVA, name: 'Sam Rivera', handle: 'sam-rivera', kind: 'person' }
    expect(outgoing('@Sam Rivera hi', [samRivera, sam])).toEqual({ content: '@sam-rivera hi', mentions: [NOVA] })
  })

  it('means the one chosen last of two with the same name, and writes the name when the handle is empty', () => {
    const first: Mentionable = { id: ATLAS, name: 'Atlas', handle: 'maria/atlas', kind: 'agent' }
    const second: Mentionable = { id: NOVA, name: 'Atlas', handle: 'kai/atlas', kind: 'agent' }
    expect(outgoing('@Atlas hi', [first, second])).toEqual({ content: '@kai/atlas hi', mentions: [NOVA] })
    const blank: Mentionable = { id: ATLAS, name: 'Atlas', handle: '', kind: 'agent' }
    expect(outgoing('@Atlas hi', [blank])).toEqual({ content: '@Atlas hi', mentions: [ATLAS] })
  })
})
