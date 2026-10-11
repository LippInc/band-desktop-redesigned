import { request } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROUTES, startFakeDaemon, type FakeDaemon } from './server'

// The fake must behave as the live daemon did on 2026-09-18 and 2026-09-19 (docs/jam/routes.md), or the app's handling
// of those answers would be tested against something else.

/** Two of the fixture rooms: one with a plan and files, one without. */
const CHECKOUT = '5b0f6c2e-8d1a-4c3b-9e7f-2a4d6b8c0e11'
const RELEASE_NOTES = '8c2d4e6f-1a3b-4c5d-8e9f-0a1b2c3d4e5f'
/** Atlas, a fixture agent, and the fixtures' hand-made team (both invented). */
const ATLAS = '7a1d3c5e-2b4f-4a6c-8e0d-1f3a5c7e9b21'
const CHECKOUT_CREW = '5b8e2c4a-1f3d-4e6b-9a7c-0d2e4f6a8b1c'

let fake: FakeDaemon
beforeAll(async () => {
  fake = await startFakeDaemon()
})
afterAll(async () => {
  await fake.close()
})

function call(method: string, path: string, body?: unknown): Promise<{ status: number; type: string; text: string }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = request({ socketPath: fake.endpoint, method, path, headers: { Host: 'jamd' } }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (text += chunk))
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), text }),
      )
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

describe('the fake daemon', () => {
  it('answers ping with a version and a wire number', async () => {
    const { status, text } = await call('GET', '/v1/ping')
    expect(status).toBe(200)
    expect(JSON.parse(text)).toMatchObject({ version: expect.any(String), wire: 30 })
  })

  it('answers an unknown route with 404 and an empty body, as jamd does', async () => {
    expect(await call('GET', '/v1/definitelyNotARoute')).toMatchObject({ status: 404, text: '' })
    expect(await call('POST', '/v1/definitelyNotARoute', {})).toMatchObject({ status: 404, text: '' })
  })

  it('answers the wrong method with 405', async () => {
    expect((await call('POST', '/v1/ping', {})).status).toBe(405)
    expect((await call('GET', '/v1/rooms')).status).toBe(405)
  })

  it("names the first missing field in serde's words", async () => {
    const { status, text } = await call('POST', '/v1/dashboard', { profile: 'default' })
    expect(status).toBe(422)
    expect(text).toMatch(/^Failed to deserialize the JSON body into the target type: missing field `range`/)
  })

  it('has a fixture for every route it claims to answer', async () => {
    const value = (field: string): unknown =>
      field === 'range'
        ? '7d'
        : field === 'chat_id'
          ? CHECKOUT
          : field === 'team_id'
            ? CHECKOUT_CREW
            : field === 'draft'
              ? { name: 'Sweep', description: '', guidelines: '', agent_ids: [ATLAS], role_ids: [] }
              : 'default'
    try {
      for (const [route, spec] of Object.entries(ROUTES)) {
        const body =
          spec.method === 'POST' ? Object.fromEntries((spec.required ?? []).map((f) => [f, value(f)])) : undefined
        expect((await call(spec.method, route, body)).status, route).toBe(200)
      }
    } finally {
      // The sweep writes with stock values, and the writes the fake keeps would leave that junk in the answers for
      // the tests after it - or after a failing assertion - so each is put back to its fixture.
      fake.setRoomAnswer(CHECKOUT, '/v1/getRoomPlan', undefined)
      fake.setAnswer('/v1/roomOrg', undefined)
      fake.setAnswer('/v1/listTeams', undefined)
    }
  })

  it('keeps a team made or saved, as Band does, and refuses one with no agent in Band’s words', async () => {
    try {
      const draft = { name: 'Docs crew', description: '', guidelines: '', agent_ids: [ATLAS], role_ids: [] }
      const made = JSON.parse((await call('POST', '/v1/createTeam', { profile: 'default', draft })).text).team
      expect(made).toMatchObject({ name: 'Docs crew', agent_ids: [ATLAS], template_id: null })
      await call('POST', '/v1/updateTeam', {
        profile: 'default',
        team_id: made.id,
        draft: { ...draft, guidelines: 'Short.' },
      })
      const listed = JSON.parse((await call('POST', '/v1/listTeams', { profile: 'default' })).text).teams
      expect(listed.map((team: { name: string }) => team.name)).toEqual(['Checkout crew', 'Release crew', 'Docs crew'])
      expect(listed[2].guidelines).toBe('Short.')
      const none = await call('POST', '/v1/createTeam', { profile: 'default', draft: { ...draft, agent_ids: [] } })
      expect(none.status).toBe(400)
      expect(JSON.parse(none.text).error).toBe('Choose at least one agent for the team.')
      expect(
        (await call('POST', '/v1/updateTeam', { profile: 'default', team_id: 'no-such-team', draft })).status,
      ).toBe(404)
    } finally {
      fake.setAnswer('/v1/listTeams', undefined)
    }
  })

  it("answers a room's reads per room", async () => {
    const plan = await call('POST', '/v1/getRoomPlan', { chat_id: CHECKOUT })
    expect(JSON.parse(plan.text).plan.source.label).toBe('Checkout plan')
    const other = await call('POST', '/v1/getRoomPlan', { chat_id: RELEASE_NOTES })
    expect(JSON.parse(other.text).plan.source).toBeNull()
  })

  it('answers a room the account is not in as the daemon did: Band not found, or empty lists', async () => {
    const stranger = { profile: 'default', chat_id: '00000000-0000-4000-8000-000000000001' }
    const participants = await call('POST', '/v1/roomParticipants', stranger)
    expect(participants.status).toBe(500)
    expect(JSON.parse(participants.text).error).toMatch(/^band api: HTTP 404: .*not_found/)
    const files = await call('POST', '/v1/roomFileList', stranger)
    expect(JSON.parse(files.text).page.files).toEqual([])
  })

  it('can take a room route away and give it back', async () => {
    const body = { profile: 'default', chat_id: CHECKOUT }
    fake.removeRoute('/v1/roomParticipants')
    expect((await call('POST', '/v1/roomParticipants', body)).status).toBe(404)
    fake.setAnswer('/v1/roomParticipants', undefined)
    expect((await call('POST', '/v1/roomParticipants', body)).status).toBe(200)
  })

  it('carries no real identity in its account fixture', async () => {
    const { text } = await call('GET', '/v1/accounts')
    expect(text).toContain('@example.com')
  })
})
