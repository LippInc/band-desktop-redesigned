import {
  AccountsSchema,
  AgentListSchema,
  AgentRowSchema,
  AgentSessionSchema,
  AgentSessionsSchema,
  AgentStatusSchema,
  ArtifactStoreSchema,
  BoardTaskSchema,
  ChatSchema,
  ContactsOverviewSchema,
  DaemonInfoSchema,
  HISTORY_MAX_PAGES,
  HISTORY_PAGE_SIZE,
  DASHBOARD_RANGES,
  DashboardSchema,
  USAGE_KINDS,
  UsageReportSchema,
  UsageSessionsSchema,
  ExperimentsSchema,
  HostPeersSchema,
  LogConfigSchema,
  NotificationPreferencesSchema,
  ParticipantsSchema,
  readEach,
  ROOM_ID,
  RoomBoardSchema,
  RoomFilesSchema,
  RoomMessageSchema,
  RoomHistorySchema,
  RoomMessagesSchema,
  RoomOrgSchema,
  RoomPlanSchema,
  RoomsSchema,
  RuntimeDefaultsSchema,
  RoomWorkLanesSchema,
  TEAM_LIMITS,
  TeamAnswerSchema,
  TeamSchema,
  TeamsSchema,
  RuntimePermissionSchema,
  RuntimePermissionsSchema,
  toAgentStatus,
  toDiscovered,
  toHostPeers,
  toRoomMessage,
  toWorkLane,
  WorkSnapshotSchema,
  DecisionAnswerSchema,
  DIRECTORY_KINDS,
  DirectoryEntrySchema,
  DirectorySchema,
  DefaultAgentSchema,
  DeletePreviewSchema,
  KickoffSchema,
  RoomSendAnswerSchema,
  type AgentTarget,
  type DirectoryKind,
  type RoomOrg,
  type TeamDraft,
  type UsageKind,
} from '@shared/daemon'
import {
  PERMISSION_OUTCOMES,
  ATTACHMENT_LIMITS,
  ATTACHMENT_MAX_BASE64,
  ATTACHMENT_MIME,
  ATTACHMENT_MIME_MAX,
  isAttachmentName,
  type DaemonInput,
  type DaemonOperationName,
  type DaemonOutput,
  type DecisionInput,
  type FileInput,
  type FileStoreInput,
  type InterruptInput,
  type KickoffInput,
  type MessageInput,
  type RoomInput,
  type RoomPageInput,
} from '@shared/daemon-api'
import { PROFILE_PATTERN } from '@shared/settings'
import { assertRouteAllowed } from './forbidden'

/** Thrown for input the page sent that an operation does not accept. */
export class OperationInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperationInputError'
  }
}

export interface OperationSpec<K extends DaemonOperationName> {
  method: 'GET' | 'POST'
  route: `/v1/${string}`
  /** Reads never change anything in Jam; a write names what it changes in its own comment. */
  kind: 'read' | 'write'
  /** Validates what the page sent. Throws OperationInputError. */
  input: (raw: unknown) => DaemonInput<K>
  /** The JSON body for a POST. */
  body?: (input: DaemonInput<K>) => unknown
  /** Validates the daemon's answer and returns what the page gets. Throws on an answer it cannot use. */
  output: (raw: unknown) => DaemonOutput<K>
  timeoutMs?: number
  /**
   * What the page is told when the daemon refuses, in place of the daemon's own words, for a route whose answers can
   * name a path on this computer: a refusal's text is the daemon's, and it can carry what the answer would have.
   */
  rejection?: string
}

function none(raw: unknown): void {
  if (raw !== undefined && raw !== null) throw new OperationInputError('This operation takes no input')
}

function record(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new OperationInputError('The input must be an object')
  }
  return raw as Record<string, unknown>
}

function profileOf(raw: unknown): string {
  const { profile } = record(raw)
  if (typeof profile !== 'string' || !PROFILE_PATTERN.test(profile)) {
    throw new OperationInputError('Unknown account profile')
  }
  return profile
}

function withProfile(raw: unknown): { profile: string } {
  return { profile: profileOf(raw) }
}

function roomInput(raw: unknown): RoomInput {
  const { roomId } = record(raw)
  if (typeof roomId !== 'string' || !ROOM_ID.test(roomId)) throw new OperationInputError('Unknown room')
  return { profile: profileOf(raw), roomId }
}

const roomBody = ({ profile, roomId }: RoomInput) => ({ profile, chat_id: roomId })

function roomPageInput(raw: unknown): RoomPageInput {
  const { page } = record(raw)
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > HISTORY_MAX_PAGES) {
    throw new OperationInputError('Unknown page of the conversation')
  }
  return { ...roomInput(raw), page }
}

/** A local agent's scope and handle, as Jam mints them: lowercase words (`jam onboard`, `jam agent create`). */
const SCOPE = /^[a-z0-9][a-z0-9._-]{0,63}$/
const HANDLE = /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/

function agentTarget(raw: unknown): AgentTarget {
  const { scope, handle } = record(raw)
  if (typeof scope !== 'string' || !SCOPE.test(scope)) throw new OperationInputError('Unknown agent')
  if (typeof handle !== 'string' || !HANDLE.test(handle)) throw new OperationInputError('Unknown agent')
  return { profile: profileOf(raw), scope, handle }
}

/** A Band id (an agent's or a team's): letters, digits and dashes, as the UUIDs Band gives them are. */
const BAND_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * A role's id, as a team from Band's Library carries it. No live team with a role has been read, so its form is not
 * known: an edit sends the team's own roles back unchanged, and any short id without spaces or control characters is
 * kept rather than refused.
 */
const ROLE_ID = /^[^\s\p{Cc}]{1,128}$/u

/** A team as the person writes it: Band's New team and Edit team take a name, a description, guidelines and agents. */
function teamDraftOf(raw: unknown): TeamDraft {
  const { draft } = record(raw)
  const { name, description, guidelines, agentIds, roleIds } = record(draft)
  if (typeof name !== 'string' || !name.trim()) throw new OperationInputError('A team needs a name')
  if (name.length > TEAM_LIMITS.name) {
    throw new OperationInputError(`A team’s name is at most ${TEAM_LIMITS.name} characters`)
  }
  if (typeof description !== 'string' || description.length > TEAM_LIMITS.description) {
    throw new OperationInputError('A team’s description is text')
  }
  if (typeof guidelines !== 'string' || guidelines.length > TEAM_LIMITS.guidelines) {
    throw new OperationInputError('A team’s guidelines are text')
  }
  const ids = (list: unknown, what: string, pattern: RegExp) => {
    if (
      !Array.isArray(list) ||
      list.length > TEAM_LIMITS.agents ||
      !list.every((id) => typeof id === 'string' && pattern.test(id))
    ) {
      throw new OperationInputError(`Unknown ${what}`)
    }
    return [...new Set(list as string[])]
  }
  const agents = ids(agentIds, 'agent', BAND_ID)
  // Band's own refusal, said before anything is sent: "Choose at least one agent for the team."
  if (agents.length === 0) throw new OperationInputError('Choose at least one agent for the team.')
  return {
    name: name.trim(),
    description: description.trim(),
    guidelines: guidelines.trim(),
    agentIds: agents,
    roleIds: ids(roleIds, 'role', ROLE_ID),
  }
}

const draftBody = (draft: TeamDraft) => ({
  name: draft.name,
  description: draft.description,
  guidelines: draft.guidelines,
  agent_ids: draft.agentIds,
  role_ids: draft.roleIds,
})

/** A message's longest text, and its most mentions: a message is words to people and agents, not a file. */
export const MESSAGE_LIMITS = { chars: 20_000, mentions: 50 } as const

/** A room's title, as a person types one. Band takes a free string; this app refuses an empty or unreasonable one. */
const TITLE_MAX = 200

function titleInput(raw: unknown): RoomInput & { title: string } {
  const { title } = record(raw)
  if (typeof title !== 'string' || !title.trim() || title.length > TITLE_MAX) {
    throw new OperationInputError('A room needs a name')
  }
  return { ...roomInput(raw), title: title.trim() }
}

function participantInput(raw: unknown): RoomInput & { participantId: string } {
  const { participantId } = record(raw)
  if (typeof participantId !== 'string' || !ROOM_ID.test(participantId)) {
    throw new OperationInputError('Unknown participant')
  }
  return { ...roomInput(raw), participantId }
}

/** A host session's id, as the daemon writes one (a template's own name, or `<template>-<room id>`). */
const HOST_SESSION = /^[A-Za-z0-9_.-]{1,200}$/

function interruptInput(raw: unknown): InterruptInput {
  const { hostSession } = record(raw)
  if (typeof hostSession !== 'string' || !HOST_SESSION.test(hostSession)) {
    throw new OperationInputError('Unknown session')
  }
  return { ...agentTarget(raw), hostSession }
}

/** An artifact id, as the daemon writes one. */
const ARTIFACT_ID = /^[A-Za-z0-9_-]{1,128}$/

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** Long enough for Jam's largest file (32 MB, some 45 MB as base64) to cross a slow disk; the default is 15 s. */
const FILE_STORE_TIMEOUT_MS = 120_000

function fileStoreInput(raw: unknown): FileStoreInput {
  const { name, mime, content, roomId } = record(raw)
  // A room's id binds the file to that room; the empty string leaves it unbound, for Home's assignment, which
  // opens a room of its own only when it is sent (the CLI's own `--room` default).
  if (typeof roomId !== 'string' || (roomId !== '' && !ROOM_ID.test(roomId))) {
    throw new OperationInputError('Unknown room')
  }
  // The name and the kind the page already checked when the file was staged (isAttachmentName), checked again here.
  if (typeof name !== 'string' || !isAttachmentName(name)) throw new OperationInputError('A file needs a name')
  if (typeof mime !== 'string' || mime.length > ATTACHMENT_MIME_MAX || !ATTACHMENT_MIME.test(mime)) {
    throw new OperationInputError('Unknown file kind')
  }
  const padding = typeof content === 'string' ? (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0) : 0
  const decodedBytes = typeof content === 'string' ? (content.length / 4) * 3 - padding : 0
  if (
    typeof content !== 'string' ||
    content.length === 0 ||
    content.length > ATTACHMENT_MAX_BASE64 ||
    content.length % 4 !== 0 ||
    !BASE64.test(content) ||
    decodedBytes > ATTACHMENT_LIMITS.bytes
  ) {
    throw new OperationInputError('Unknown file bytes')
  }
  return { profile: profileOf(raw), roomId, name: name.trim(), mime, content }
}

function fileInput(raw: unknown): FileInput {
  const { id } = record(raw)
  if (typeof id !== 'string' || !ARTIFACT_ID.test(id)) throw new OperationInputError('Unknown file')
  return { profile: profileOf(raw), id }
}

/** The longest search the picker sends: a name, a handle or an email, not a paragraph. */
const DIRECTORY_QUERY_MAX = 200

/** An assignment's longest instruction. Home's composer is one instruction, not a document. */
export const KICKOFF_LIMIT = 20_000

function kickoffInput(raw: unknown): KickoffInput {
  const { message } = record(raw)
  if (typeof message !== 'string' || !message.trim() || message.length > KICKOFF_LIMIT) {
    throw new OperationInputError('An assignment needs an instruction')
  }
  return { ...agentTarget(raw), message, ...attachmentIdsOf(raw) }
}

/** The files a message or an assignment attaches: ids the artifact store answered, never names or paths. */
function attachmentIdsOf(raw: unknown): { attachmentIds?: string[] } {
  const { attachmentIds } = record(raw)
  if (attachmentIds === undefined) return {}
  if (
    !Array.isArray(attachmentIds) ||
    attachmentIds.length === 0 ||
    attachmentIds.length > ATTACHMENT_LIMITS.files ||
    !attachmentIds.every((id) => typeof id === 'string' && ARTIFACT_ID.test(id))
  ) {
    throw new OperationInputError('Unknown attached files')
  }
  return { attachmentIds: [...new Set(attachmentIds as string[])] }
}

/** The agent Home preselects, named as the daemon names a local agent: `<profile>/<scope>`. */
function peerInput(raw: unknown): { profile: string; peer: string } {
  const { peer } = record(raw)
  if (typeof peer !== 'string') throw new OperationInputError('Unknown agent')
  const [profile, scope, ...rest] = peer.split('/')
  if (rest.length > 0 || !PROFILE_PATTERN.test(profile ?? '') || !SCOPE.test(scope ?? '')) {
    throw new OperationInputError('Unknown agent')
  }
  return { profile: profileOf(raw), peer }
}

function messageInput(raw: unknown): MessageInput {
  const { content, mentions } = record(raw)
  if (typeof content !== 'string' || !content.trim() || content.length > MESSAGE_LIMITS.chars) {
    throw new OperationInputError('A message needs text')
  }
  // Band refuses a message without a mention (`mentions` minItems 1, 2026-09-19); a mention is a participant's id.
  if (
    !Array.isArray(mentions) ||
    mentions.length === 0 ||
    mentions.length > MESSAGE_LIMITS.mentions ||
    !mentions.every((id) => typeof id === 'string' && ROOM_ID.test(id))
  ) {
    throw new OperationInputError('A message mentions at least one participant')
  }
  return { ...roomInput(raw), content, mentions: [...new Set(mentions as string[])], ...attachmentIdsOf(raw) }
}

/** A runtime permission request's id as the daemon writes it ("claude-permission:claudecode:<turn>:<n>"). */
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,300}$/

function decisionInput(raw: unknown): DecisionInput {
  const { requestId, outcome } = record(raw)
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw new OperationInputError('Unknown request')
  if (typeof outcome !== 'string' || !(PERMISSION_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new OperationInputError('Unknown answer')
  }
  return { ...agentTarget(raw), requestId, outcome: outcome as DecisionInput['outcome'] }
}

/**
 * The whole daemon surface the page can reach. Every route here, with its
 * request format, is in docs/jam/routes.md. Most are reads; the writes are marked `write`,
 * each one thing the person does, and each one's own comment opens with "Changes:" and says what it changes. The
 * README's "Act on its own" lists them in the same words, and a test fails when the two disagree.
 */
export const OPERATIONS: { [K in DaemonOperationName]: OperationSpec<K> } = {
  ping: {
    method: 'GET',
    route: '/v1/ping',
    kind: 'read',
    input: none,
    output: (raw) => DaemonInfoSchema.parse(raw),
    timeoutMs: 3_000,
  },
  accounts: {
    method: 'GET',
    route: '/v1/accounts',
    kind: 'read',
    input: none,
    output: (raw) => AccountsSchema.parse(raw).accounts,
  },
  experiments: {
    method: 'GET',
    route: '/v1/listExperiments',
    kind: 'read',
    input: none,
    output: (raw) => {
      const { snapshot } = ExperimentsSchema.parse(raw)
      return { revision: snapshot.revision ?? null, experiments: snapshot.experiments }
    },
  },
  rooms: {
    method: 'POST',
    route: '/v1/rooms',
    kind: 'read',
    input: withProfile,
    body: (input) => input,
    output: (raw) => RoomsSchema.parse(raw).rooms,
  },
  roomOrg: {
    method: 'POST',
    route: '/v1/roomOrg',
    kind: 'read',
    input: withProfile,
    body: (input) => input,
    output: (raw) => RoomOrgSchema.parse(raw).org,
  },
  agentList: {
    method: 'POST',
    route: '/v1/agent-list',
    kind: 'read',
    input: withProfile,
    body: (input) => input,
    output: (raw) => {
      const { list } = AgentListSchema.parse(raw)
      return { ...list, rows: readEach(AgentRowSchema, list.rows).items }
    },
  },
  // Band Desktop 0.4.14's Teams: the account's teams, each one read on its own so one in a changed format is left out.
  teams: {
    method: 'POST',
    route: '/v1/listTeams',
    kind: 'read',
    input: withProfile,
    body: (input) => input,
    output: (raw) => readEach(TeamSchema, TeamsSchema.parse(raw).teams).items,
  },
  discovered: {
    method: 'GET',
    route: '/v1/listDiscovered',
    kind: 'read',
    input: none,
    output: (raw) => toDiscovered(raw),
  },
  notificationPreferences: {
    method: 'POST',
    route: '/v1/notificationPreferences',
    kind: 'read',
    input: none,
    body: () => ({}),
    output: (raw) => NotificationPreferencesSchema.parse(raw).preferences,
  },
  logConfig: {
    method: 'POST',
    route: '/v1/logConfig',
    kind: 'read',
    input: none,
    body: () => ({}),
    output: (raw) => LogConfigSchema.parse(raw).config,
  },
  contactsOverview: {
    method: 'POST',
    route: '/v1/contactsOverview',
    kind: 'read',
    input: withProfile,
    body: (input) => input,
    output: (raw) => ContactsOverviewSchema.parse(raw).overview,
  },
  dashboard: {
    method: 'POST',
    route: '/v1/dashboard',
    kind: 'read',
    input: (raw) => {
      const { range } = record(raw)
      if (typeof range !== 'string' || !(DASHBOARD_RANGES as readonly string[]).includes(range)) {
        throw new OperationInputError('Unknown range')
      }
      return { profile: profileOf(raw), range: range as (typeof DASHBOARD_RANGES)[number] }
    },
    body: (input) => input,
    output: (raw) => DashboardSchema.parse(raw).snapshot,
  },
  // What the coding agents on this computer used. Both are reads of measurements the daemon already keeps; neither
  // names a room or an agent, so neither can reach anything of another account's.
  usageReport: {
    method: 'POST',
    route: '/v1/usageReport',
    kind: 'read',
    input: (raw) => {
      const { kind } = record(raw)
      if (typeof kind !== 'string' || !(USAGE_KINDS as readonly string[]).includes(kind)) {
        throw new OperationInputError('Unknown usage kind')
      }
      return { kind: kind as UsageKind }
    },
    body: (input) => ({ req: { kind: input.kind } }),
    output: (raw) => UsageReportSchema.parse(raw).report,
  },
  usageSessions: {
    method: 'POST',
    route: '/v1/usageSessions',
    kind: 'read',
    input: none,
    body: () => ({ req: {} }),
    output: (raw) => UsageSessionsSchema.parse(raw).report,
  },
  // A room's reads, in the shapes the daemon answered with (2026-09-19). A room this account
  // is not in answers 500 ("band api: HTTP 404") for its participants and empty lists for the rest.
  roomParticipants: {
    method: 'POST',
    route: '/v1/roomParticipants',
    kind: 'read',
    input: roomInput,
    body: roomBody,
    output: (raw) => ParticipantsSchema.parse(raw).participants,
  },
  roomMessages: {
    method: 'POST',
    route: '/v1/roomMessageSnapshot',
    kind: 'read',
    input: roomInput,
    body: roomBody,
    output: (raw) => {
      const { snapshot } = RoomMessagesSchema.parse(raw)
      const state = snapshot.recovery?.state
      const { items, unreadable } = readEach(RoomMessageSchema, snapshot.messages)
      return {
        messages: items.map(toRoomMessage),
        unreadable,
        hasMore: snapshot.has_more ?? false,
        loading: state !== undefined && state !== 'idle',
      }
    },
  },
  roomHistory: {
    method: 'POST',
    route: '/v1/roomMessages',
    kind: 'read',
    input: roomPageInput,
    body: ({ profile, roomId, page }) => ({
      profile,
      chat_id: roomId,
      // Every kind of event and all of time, as the snapshot gives them (recorded 2026-09-19: `""` for both).
      query: { page, page_size: HISTORY_PAGE_SIZE, message_type: '', since: '' },
    }),
    output: (raw) => {
      const { page } = RoomHistorySchema.parse(raw)
      const { items, unreadable } = readEach(RoomMessageSchema, page.messages)
      return {
        messages: items.map(toRoomMessage),
        unreadable,
        // What the daemon said, and nothing more: a missing `has_more` is not "there is nothing older".
        hasMore: page.has_more ?? null,
        totalPages: page.total_pages ?? null,
      }
    },
  },
  roomPlan: {
    method: 'POST',
    route: '/v1/getRoomPlan',
    kind: 'read',
    input: roomInput,
    body: roomBody,
    output: (raw) => {
      const { plan } = RoomPlanSchema.parse(raw)
      return {
        source: plan.source,
        cache: plan.cache,
        refreshFailed: Boolean(plan.last_error || plan.watch_error),
        updated_at: plan.updated_at,
        doc_rev: plan.doc_rev,
      }
    },
  },
  roomFiles: {
    method: 'POST',
    route: '/v1/roomFileList',
    kind: 'read',
    input: (raw) => {
      const { cursor } = record(raw)
      if (cursor !== undefined && (typeof cursor !== 'string' || cursor === '' || cursor.length > 512)) {
        throw new OperationInputError('Unknown page')
      }
      return { ...roomInput(raw), ...(cursor === undefined ? {} : { cursor }) }
    },
    body: ({ profile, roomId, cursor }) => ({ profile, chat_id: roomId, ...(cursor === undefined ? {} : { cursor }) }),
    output: (raw) => RoomFilesSchema.parse(raw).page,
  },
  // A room's work (recorded 2026-09-19 with an agent working in it): its agents' private task lanes, and its shared board.
  roomWork: {
    method: 'POST',
    route: '/v1/roomWorkLanes',
    kind: 'read',
    input: roomInput,
    body: roomBody,
    output: (raw) => RoomWorkLanesSchema.parse(raw).lanes.map(toWorkLane),
  },
  roomBoard: {
    method: 'POST',
    route: '/v1/getRoomBoard',
    kind: 'read',
    input: roomInput,
    body: roomBody,
    output: (raw) => readEach(BoardTaskSchema, RoomBoardSchema.parse(raw).board.tasks).items,
  },
  workSnapshot: {
    method: 'POST',
    route: '/v1/roomWorkSnapshot',
    kind: 'read',
    input: withProfile,
    body: (input) => input,
    output: (raw) => {
      const { snapshot } = WorkSnapshotSchema.parse(raw)
      const rooms = snapshot.lanes
        .filter((room) => ROOM_ID.test(room.room))
        .map((room) => ({ roomId: room.room, lanes: room.lanes.map(toWorkLane) }))
      return {
        boards: snapshot.boards.length,
        lanes: snapshot.lanes.reduce((sum, room) => sum + room.lanes.length, 0),
        rooms,
      }
    },
  },
  // A local agent's sessions (POST {target}): which rooms it works in, and whether its runtime there is live.
  agentSessions: {
    method: 'POST',
    route: '/v1/listSessions',
    kind: 'read',
    input: agentTarget,
    body: ({ profile, scope, handle }) => ({ target: { profile, scope, handle } }),
    output: (raw) => readEach(AgentSessionSchema, AgentSessionsSchema.parse(raw).sessions).items,
  },
  // One agent in full (POST {target}), for its details: who it is, and how each of its sessions' runtimes is set up.
  agentStatus: {
    method: 'POST',
    route: '/v1/status',
    kind: 'read',
    input: agentTarget,
    body: ({ profile, scope, handle }) => ({ target: { profile, scope, handle } }),
    output: (raw) => toAgentStatus(AgentStatusSchema.parse(raw)),
  },
  // The defaults a new Jam-owned agent starts with (POST {}), for Settings' Runtime page.
  runtimeDefaults: {
    method: 'POST',
    route: '/v1/runtimeDefaults',
    kind: 'read',
    input: none,
    output: (raw) => RuntimeDefaultsSchema.parse(raw).defaults,
  },
  // The agent Home preselects (POST {profile}), or null when the account has set none.
  defaultAgent: {
    method: 'POST',
    route: '/v1/defaultAgent',
    kind: 'read',
    input: withProfile,
    body: (input) => input,
    output: (raw) => ({ peer: DefaultAgentSchema.parse(raw).peer }),
  },
  // What deleting one of a room's files would affect, and the token the delete must carry (POST {profile, id}).
  fileDeletePreview: {
    method: 'POST',
    route: '/v1/artifactDeletePreview',
    kind: 'read',
    input: fileInput,
    body: (input) => input,
    output: (raw) => {
      const { preview } = DeletePreviewSchema.parse(raw)
      return { impactToken: preview.impact_token, plans: preview.affected_plan_chat_ids.length }
    },
  },
  // Every host session on this computer (GET), for Sessions: a row per peer, each carrying its own sessions.
  hostPeers: {
    method: 'GET',
    route: '/v1/list',
    kind: 'read',
    input: none,
    output: (raw) => toHostPeers(HostPeersSchema.parse(raw).peers),
  },
  // Writes. Each is one action the person takes, and each was exercised live only in one room set aside for it.
  // Changes: posts one message, as the person, in a room they are in; it wakes the participants it mentions. Answering
  // an agent's question is such a message ("Answer <code>: <answer>", the agent's own instruction).
  roomSend: {
    method: 'POST',
    route: '/v1/roomSend',
    kind: 'write',
    input: messageInput,
    body: ({ profile, roomId, content, mentions, attachmentIds }) => ({
      profile,
      chat_id: roomId,
      content,
      mentions,
      ...(attachmentIds === undefined ? {} : { attachment_ids: attachmentIds }),
    }),
    output: (raw) => ({ id: RoomSendAnswerSchema.parse(raw).id ?? null }),
  },
  // Changes: answers one runtime permission request: allow it once, deny it once, or deny its kind from that agent
  // always (a standing refusal the person removes in the agent's details). Never allow_always: Jam grants nothing lasting.
  decidePermission: {
    method: 'POST',
    route: '/v1/decideRuntimePermission',
    kind: 'write',
    input: decisionInput,
    body: ({ profile, scope, handle, requestId, outcome }) => ({
      target: { profile, scope, handle },
      id: requestId,
      outcome,
    }),
    output: (raw) => {
      DecisionAnswerSchema.parse(raw)
      return { decided: true }
    },
  },
  // Changes: opens a NEW room, creates a task in it and posts the person's instruction to the chosen agent, which
  // starts that agent working (user guide, "Assign work": "Each Home assignment creates a separate room"). It is the
  // one operation in this app that makes a room by itself.
  kickoffWork: {
    method: 'POST',
    route: '/v1/kickoffWork',
    kind: 'write',
    input: kickoffInput,
    body: ({ profile, scope, handle, message, attachmentIds }) => ({
      profile,
      agent: { profile, scope, handle },
      message,
      ...(attachmentIds === undefined ? {} : { artifact_ids: attachmentIds }),
    }),
    output: (raw) => KickoffSchema.parse(raw).outcome,
  },
  // Changes: stores one file's bytes in the artifact store - bound to a room, which uploads it to Band when Band
  // provides file transfer, or unbound for a later assignment (user guide, "Use attachments"). The id it answers
  // is what a message or an assignment then attaches; everything else in the answer, its local path above all,
  // stays in this process.
  fileStore: {
    method: 'POST',
    route: '/v1/artifactStore',
    kind: 'write',
    input: fileStoreInput,
    body: ({ profile, roomId, name, mime, content }) => ({
      profile,
      chat_id: roomId,
      source: { kind: 'bytes', value: content },
      name,
      created_by: '',
      mime,
    }),
    output: (raw) => ({ id: ArtifactStoreSchema.parse(raw).artifact.id }),
    timeoutMs: FILE_STORE_TIMEOUT_MS,
    rejection: 'The daemon did not store the file',
  },
  // Changes: writes a copy of one of a room's files into the person's Downloads folder. The room's own copy stays.
  fileSaveCopy: {
    method: 'POST',
    route: '/v1/artifactSaveCopy',
    kind: 'write',
    input: fileInput,
    body: (input) => input,
    output: () => ({ saved: true as const }),
  },
  // Changes: deletes this computer's copy of one of a room's files, and the file itself once no room still refers to
  // it. The token comes from fileDeletePreview, so a file a room takes its plan from cannot be deleted unknowingly.
  fileDelete: {
    method: 'POST',
    route: '/v1/artifactDelete',
    kind: 'write',
    input: (raw) => {
      const { impactToken } = record(raw)
      if (typeof impactToken !== 'string' || impactToken === '') throw new OperationInputError('Unknown file')
      return { ...fileInput(raw), impactToken }
    },
    body: ({ profile, id, impactToken }) => ({ profile, id, impact_token: impactToken }),
    output: () => ({ deleted: true as const }),
  },
  // Changes: interrupts the turn one agent is working on in one room. Its runtime keeps running and its other rooms
  // are untouched; Jam's own Stop, from the working strip (user guide, "Interrupt a turn").
  interruptTurn: {
    method: 'POST',
    route: '/v1/interruptRuntimeTurn',
    kind: 'write',
    input: interruptInput,
    body: ({ profile, scope, handle, hostSession }) => ({
      target: { profile, scope, handle },
      host_session: hostSession,
    }),
    output: () => ({ interrupted: true as const }),
  },
  // Changes: marks one mention of the person's inbox read and done, which is how Jam's own X dismisses it. Only a
  // routine mention: a question or a permission request leaves the inbox when it is answered or decided, never this way.
  dismissMention: {
    method: 'POST',
    route: '/v1/setInboxItemState',
    kind: 'write',
    input: (raw) => {
      const { itemId } = record(raw)
      if (typeof itemId !== 'string' || !ARTIFACT_ID.test(itemId)) throw new OperationInputError('Unknown item')
      return { profile: profileOf(raw), itemId }
    },
    body: ({ profile, itemId }) => ({ profile, item_id: itemId, read: true, done: true }),
    output: () => ({ dismissed: true as const }),
  },
  // Every permission one agent's session has asked for on this computer, decided or still waiting: Jam's own
  // Permissions tab. The command each request would run stays out of what the page gets (RuntimePermissionSchema).
  runtimePermissions: {
    method: 'POST',
    route: '/v1/runtimePermissions',
    kind: 'read',
    input: interruptInput,
    body: ({ profile, scope, handle, hostSession }) => ({
      target: { profile, scope, handle },
      host_session: hostSession,
    }),
    output: (raw) => readEach(RuntimePermissionSchema, RuntimePermissionsSchema.parse(raw).permissions).items,
  },
  // Band's own directory, which is what Jam's "Add participants" picker searches. It reads; it adds nobody.
  searchDirectory: {
    method: 'POST',
    route: '/v1/searchDirectory',
    kind: 'read',
    input: (raw) => {
      const { kind, q } = record(raw)
      // The daemon refuses anything but these two with "Invalid value for enum", so they never leave here.
      if (typeof kind !== 'string' || !DIRECTORY_KINDS.includes(kind as DirectoryKind)) {
        throw new OperationInputError('Unknown kind of identity')
      }
      if (typeof q !== 'string' || q.length > DIRECTORY_QUERY_MAX) throw new OperationInputError('Unknown search')
      return { profile: profileOf(raw), kind: kind as DirectoryKind, q }
    },
    body: (input) => input,
    output: (raw) => {
      const answer = DirectorySchema.parse(raw)
      return { entries: readEach(DirectoryEntrySchema, answer.entries).items, truncated: answer.truncated === true }
    },
  },
  // Changes: writes the WHOLE room organisation - folders, which room is in which, the pinned ones, the folded
  // folders and the archived ones - in one call. The official Jam app shares this organisation, so what is sent here
  // is the organisation this app last read with one thing changed in it, never a copy built from scratch: anything
  // the answer carried that this app does not read is still in the object and goes back untouched.
  setRoomOrg: {
    method: 'POST',
    route: '/v1/setRoomOrg',
    kind: 'write',
    input: (raw) => {
      const { org } = record(raw)
      const profile = profileOf(raw)
      const members = record(org)
      const lists = ['folders', 'pinned', 'collapsed'] as const
      const maps = ['assignments', 'archived'] as const
      // The five members the daemon requires, each of the kind its own read answers. A missing or wrong-kinded member
      // would be written over the whole organisation, so it never leaves here.
      for (const key of lists) {
        if (!Array.isArray(members[key])) throw new OperationInputError('The room organisation is not readable')
      }
      for (const key of maps) {
        const value = members[key]
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new OperationInputError('The room organisation is not readable')
        }
      }
      // The five members have just been checked one by one, and every other key of the answer is carried along.
      return { profile, org: members as RoomOrg }
    },
    body: ({ profile, org }) => ({ profile, org }),
    output: () => ({ set: true as const }),
  },
  // Changes: opens an empty room on the account, titled "New Session" until it is renamed. It takes nothing but the
  // profile: the title is set afterwards, with renameRoom.
  createRoom: {
    method: 'POST',
    route: '/v1/createRoom',
    kind: 'write',
    input: withProfile,
    body: (input) => input,
    output: (raw) => ChatSchema.parse(raw).chat,
  },
  // Changes: renames a room for everyone in it. Band allows only the room's owner, and answers 403 to anyone else.
  renameRoom: {
    method: 'POST',
    route: '/v1/renameRoom',
    kind: 'write',
    input: titleInput,
    body: ({ profile, roomId, title }) => ({ profile, chat_id: roomId, title }),
    output: (raw) => ChatSchema.parse(raw).chat,
  },
  // Changes: deletes the room on Band, for everyone in it. Owner only, and it cannot be undone.
  deleteRoom: {
    method: 'POST',
    route: '/v1/deleteRoom',
    kind: 'write',
    input: roomInput,
    body: ({ profile, roomId }) => ({ profile, chat_id: roomId }),
    output: () => ({ deleted: true as const }),
  },
  // Changes: adds one person or agent to a room, which lets them read it and be mentioned in it.
  addRoomParticipant: {
    method: 'POST',
    route: '/v1/addRoomParticipant',
    kind: 'write',
    input: participantInput,
    body: ({ profile, roomId, participantId }) => ({ profile, chat_id: roomId, participant_id: participantId }),
    output: () => ({ added: true as const }),
  },
  // Changes: removes one participant from a room. Never yourself and never its owner: Band refuses both.
  removeRoomParticipant: {
    method: 'POST',
    route: '/v1/removeRoomParticipant',
    kind: 'write',
    input: participantInput,
    body: ({ profile, roomId, participantId }) => ({ profile, chat_id: roomId, participant_id: participantId }),
    output: () => ({ removed: true as const }),
  },
  // Changes: sets this installation's notification categories. The daemon takes the whole set at once, so what is
  // sent is the answer just read with one switch moved; nothing else in it can drift.
  setNotifications: {
    method: 'POST',
    route: '/v1/setNotificationPreferences',
    kind: 'write',
    input: (raw) => {
      const { direct_mentions, human_requests, task_updates, version } = record(raw)
      if (typeof direct_mentions !== 'boolean' || typeof human_requests !== 'boolean') {
        throw new OperationInputError('A notification setting is on or off')
      }
      if (typeof task_updates !== 'string' || task_updates === '' || task_updates.length > 64) {
        throw new OperationInputError('Unknown task updates setting')
      }
      if (version !== undefined && typeof version !== 'number') throw new OperationInputError('Unknown version')
      return { direct_mentions, human_requests, task_updates, ...(version === undefined ? {} : { version }) }
    },
    body: (preferences) => ({ preferences }),
    output: () => ({ set: true as const }),
  },
  // Changes: sets the account's preselected agent, which Home offers first for later assignments. It starts nothing.
  setDefaultAgent: {
    method: 'POST',
    route: '/v1/setDefaultAgent',
    kind: 'write',
    input: peerInput,
    body: ({ profile, peer }) => ({ profile, peer }),
    output: () => ({ set: true as const }),
  },
  // Changes: makes a team on the account from the agents it names. It starts nothing and changes no agent.
  createTeam: {
    method: 'POST',
    route: '/v1/createTeam',
    kind: 'write',
    input: (raw) => ({ profile: profileOf(raw), draft: teamDraftOf(raw) }),
    body: ({ profile, draft }) => ({ profile, draft: draftBody(draft) }),
    output: (raw) => TeamAnswerSchema.parse(raw).team,
  },
  // Changes: saves a team's name, description, guidelines and agents, all at once, as Edit team does. It changes no agent.
  updateTeam: {
    method: 'POST',
    route: '/v1/updateTeam',
    kind: 'write',
    input: (raw) => {
      const { teamId } = record(raw)
      if (typeof teamId !== 'string' || !BAND_ID.test(teamId)) throw new OperationInputError('Unknown team')
      return { profile: profileOf(raw), teamId, draft: teamDraftOf(raw) }
    },
    body: ({ profile, teamId, draft }) => ({ profile, team_id: teamId, draft: draftBody(draft) }),
    output: (raw) => TeamAnswerSchema.parse(raw).team,
  },
}

// A forbidden route can never enter the table: loading this module fails first.
for (const spec of Object.values(OPERATIONS)) assertRouteAllowed(spec.route)
