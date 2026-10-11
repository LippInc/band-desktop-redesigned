// record-shapes.mjs - `pnpm fixtures:record`: LIVE and READ-ONLY, run on purpose and only past the live guard
// (scripts/lib/live-guard.mjs). Reads the routes in READS from the running Jam daemon, saves each raw answer to
// .local/live/ (gitignored: it holds real account data), prints each answer's SHAPE (keys and types, never values), and
// writes .local/identity-needles.json, the account details the identity check must never find in what goes out. Fixtures
// are then written by hand from the shapes, with invented content (tests/fake-daemon/fixtures).
// Only reads are allowed here: a route is listed only after its name, the CLI's help and the user guide all say it changes
// nothing, and a write never enters this file. A room's contents are read from one room only, the room made for
// recording shapes (scripts/lib/recording-room.mjs); every other room is only listed.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { join, resolve } from 'node:path'
import { assertLiveAllowed } from './lib/live-guard.mjs'
import { localFile } from './lib/local-file.mjs'
import { mergeNeedles } from './lib/needles.mjs'
import { pickRecordingRoom } from './lib/recording-room.mjs'

const root = resolve(import.meta.dirname, '..')
const out = join(root, '.local', 'live')
const PROFILE = process.env.JAMR_PROFILE ?? 'default'
/**
 * The one room whose contents are read: the room made for recording shapes. Every other room is only listed. Its title
 * is named in the gitignored `.local/record-room.txt`, never here, because it is a room on the account doing the
 * recording. Without that file, and with no room or several rooms of that title, no room's contents are read at all.
 */
const roomTitleFile = localFile(root, 'record-room.txt')
const RECORDING_ROOM = roomTitleFile ? readFileSync(roomTitleFile, 'utf8').trim() : ''

/** Route, method, body. Every one of these was checked to be a read on 2026-09-18 (docs/jam/routes.md). */
const READS = [
  ['ping', 'GET'],
  ['accounts', 'GET'],
  ['listExperiments', 'GET'],
  ['listDiscovered', 'GET'],
  ['archives', 'GET'],
  ['usageActiveBlock', 'GET'],
  ['deploymentStatus', 'GET'],
  ['list', 'GET'],
  ['whoami', 'POST', { profile: PROFILE }],
  ['rooms', 'POST', { profile: PROFILE }],
  ['roomOrg', 'POST', { profile: PROFILE }],
  ['agent-list', 'POST', { profile: PROFILE }],
  ['defaultAgent', 'POST', { profile: PROFILE }],
  ['contactsOverview', 'POST', { profile: PROFILE }],
  ['artifactListAll', 'POST', { profile: PROFILE }],
  ['dashboard', 'POST', { profile: PROFILE, range: '7d' }],
  ['notificationPreferences', 'POST', {}],
  ['logConfig', 'POST', {}],
  ['runtimeDefaults', 'POST', {}],
  ['accountRateLimits', 'POST', {}],
  ['dockerSandboxSupport', 'POST', {}],
  ['managedRuntimeSupport', 'POST', {}],
  ['activity', 'POST', { query: {} }],
  ['usageReport', 'POST', { req: { kind: 'daily' } }],
  ['usageSessions', 'POST', { req: {} }],
  ['accountRoomSnapshot', 'POST', { profile: PROFILE }],
]

/**
 * A room's reads, each {profile, chat_id} (formats learned from the daemon's 422s on 2026-09-19, docs/jam/routes.md),
 * asked only of the room titled RECORDING_ROOM. /v1/roomWorkSnapshot is not here: it ignores the room and answers with the
 * whole account's work.
 */
const ROOM_READS = [
  ['roomMessageSnapshot', {}],
  ['roomMessages', { query: { page: 1, page_size: 50, message_type: '', since: '' } }],
  ['roomParticipants', {}],
  ['roomPeers', {}],
  ['roomFileList', {}],
  ['roomLocality', {}],
  ['getRoomPlan', {}],
  ['getRoomBoard', {}],
  ['roomWorkLanes', {}],
  ['artifactList', {}],
]

function endpoint() {
  if (process.platform === 'win32') {
    const pipes = readdirSync('\\\\.\\pipe\\').filter((name) => /^jam-[0-9a-f]{8,64}$/i.test(name))
    if (pipes.length !== 1) throw new Error(`expected one Jam daemon pipe, found ${pipes.length}`)
    return { socket: `\\\\.\\pipe\\${pipes[0]}`, hash: pipes[0].slice(4) }
  }
  return { socket: join(process.env.JAM_CONFIG_DIR ?? join(process.env.HOME ?? '', '.jam'), 'jam.sock'), hash: null }
}

function call(socket, route, method, body) {
  return new Promise((resolveCall, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const headers = { Host: 'jamd', Accept: 'application/json' }
    if (data !== undefined)
      Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) })
    const req = http.request({ socketPath: socket, path: `/v1/${route}`, method, headers }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (text += chunk))
      res.on('end', () => resolveCall({ status: res.statusCode, text }))
    })
    req.setTimeout(15_000, () => req.destroy(new Error(`timeout on ${route}`)))
    req.on('error', reject)
    if (data !== undefined) req.write(data)
    req.end()
  })
}

function shape(value, depth = 0) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return value.length ? `[${value.length}× ${shape(value[0], depth)}]` : '[]'
  if (typeof value === 'object') {
    if (depth > 5) return '{…}'
    const pad = '  '.repeat(depth + 1)
    const lines = Object.entries(value).map(([key, item]) => `${pad}${key}: ${shape(item, depth + 1)}`)
    return `{\n${lines.join('\n')}\n${'  '.repeat(depth)}}`
  }
  return typeof value
}

assertLiveAllowed(root, 'fixtures:record')
const { socket, hash } = endpoint()
mkdirSync(out, { recursive: true })
const answers = {}
for (const [route, method, body] of READS) {
  const { status, text } = await call(socket, route, method, body)
  writeFileSync(join(out, `${route}.json`), text)
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON; the status says why
  }
  answers[route] = json
  console.log(`\n== ${method} /v1/${route} -> ${status}`)
  console.log(json ? shape(json) : '(not JSON)')
}

const rooms = Array.isArray(answers.rooms?.rooms) ? answers.rooms.rooms : []
const recordingRoom = pickRecordingRoom(rooms, RECORDING_ROOM)
const roomAnswers = {}
if (recordingRoom) {
  const chatId = recordingRoom.id
  mkdirSync(join(out, 'room'), { recursive: true })
  for (const [route, extra] of ROOM_READS) {
    const { status, text } = await call(socket, route, 'POST', { profile: PROFILE, chat_id: chatId, ...extra })
    writeFileSync(join(out, 'room', `${route}.json`), text)
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      // not JSON; the status says why
    }
    roomAnswers[route] = json
    console.log(`\n== POST /v1/${route} (the recording room) -> ${status}`)
    console.log(json ? shape(json) : '(not JSON)')
  }
} else {
  console.log(
    RECORDING_ROOM
      ? `\nroom reads skipped: no single room is titled ${RECORDING_ROOM}`
      : '\nroom reads skipped: .local/record-room.txt does not name the room whose contents may be read',
  )
}

// What identifies the account, for scripts/check-identity.mjs. Never committed (.local/ is gitignored).
const needles = { 'the Jam pipe hash': hash ? [hash] : [] }
for (const account of answers.accounts?.accounts ?? []) {
  const identity = account.identity ?? {}
  needles['the Jam user id'] = [...(needles['the Jam user id'] ?? []), identity.user_id]
  needles['the Jam email'] = [...(needles['the Jam email'] ?? []), identity.email]
  needles['the Jam handle'] = [...(needles['the Jam handle'] ?? []), identity.handle]
  needles['the Jam name'] = [
    ...(needles['the Jam name'] ?? []),
    [identity.first_name, identity.last_name].filter(Boolean).join(' '),
    identity.first_name,
    identity.last_name,
  ]
  needles['the Jam account instance'] = [...(needles['the Jam account instance'] ?? []), account.account_instance]
}
// Every room's id, every agent's id, and the ids and hashes of what that room holds: a fixture's are invented, so a
// real one in what goes out means a raw answer was copied.
needles['a Jam room id'] = rooms.map((room) => room?.id)
needles['a Jam agent id'] = (answers['agent-list']?.list?.rows ?? []).map((row) => row?.id)
const files = roomAnswers.roomFileList?.page?.files ?? []
const artifacts = roomAnswers.artifactList?.artifacts ?? []
needles['a Jam room item id'] = [
  ...(roomAnswers.roomParticipants?.participants ?? []).map((participant) => participant?.id),
  ...files.flatMap((file) => [file?.id, file?.local_artifact_id, file?.sha256]),
  ...artifacts.flatMap((artifact) => [artifact?.id, artifact?.sha256]),
  roomAnswers.getRoomPlan?.plan?.source?.attachment_id,
]
const needleFile = join(root, '.local', 'identity-needles.json')
let earlier
try {
  earlier = JSON.parse(readFileSync(needleFile, 'utf8'))
} catch {
  // no cache yet, or one that cannot be read: this run's needles alone
}
writeFileSync(needleFile, JSON.stringify(mergeNeedles(earlier, needles), null, 2))
console.log(
  `\nfixtures:record: ${READS.length} reads saved to .local/live/, needles written to .local/identity-needles.json`,
)
