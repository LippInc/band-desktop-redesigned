import { z } from 'zod'

/**
 * The Jam daemon's answers, as this app reads them. Every shape here was recorded from a real answer of jamd 0.4.10
 * (wire 24): the account's on 2026-09-18, a room's on 2026-09-19 from a room made for recording them (docs/jam/routes.md);
 * none is guessed. Band Desktop 0.4.14 (wire 30) was read again on 2026-10-10: every read here kept its shape, and the
 * fields it added (an avatar URL, a participant's description) are ones no screen uses yet.
 *
 * Everything the daemon returns is untrusted: these schemas run in the main process before anything reaches the page.
 * In every recorded shape, unknown fields are dropped and everything a screen can live without is optional, so a newer
 * or older daemon degrades the screen that needs the missing part instead of breaking the app.
 *
 * `z.unknown()` marks two kinds of part (30 in all, counted by daemon.test.ts). Seventeen are lists read item by item with
 * their own schema (readEach), so one item in a changed format is left out and counted instead of breaking the list: a
 * room's messages (its snapshot and its pages alike), a lane's tasks, a room board's tasks, the agent list's rows, an agent's sessions in its list and again in its status, this computer's host peers
 * and each peer's own sessions, the people Sonar has discovered and the agents each of them advertises, the inbox's
 * pending permissions, open questions and direct mentions, Band's directory entries, an agent's own permission records, and the account's teams. The other thirteen are only counted or pass through as they
 * came, and the page shows their values only as text: a message's attachments, a shared task's assignments and the work
 * snapshot's board tasks (its boards are counted); the room organisation's folders,
 * assignments, pins, folds and archive; a discovered person's teams; contacts and the received and sent requests; and the dashboard's
 * tool call latency, which no screen reads.
 */

/** The wire protocol version this app was built and checked against. A different running version is shown to the person. */
export const BUILT_AGAINST = { daemonVersion: '0.4.14', wire: 30 } as const

const text = z.string().max(10_000)
const shortText = z.string().max(500)
const count = z.number().finite()

/**
 * GET /v1/ping. The daemon's executable path is left out on purpose: the page never needs a path from this machine. Only
 * the version makes an endpoint Jam's daemon: every other part may be missing, null (the daemon writes null for values it
 * does not have yet, as `upgrade_hint` was on 2026-09-18) or malformed, and then only counts as not stated, so a ping
 * never hides a running daemon over a detail. A missing wire version counts as a different protocol.
 */
export const DaemonInfoSchema = z.object({
  version: shortText,
  wire: count.nullish().catch(null),
  update: z
    .object({
      current: shortText.nullish(),
      latest: shortText.nullish(),
      state: shortText.nullish(),
      channel: shortText.nullish(),
    })
    .nullish()
    .catch(null),
})
export type DaemonInfo = z.infer<typeof DaemonInfoSchema>

/** GET /v1/accounts */
export const AccountSchema = z.object({
  profile: shortText,
  signed_in: z.boolean(),
  base_url: shortText.optional(),
  auth_state: shortText.optional(),
  identity: z
    .object({
      user_id: shortText.optional(),
      email: shortText.optional(),
      first_name: shortText.optional(),
      last_name: shortText.optional(),
      handle: shortText.optional(),
    })
    .optional(),
})
export type Account = z.infer<typeof AccountSchema>
export const AccountsSchema = z.object({ accounts: z.array(AccountSchema) })

/** GET /v1/listExperiments */
export const ExperimentSchema = z.object({
  key: shortText,
  title: shortText,
  description: text.optional(),
  visibility: shortText.optional(),
  state: shortText,
})
export type Experiment = z.infer<typeof ExperimentSchema>
export const ExperimentsSchema = z.object({
  snapshot: z.object({ revision: count.optional(), experiments: z.array(ExperimentSchema) }),
})
export interface Experiments {
  revision: number | null
  experiments: Experiment[]
}

/** The experiment keys that show or hide a sidebar section, as the official app does (user guide, "Experiments"). */
export const SECTION_EXPERIMENTS = { inbox: 'inbox-section', sessions: 'sessions-section' } as const
export const isEnabled = (experiments: Experiments | null, key: string): boolean =>
  experiments?.experiments.some((experiment) => experiment.key === key && experiment.state === 'enabled') ?? false

/**
 * A room's id. Band checks it as a UUID ("Invalid format. Expected :uuid", /v1/roomLocality, 2026-09-19), so an id that
 * is not one never reaches the daemon.
 */
export const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /v1/rooms {profile}: the rooms the person's account is in (Jam's "My rooms"). A new room is titled "New Session"
 * until it is renamed, and `last_message_at` is null until its first message.
 */
export const RoomSchema = z.object({
  id: shortText,
  title: shortText,
  task_id: shortText.optional(),
  updated_at: shortText.optional(),
  last_message_at: shortText.nullish(),
})
export type Room = z.infer<typeof RoomSchema>
export const RoomsSchema = z.object({ rooms: z.array(RoomSchema) })

/** What POST /v1/createRoom and /v1/renameRoom answer: the room itself (recorded 2026-09-19). */
export const ChatSchema = z.object({ chat: RoomSchema })

/**
 * POST /v1/roomParticipants {profile, chat_id}. Recorded with the room's owner only (kind "User", role "owner", status
 * "active"); an agent's card is not recorded yet, so every field but the id is optional. The avatar address is left out:
 * the page shows initials (docs/DESIGN.md, "Room").
 */
export const ParticipantSchema = z.object({
  id: shortText,
  handle: shortText.nullish(),
  name: shortText.nullish(),
  kind: shortText.optional(),
  role: shortText.optional(),
  status: shortText.optional(),
})
export type Participant = z.infer<typeof ParticipantSchema>
export const ParticipantsSchema = z.object({ participants: z.array(ParticipantSchema) })

/** POST /v1/roomSend's answer (recorded 2026-09-19 from a room made for recording): the new message's id. */
export const RoomSendAnswerSchema = z.object({ id: shortText.nullish() })

/**
 * POST /v1/artifactStore's answer (recorded 2026-09-22 from one real store): the stored artifact, wrapped as
 * `artifactGet` wraps one. **Only the id is kept.** The rest of what the daemon answers - its local path above all -
 * never crosses to the page; a test feeds a full artifact with a path in it and requires this to drop it.
 */
export const ArtifactStoreSchema = z.object({
  artifact: z.object({ id: shortText }),
})

/** A message's text longer than this is cut, and the page says so. */
export const MESSAGE_MAX_CHARS = 100_000

/**
 * One message of a room, as the daemon lists them (recorded 2026-09-19 in a room with one agent working in it):
 * `message_type` "text" (a person's or an agent's words, Markdown, a mention written `@[[participant id]]` with the name
 * in `mention_names`), "tool_call" and "tool_result" (an agent's tool use, JSON), "task" (its turn's lifecycle: "ready",
 * {"event": "turn_started"}, {"event": "turn_complete", "outcome": ...}) and "participant" (a system event such as
 * `participant_added`). The room's id and the connectivity fields are left out; attachments are only counted.
 */
export const RoomMessageSchema = z.object({
  id: shortText,
  content: z.string(),
  message_type: shortText,
  sender_id: shortText.nullish(),
  sender_name: shortText.nullish(),
  sender_type: shortText.nullish(),
  inserted_at: shortText,
  mention_names: z.record(shortText, shortText).nullish().catch(null),
  tool_name: shortText.nullish(),
  system_event: shortText.nullish(),
  attachments: z.array(z.unknown()).nullish().catch(null),
})
export interface RoomMessage {
  id: string
  message_type: string
  content: string
  /** The text was longer than MESSAGE_MAX_CHARS and is cut there. */
  cut: boolean
  sender_id: string | null
  sender_name: string | null
  sender_type: string | null
  inserted_at: string
  mention_names: Record<string, string>
  tool_name: string | null
  system_event: string | null
  attachments: number
}

/** A daemon message as the page gets it: the text cut to MESSAGE_MAX_CHARS, missing parts as null. */
export function toRoomMessage(message: z.infer<typeof RoomMessageSchema>): RoomMessage {
  const cut = message.content.length > MESSAGE_MAX_CHARS
  return {
    id: message.id,
    message_type: message.message_type,
    content: cut ? message.content.slice(0, MESSAGE_MAX_CHARS) : message.content,
    cut,
    sender_id: message.sender_id ?? null,
    sender_name: message.sender_name ?? null,
    sender_type: message.sender_type ?? null,
    inserted_at: message.inserted_at,
    mention_names: message.mention_names ?? {},
    tool_name: message.tool_name ?? null,
    system_event: message.system_event ?? null,
    attachments: message.attachments?.length ?? 0,
  }
}

/**
 * Validates each item of a list on its own: an item whose format changed is left out and counted, so one odd message
 * or task degrades that item and never the whole list.
 */
export function readEach<S extends z.ZodType>(
  schema: S,
  items: unknown[],
): { items: z.infer<S>[]; unreadable: number } {
  const read: z.infer<S>[] = []
  for (const item of items) {
    const parsed = schema.safeParse(item)
    if (parsed.success) read.push(parsed.data)
  }
  return { items: read, unreadable: items.length - read.length }
}

/**
 * POST /v1/roomMessageSnapshot {profile, chat_id}: the room's messages as the daemon holds them, oldest first, with
 * `has_more` when Band has older ones (recorded 2026-09-19: the same messages, in the same format, as the paged
 * /v1/roomMessages). `recovery` is not idle while the daemon is still loading the room's history from Band.
 */
export const RoomMessagesSchema = z.object({
  snapshot: z.object({
    messages: z.array(z.unknown()),
    has_more: z.boolean().optional(),
    recovery: z.object({ state: shortText }).optional(),
  }),
})
export interface RoomMessages {
  messages: RoomMessage[]
  /** Messages the daemon listed in a format this app cannot read (left out). */
  unreadable: number
  hasMore: boolean
  /** The daemon is still loading the room's history from Band (its recovery is not idle). */
  loading: boolean
}

/**
 * POST /v1/roomMessages {profile, chat_id, query: {page, page_size, message_type, since}}: the same messages as the
 * snapshot, a page at a time, so a conversation longer than the snapshot can be read whole. Recorded 2026-09-19 from a
 * room of 80 messages: **page 1 is the newest page** (its 50 ran to the last message in the room), `total_pages` 2 and
 * `has_more` true, so paging forward walks backwards in time; within a page the messages are oldest first, as in the
 * snapshot.
 */
export const HISTORY_PAGE_SIZE = 50
/**
 * The most pages a conversation is read in, so a page that never says it is the last cannot be asked for for ever.
 * At the size above that is 2,000 messages: enough to reach the beginning of any room seen so far, and little enough
 * to hold and to draw at once. A conversation cut short by it says so rather than passing as whole.
 */
export const HISTORY_MAX_PAGES = 40

export const RoomHistorySchema = z.object({
  page: z.object({
    messages: z.array(z.unknown()),
    has_more: z.boolean().optional(),
    total_pages: z.number().int().nonnegative().optional(),
  }),
})
export interface RoomHistoryPage {
  /** This page's messages, oldest first. */
  messages: RoomMessage[]
  /** Messages the daemon listed in a format this app cannot read (left out). */
  unreadable: number
  /** Older messages are behind this page; null when the daemon did not say, which is not the same as none. */
  hasMore: boolean | null
  /** How many pages the daemon says the conversation has, when it says. */
  totalPages: number | null
}

/** A plan's text is shown in full; one larger than this is refused as a changed answer. */
export const PLAN_MAX_CHARS = 1_000_000

/**
 * POST /v1/getRoomPlan {chat_id}: the room's one plan (source null and cache null without one). The source's file paths
 * (`raw`, `canonical`) are left out: the page never needs a path from this machine. The diagram overlay is left out
 * until a diagram is recorded.
 */
export const RoomPlanSchema = z.object({
  plan: z.object({
    source: z
      .object({ label: shortText.optional(), kind: shortText.optional(), snapshot: z.boolean().optional() })
      .nullable(),
    cache: z
      .object({
        body: z.string().max(PLAN_MAX_CHARS),
        content_type: shortText.optional(),
        fetched_at: count.optional(),
        bytes: count.optional(),
      })
      .nullable(),
    last_error: text.optional(),
    watch_error: text.optional(),
    updated_at: count.optional(),
    /** The plan document's own revision: it moves when the plan's text does, which `updated_at` need not. */
    doc_rev: count.optional(),
  }),
})
type PlanAnswer = z.infer<typeof RoomPlanSchema>['plan']
/**
 * What the page gets of a plan: its source's label and kind, its text, and whether the last refresh of its file failed.
 * The error itself stays in the main process: it can name the file's path on this machine.
 */
export interface RoomPlan {
  source: PlanAnswer['source']
  cache: PlanAnswer['cache']
  refreshFailed: boolean
  updated_at?: number
  doc_rev?: number
}

/**
 * POST /v1/roomFileList {profile, chat_id}: the room's file catalogue. `status` is "local_complete" (recorded) or
 * "local_partial" (the user guide: Band unavailable, only this machine's files). Each file's path on this machine and
 * its uploader's id are left out.
 */
export const RoomFileSchema = z.object({
  id: shortText,
  name: shortText,
  mime: shortText.optional(),
  bytes: count.optional(),
  sha256: shortText.optional(),
  uploader_type: shortText.optional(),
  uploader_name: shortText.nullish(),
  created_at: count.optional(),
  local_only: z.boolean().optional(),
})
export type RoomFile = z.infer<typeof RoomFileSchema>
export const RoomFilesSchema = z.object({
  page: z.object({
    files: z.array(RoomFileSchema),
    has_more: z.boolean().optional(),
    /**
     * What the next page is asked for with; null on the last one. Only null has ever been recorded, so anything else
     * counts as no cursor rather than taking the whole tab down: without one the panel says there is more and offers
     * nothing to press, which is the honest state.
     */
    next_cursor: shortText.nullish().catch(null),
    status: shortText.optional(),
  }),
})
export type RoomFiles = z.infer<typeof RoomFilesSchema>['page']

/**
 * What deleting one of a room's files would affect (POST /v1/artifactDeletePreview, recorded 2026-09-21): the rooms
 * whose plan that file is the source of, and the token the delete must carry to go ahead anyway. The room ids are
 * counted rather than passed on: the page shows how many plans would stop following their file, not which.
 */
export const DeletePreviewSchema = z.object({
  preview: z.object({
    impact_token: shortText,
    affected_plan_chat_ids: z.array(shortText).catch([]),
  }),
})
export interface DeletePreview {
  /** The token /v1/artifactDelete must carry for this file. */
  impactToken: string
  /** How many rooms take their plan from this file. */
  plans: number
}

/**
 * One task in an agent's private lane (POST /v1/roomWorkLanes, recorded 2026-09-19): `status` "pending", "in_progress"
 * or "completed" (a tombstone has `deleted_at`), the present-tense `active_form` Jam shows under the subject, and the
 * ids it blocks or is blocked by. Times are milliseconds; 0 means not yet.
 */
export const LaneTaskSchema = z.object({
  id: shortText,
  subject: text,
  status: shortText,
  active_form: text.nullish(),
  detail: text.nullish(),
  first_seen_at: count.optional(),
  status_changed_at: count.optional(),
  started_at: count.optional(),
  completed_at: count.optional(),
  blocks: z.array(shortText).optional().catch([]),
  blocked_by: z.array(shortText).optional().catch([]),
  deleted_at: count.nullish(),
})
export type LaneTask = z.infer<typeof LaneTaskSchema>
/** An agent's lane: `peer_id` is the local agent's key (`<profile>/<scope>`, as agent-list's `local.peer_key`). */
export const WorkLaneSchema = z.object({
  peer_id: shortText,
  active: z.boolean().optional(),
  items: z.array(z.unknown()),
})
export interface WorkLane {
  peer_id: string
  active: boolean
  tasks: LaneTask[]
}
export const RoomWorkLanesSchema = z.object({ lanes: z.array(WorkLaneSchema) })

/** A lane as the page gets it: its tasks read one by one, tombstones left out. */
export function toWorkLane(lane: z.infer<typeof WorkLaneSchema>): WorkLane {
  const tasks = readEach(LaneTaskSchema, lane.items).items.filter(
    (task) => !task.deleted_at && task.status !== 'deleted',
  )
  return { peer_id: lane.peer_id, active: lane.active ?? false, tasks }
}

/**
 * One shared task on a room's board (POST /v1/getRoomBoard, recorded 2026-09-19): `uid` "#1", `overall` "pending",
 * "in_progress" or "completed", and who created it. Assignments are only counted until one is recorded.
 */
export const BoardTaskSchema = z.object({
  uid: shortText,
  subject: text,
  detail: text.nullish(),
  overall: shortText,
  assignments: z.array(z.unknown()).optional().catch([]),
  created_by: z
    .object({ kind: shortText.nullish(), name: shortText.nullish(), handle: shortText.nullish() })
    .nullish()
    .catch(null),
  created_at: count.optional(),
  started_at: count.optional(),
  completed_at: count.optional(),
})
export type BoardTask = z.infer<typeof BoardTaskSchema>
export const RoomBoardSchema = z.object({ board: z.object({ tasks: z.array(z.unknown()) }) })

/**
 * POST /v1/roomWorkSnapshot {profile}: every room's shared boards and agent lanes at once (it takes no room: a `chat_id`
 * is ignored, 2026-09-19). Recorded with an agent at work: `boards` [{chat_id, tasks}], `lanes` [{room, lanes}]. Home's
 * Active work reads the agents' open tasks from it, by room.
 */
export const WorkSnapshotSchema = z.object({
  snapshot: z.object({
    boards: z.array(z.object({ chat_id: shortText, tasks: z.array(z.unknown()) }).catch({ chat_id: '', tasks: [] })),
    lanes: z.array(z.object({ room: shortText, lanes: z.array(WorkLaneSchema) }).catch({ room: '', lanes: [] })),
  }),
})
export interface WorkSummary {
  boards: number
  lanes: number
  /** Each room's agent lanes, for Home's Active work. */
  rooms: { roomId: string; lanes: WorkLane[] }[]
}

/** POST /v1/roomOrg {profile}: the room list's pins, folders and archive, shared with the official app. */
/**
 * POST /v1/roomOrg {profile}: how the rooms are organised - the folders, which room is in which, which are pinned,
 * which folders are folded shut, and which rooms are archived.
 *
 * Every member is kept EXACTLY as the daemon sent it, and the object keeps any key this app does not know, because
 * **the official Jam app shares this organisation** and /v1/setRoomOrg takes the whole of it at once: a narrowed copy
 * written back would quietly strip whatever Jam keeps here. What each member holds is read for display only
 * (`src/renderer/src/lib/room-org.ts`), and a change is applied to this object rather than to a copy of it.
 *
 * The member shapes: a folder is {id, name}, `assignments` maps a room id to a folder id, `pinned` holds room ids, `collapsed` holds
 * folder ids, and `archived` maps a room id to an **integer** (a boolean is refused). What that integer counts is not
 * known, so this app reads any number as "archived" and writes the second the room was archived.
 */
export const RoomOrgSchema = z.object({
  org: z.looseObject({
    folders: z.array(z.unknown()),
    assignments: z.record(z.string(), z.unknown()),
    pinned: z.array(z.unknown()),
    collapsed: z.array(z.unknown()),
    archived: z.record(z.string(), z.unknown()),
  }),
})
export type RoomOrg = z.infer<typeof RoomOrgSchema>['org']

/**
 * POST /v1/runtimePermissions {target, host_session} (recorded 2026-09-21 against a real agent, eight records): every
 * permission an agent's session has asked for on this computer, decided or still waiting. It is what Jam's own
 * Permissions tab on an agent reads.
 *
 * The request's own fields that name this machine - the command it would run and the metadata Jam keeps for the
 * provider - are left out here, the way a file's path is: the tab says what was asked and what was answered, and a
 * command line never reaches the page.
 */
export const RuntimePermissionSchema = z
  .object({
    request: z.object({
      id: shortText,
      chat_id: shortText.nullish(),
      action: shortText.nullish(),
      description: text.nullish(),
      created_at: count.nullish(),
      expires_at: count.nullish(),
      durable_rule: shortText.nullish(),
    }),
    status: shortText.nullish(),
    decision: z
      .object({ outcome: shortText.nullish(), decided_at: count.nullish(), reason: text.nullish() })
      .nullish()
      .catch(null),
    resolved_at: count.nullish(),
  })
  .transform((one) => ({
    id: one.request.id,
    roomId: one.request.chat_id ?? null,
    action: one.request.action ?? null,
    description: one.request.description ?? null,
    askedAt: one.request.created_at ?? null,
    expiresAt: one.request.expires_at ?? null,
    rule: one.request.durable_rule ?? null,
    status: one.status ?? null,
    outcome: one.decision?.outcome ?? null,
    decidedAt: one.decision?.decided_at ?? null,
    reason: one.decision?.reason ?? null,
  }))
export type RuntimePermission = z.infer<typeof RuntimePermissionSchema>

export const RuntimePermissionsSchema = z.object({ permissions: z.array(z.unknown()) })

/**
 * POST /v1/searchDirectory {profile, kind, q} (recorded 2026-09-21): Band's own directory, which is what Jam's
 * "Add participants" picker searches. `kind` is exactly `agent` or `user` - `person` and `people` are refused with
 * "Invalid value for enum" - and `truncated` says Band had more matches than it sent (it answered 50 and true for a
 * single letter).
 *
 * `online` is the identity's own state, not whether it can be added: every entry of a real reading was false, this
 * account's own agent included, so a picker that held back what is not online would hold back everything.
 */
export const DIRECTORY_KINDS = ['agent', 'user'] as const
export type DirectoryKind = (typeof DIRECTORY_KINDS)[number]

export const DirectoryEntrySchema = z.object({
  id: shortText,
  kind: shortText.nullish(),
  name: shortText.nullish(),
  handle: shortText.nullish(),
  description: text.nullish(),
  tags: z.array(shortText).nullish().catch(null),
  online: z.boolean().nullish(),
})
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>

export const DirectorySchema = z.object({
  entries: z.array(z.unknown()),
  truncated: z.boolean().nullish(),
})

/** A folder of the organisation, as much of it as this app reads. Unknown keys are kept. */
export const RoomFolderSchema = z.looseObject({ id: shortText, name: shortText })
export type RoomFolder = z.infer<typeof RoomFolderSchema>

/**
 * One agent of POST /v1/agent-list {profile} (recorded 2026-09-19 with one agent on the account): its Band id, name and handle, and
 * for an agent that runs on this computer its local key (`<profile>/<scope>`). The workspace path is left out.
 */
export const AgentRowSchema = z.object({
  id: shortText,
  name: shortText.nullish(),
  handle: shortText.nullish(),
  is_external: z.boolean().optional(),
  description: text.nullish(),
  local: z.object({ peer_key: shortText, host: shortText.nullish() }).nullish().catch(null),
})
export type AgentRow = z.infer<typeof AgentRowSchema>
export const AgentListSchema = z.object({
  list: z.object({
    rows: z.array(z.unknown()),
    remote: shortText.optional(),
    org_name: shortText.nullable().optional(),
  }),
})
export interface AgentList {
  rows: AgentRow[]
  remote?: string
  org_name?: string | null
}

/**
 * One team of POST /v1/listTeams {profile} (Band Desktop 0.4.14, recorded 2026-10-10 from a team made for recording it):
 * a group of the account's agents with a name, a description and shared guidelines, its agents named by their Band ids
 * (the agent list's `id`). `template_id` names the Library team it was added from, and is null for a team made by hand;
 * `role_ids` are that Library team's roles. No screen shows them, but an edit sends them back as they were, so saving a
 * Library team here never drops its roles.
 */
export const TeamSchema = z.object({
  id: shortText,
  name: shortText,
  description: text.nullish(),
  guidelines: text.nullish(),
  agent_ids: z.array(shortText).catch([]),
  role_ids: z.array(shortText).catch([]),
  template_id: shortText.nullish().catch(null),
  updated_at_ms: z.number().nullish().catch(null),
})
export type Team = z.infer<typeof TeamSchema>
export const TeamsSchema = z.object({ teams: z.array(z.unknown()) })
/** What POST /v1/createTeam and /v1/updateTeam answer: the team as Band saved it. */
export const TeamAnswerSchema = z.object({ team: TeamSchema })

/**
 * A team as the person writes it in New team or Edit team: the `draft` of createTeam and updateTeam (Band Desktop 0.4.14:
 * name, description, guidelines, the agents' ids and the team's roles; Band refuses a team with no agent). A team made
 * here has no roles; an edited one keeps its own.
 */
export interface TeamDraft {
  name: string
  description: string
  guidelines: string
  agentIds: string[]
  roleIds: string[]
}

/** A draft's longest text and most agents: the form stops at them and the main process refuses past them. */
export const TEAM_LIMITS = { name: 200, description: 2_000, guidelines: 10_000, agents: 50 } as const

/** POST /v1/defaultAgent {profile}: the agent Home preselects, as a local peer key, or null when none is set. */
export const DefaultAgentSchema = z.object({ peer: shortText.nullable().catch(null) })

/**
 * What POST /v1/kickoffWork answers (recorded 2026-09-21 from one assignment made in a room opened for testing): the
 * room it opened, the task it created there, the message it posted, how the instruction reached a session, any other
 * agents it brought in, and whether the session that took the work runs on another computer.
 *
 * `delivery` is the daemon's own word for the outcome ("bound" when a session took the room). Jam's three results read
 * from it (user guide, "Assign work"), and a word this app does not know degrades to Jam's neutral one rather than
 * being guessed at.
 */
export const KickoffSchema = z.object({
  outcome: z.object({
    chat_id: shortText,
    task_uid: shortText.nullish(),
    message_id: shortText.nullish(),
    delivery: shortText.nullish(),
    collaborator_agent_ids: z.array(shortText).catch([]),
    runs_elsewhere: z.boolean().optional(),
  }),
})
export type Kickoff = z.infer<typeof KickoffSchema>['outcome']

/**
 * One of a local agent's sessions (POST /v1/listSessions {target}, recorded 2026-09-19): the template's own ("default",
 * no room) and one per room it works in (`<template>-<room id>`), with whether its runtime is live. The runtime's
 * command, workspace and process ids are left out.
 */
export const AgentSessionSchema = z.object({
  id: shortText,
  room: shortText.nullish(),
  provider: shortText.nullish(),
  presence: shortText.nullish(),
  binding: shortText.nullish(),
  last_activity_at: count.nullish(),
})
export type AgentSession = z.infer<typeof AgentSessionSchema>
export const AgentSessionsSchema = z.object({ sessions: z.array(z.unknown()) })

/**
 * One agent in full (POST /v1/status {target}, recorded 2026-09-21): who it is, where it runs, and how its runtime is
 * set up. What the daemon also sends and this app deliberately drops: the peer's working directory, and the runtime's
 * whole `spawn` command, arguments, directory and environment allow-list. Those are paths and commands from this
 * machine, and a path the daemon gives never reaches the page (daemon.test.ts pins it).
 */
export const AgentRuntimeSchema = z.object({
  template_id: shortText.nullish(),
  mode: shortText.nullish(),
  transport: shortText.nullish(),
  spawn: z
    .object({
      runtime_version: shortText.nullish(),
      auth_mode: shortText.nullish(),
      sandbox: z
        .object({
          enabled: z.boolean().optional(),
          name: shortText.nullish(),
          github_access: shortText.nullish(),
          no_clone: z.boolean().optional(),
        })
        .nullish()
        .catch(null),
    })
    .nullish()
    .catch(null),
  claude_code: z
    .object({
      model: shortText.nullish(),
      reasoning_effort: shortText.nullish(),
      permission_mode: shortText.nullish(),
      context_mode: shortText.nullish(),
      strict_mcp_config: z.boolean().optional(),
      disallowed_tools: z.array(shortText).nullish().catch(null),
    })
    .nullish()
    .catch(null),
  thread: z
    .object({
      model: shortText.nullish(),
      reasoning_effort: shortText.nullish(),
      approval_policy: shortText.nullish(),
      sandbox_mode: shortText.nullish(),
      web_search: z.boolean().nullish(),
      compact_at_tokens: count.nullish(),
    })
    .nullish()
    .catch(null),
})
export type AgentRuntime = z.infer<typeof AgentRuntimeSchema>

export const AgentStatusSchema = z.object({
  status: z.object({
    peer: z.object({
      scope: shortText,
      profile: shortText.nullish(),
      agent_id: shortText.nullish(),
      agent_name: shortText.nullish(),
      handle: shortText.nullish(),
      host: shortText.nullish(),
      started_at: count.nullish(),
      identity_class: shortText.nullish(),
      host_sessions: z.array(z.unknown()),
    }),
    state: shortText.nullish(),
    running: z.boolean().nullish(),
    warning: shortText.nullish(),
  }),
})

export interface AgentStatus {
  scope: string
  profile: string | null
  agentId: string | null
  name: string | null
  handle: string | null
  host: string | null
  startedAt: number | null
  identityClass: string | null
  /** The daemon's own word for the peer ("connected"), and whether its host is running. */
  state: string | null
  running: boolean | null
  warning: string | null
  /** The runtime of each session this agent has here; a session in a changed shape is left out. */
  runtimes: { session: string; room: string | null; runtime: AgentRuntime }[]
  /** The runtime templates its sessions run, each once, which is what Jam's Runtime filter narrows by. */
  templates: string[]
}

/** An agent's status as the page gets it: its identity and each session's runtime, with no path or command in either. */
export function toAgentStatus(raw: z.infer<typeof AgentStatusSchema>): AgentStatus {
  const { peer, state, running, warning } = raw.status
  const sessions = readEach(
    z.object({ id: shortText, room: shortText.nullish(), runtime: AgentRuntimeSchema.nullish().catch(null) }),
    peer.host_sessions,
  ).items
  return {
    scope: peer.scope,
    profile: peer.profile ?? null,
    agentId: peer.agent_id ?? null,
    name: peer.agent_name ?? null,
    handle: peer.handle ?? null,
    host: peer.host ?? null,
    startedAt: peer.started_at ?? null,
    identityClass: peer.identity_class ?? null,
    state: state ?? null,
    running: running ?? null,
    warning: warning ?? null,
    runtimes: sessions.flatMap((session) =>
      session.runtime ? [{ session: session.id, room: session.room ?? null, runtime: session.runtime }] : [],
    ),
    templates: [
      ...new Set(sessions.flatMap((session) => (session.runtime?.template_id ? [session.runtime.template_id] : []))),
    ],
  }
}

/**
 * One session of a host peer (GET /v1/list, recorded 2026-09-20 from a running agent): the room it works in (empty for
 * the template that belongs to none), the host process behind it, and the daemon's own words for its process and its
 * binding. The runtime's command, workspace and model settings are left out: Sessions reports state, not setup.
 */
export const HostSessionSchema = z.object({
  id: shortText,
  room: shortText.nullish(),
  provider: shortText.nullish(),
  presence: shortText.nullish(),
  binding: shortText.nullish(),
  host_pid: count.nullish(),
})
export type HostSession = z.infer<typeof HostSessionSchema>

/**
 * One host peer of this computer (GET /v1/list, recorded 2026-09-20): the agent it runs, whether it is running, its
 * state with Band, and its own sessions - which is every row of Jam's Sessions table. This is not /v1/listSessions,
 * which answers for one agent named in its body and carries no peer.
 */
export const HostPeerRowSchema = z.object({
  peer: z.object({
    scope: shortText.nullish(),
    profile: shortText.nullish(),
    agent_id: shortText.nullish(),
    agent_name: shortText.nullish(),
    handle: shortText.nullish(),
    host: shortText.nullish(),
    // Required: this array IS the table's rows, so an answer that no longer carries it has changed shape rather
    // than holding a peer with nothing under it.
    host_sessions: z.array(z.unknown()),
  }),
  state: shortText.nullish(),
  running: z.boolean().nullish(),
  warning: shortText.nullish(),
})
export const HostPeersSchema = z.object({ peers: z.array(z.unknown()) })

export interface HostPeer {
  peer: {
    scope?: string | null
    profile?: string | null
    agent_id?: string | null
    agent_name?: string | null
    handle?: string | null
    host?: string | null
    host_sessions: HostSession[]
  }
  state?: string | null
  running?: boolean | null
  warning?: string | null
}

/** A host peer as the page gets it: its own sessions read one by one, so one in a changed format costs only its row. */
export function toHostPeer(row: z.infer<typeof HostPeerRowSchema>): HostPeer {
  const sessions = readEach(HostSessionSchema, row.peer.host_sessions).items
  return { ...row, peer: { ...row.peer, host_sessions: sessions } }
}

/**
 * Every host peer of an answer, each with its own sessions. A peer or a session in a format this app does not
 * know costs its own row, as the other lists read item by item do - but an answer of which NOTHING could be
 * read is a changed answer, not an empty one, and throwing here is what turns it into the screen's "changed"
 * state. Reading it as emptiness would have the table state that there are no sessions, which is the one
 * claim it must not make while it does not know.
 */
export function toHostPeers(peers: readonly unknown[]): HostPeer[] {
  const read = readEach(HostPeerRowSchema, [...peers])
  if (peers.length > 0 && read.items.length === 0) throw new Error('no host peer of this answer fits its shape')
  const offered = read.items.reduce((sum, row) => sum + row.peer.host_sessions.length, 0)
  const rows = read.items.map(toHostPeer)
  const kept = rows.reduce((sum, row) => sum + row.peer.host_sessions.length, 0)
  if (offered > 0 && kept === 0) throw new Error('no host session of this answer fits its shape')
  return rows
}

/** A local agent the daemon can be asked about: its account profile, its scope and its handle (agent-list). */
export interface AgentTarget {
  profile: string
  scope: string
  handle: string
}

/**
 * A runtime's permission request (recorded 2026-09-19 from an agent's Write): the full operation the provider
 * described, whether the provider cut it (then it cannot be allowed), its room, and its outcome once decided (`outcome`
 * "expired" when the provider gave up waiting). The provider's raw metadata is left out: `description` carries it.
 */
export const PermissionRecordSchema = z.object({
  request: z.object({
    id: shortText,
    session_id: shortText.nullish(),
    chat_id: shortText.nullish(),
    provider: shortText.nullish(),
    action: shortText.nullish(),
    description: text,
    display_truncated: z.boolean().optional(),
    created_at: count.optional(),
    expires_at: count.nullish(),
  }),
  status: shortText,
  decision: z.object({ outcome: shortText.nullish() }).nullish().catch(null),
})
export type PermissionRecord = z.infer<typeof PermissionRecordSchema>

/**
 * POST /v1/decideRuntimePermission's answer (recorded 2026-09-19 in a room with an agent, a Write denied once): the request's
 * record, resolved, with the decision's outcome.
 */
export const DecisionAnswerSchema = z.object({ permission: PermissionRecordSchema })

/**
 * A question an agent asked (the `inbox_snapshot` event, recorded 2026-09-19): its prompt and options, and the code an
 * answer carries ("Answer <code>: <answer>", the agent's own instruction in the room).
 */
export const AgentQuestionSchema = z.object({
  id: shortText,
  answer_code: shortText,
  prompt: text,
  options: z.array(shortText).optional().catch([]),
  multi_select: z.boolean().optional(),
})
export type AgentQuestion = z.infer<typeof AgentQuestionSchema>

/**
 * The person's own attention (the stream's `inbox_snapshot` event for `human/<profile>`: the daemon sends it when a
 * client connects and whenever it changes; no route answers it). Recorded 2026-09-19: `pending_permissions` [{peer_key,
 * record}], `open_questions_by_task` {"<peer key>\0<room id>:<task id>": [question]}, `accepted_question_replies`
 * [{room, answer_code, message_id}], and the direct mentions, read and done ids of the Inbox (counted here).
 */
export const InboxSnapshotSchema = z.object({
  pending_permissions: z
    .array(z.object({ peer_key: shortText, record: z.unknown() }).catch({ peer_key: '', record: null }))
    .optional(),
  open_questions_by_task: z.record(z.string().max(1000), z.array(z.unknown())).optional().catch({}),
  accepted_question_replies: z
    .array(
      z
        .object({ room: shortText, answer_code: shortText, message_id: shortText, accepted_at: count.optional() })
        .catch({ room: '', answer_code: '', message_id: '' }),
    )
    .optional(),
  direct_mentions: z.array(z.unknown()).optional().catch([]),
  /** Mentions the daemon could not keep: more are waiting than it holds, and older ones it did not retain. */
  attention_overflow_count: count.nullish().catch(0),
  attention_truncated_count: count.nullish().catch(0),
  /** The ids of the mentions the person has dismissed. */
  done_ids: z.array(shortText).nullish().catch([]),
})
/** One direct mention in the person's inbox: the message that carries it, and the room it was said in. */
export interface InboxMention {
  message: RoomMessage
  roomId: string
  /** The person has dismissed it (the daemon's done ids). */
  done: boolean
}
export interface Inbox {
  permissions: { peerKey: string; record: PermissionRecord }[]
  questions: { peerKey: string; roomId: string; question: AgentQuestion }[]
  answered: { roomId: string; answerCode: string; messageId: string }[]
  mentions: InboxMention[]
  /** Mentions the daemon sent in a form this app does not know, left out of the list above and counted here. */
  unreadable: number
  /** More mentions are waiting than the daemon holds (user guide: "additional mentions are queued"). */
  overflow: number
  /** Older mentions the daemon could not retain (user guide: "some older mentions were not retained"). */
  truncated: number
}

/**
 * The person's inbox as the page reads it: the latest one the stream sent, or `changed` when the latest did not fit its
 * schema (a newer or older Jam). Then the screens say that what waits cannot be shown, and never show an older inbox.
 */
export type InboxRead = { state: 'ready'; inbox: Inbox } | { state: 'changed' }

/** The NUL between a question key's peer and its room, built at run time: no control character sits in the source. */
const KEY_SEPARATOR = String.fromCharCode(0)

/** An inbox snapshot as the page gets it: every part read item by item, a question's room taken from its key. */
export function toInbox(snapshot: z.infer<typeof InboxSnapshotSchema>): Inbox {
  const permissions = (snapshot.pending_permissions ?? []).flatMap(({ peer_key, record }) => {
    const parsed = PermissionRecordSchema.safeParse(record)
    return parsed.success && peer_key ? [{ peerKey: peer_key, record: parsed.data }] : []
  })
  const questions = Object.entries(snapshot.open_questions_by_task ?? {}).flatMap(([key, items]) => {
    const [peerKey, rest = ''] = key.split(KEY_SEPARATOR)
    const roomId = rest.split(':')[0] ?? ''
    if (!peerKey || !ROOM_ID.test(roomId)) return []
    return readEach(AgentQuestionSchema, items).items.map((question) => ({ peerKey, roomId, question }))
  })
  const answered = (snapshot.accepted_question_replies ?? [])
    .filter((reply) => reply.room && reply.answer_code && reply.message_id)
    .map((reply) => ({ roomId: reply.room, answerCode: reply.answer_code, messageId: reply.message_id }))
  // A mention is the message that carries it, wrapped: the daemon sends the room's own message shape here.
  const done = new Set(snapshot.done_ids ?? [])
  // A mention carries its room, which a message inside a room never needs.
  const read = readEach(
    z.object({ message: RoomMessageSchema.extend({ chat_id: shortText }) }),
    snapshot.direct_mentions ?? [],
  )
  const mentions = read.items.map(({ message }) => ({
    message: toRoomMessage(message),
    roomId: message.chat_id,
    done: done.has(message.id),
  }))
  return {
    permissions,
    questions,
    answered,
    mentions,
    unreadable: read.unreadable,
    overflow: snapshot.attention_overflow_count ?? 0,
    truncated: snapshot.attention_truncated_count ?? 0,
  }
}

/**
 * One agent a person on the network advertises (GET /v1/listDiscovered, recorded 2026-09-20 with an agent running):
 * its name and handle, its state with Band, what it is doing, its task counts and what it has cost, where the person
 * shares that. Everything but the id is optional: a person who shares less still has a row.
 */
export const DiscoveredAgentSchema = z.object({
  agent_id: shortText,
  handle: shortText.nullish(),
  name: shortText.nullish(),
  state: shortText.nullish(),
  activity: z.object({ kind: shortText.nullish() }).nullish(),
  tasks: z.object({ pending: count.nullish(), in_progress: count.nullish(), completed: count.nullish() }).nullish(),
  cost: count.nullish(),
})
export type DiscoveredAgent = z.infer<typeof DiscoveredAgentSchema>

/**
 * One person the daemon has discovered (GET /v1/listDiscovered, recorded 2026-09-20): who they are, whether they are
 * online, when they were last seen, where they were found ("lan") and the agents they advertise. Their agents are read
 * one by one, so one in a format this app does not know costs its own line and not the person's row.
 */
export const DiscoveredUserRowSchema = z.object({
  user_id: shortText,
  owner_handle: shortText.nullish(),
  display_name: shortText.nullish(),
  deployment_scope: shortText.nullish(),
  agents: z.array(z.unknown()).nullish(),
  teams: z.array(z.unknown()).nullish(),
  last_seen_ms: count.nullish(),
  online: z.boolean().nullish(),
  origins: z.array(shortText).nullish(),
})

export interface DiscoveredUser {
  user_id: string
  owner_handle?: string | null
  display_name?: string | null
  deployment_scope?: string | null
  agents: DiscoveredAgent[]
  /**
   * Every agent the answer held for this person, read or not. A person whose agents all changed shape has none this
   * app can list, which is not the same as advertising none, and the screen must be able to tell the two apart.
   */
  agentsOffered: number
  teams: unknown[]
  last_seen_ms?: number | null
  online?: boolean | null
  origins?: string[] | null
}

/** GET /v1/listDiscovered (Sonar) */
export const DiscoveredSchema = z.object({
  snapshot: z.object({
    discoverable: z.boolean(),
    users: z.array(z.unknown()),
    multicast: shortText.optional(),
    share_room_titles: z.boolean().optional(),
    share_cost: z.boolean().optional(),
  }),
})
export interface Discovered {
  discoverable: boolean
  users: DiscoveredUser[]
  /**
   * Every person the answer held, read or not. The screen needs it to tell "nobody is nearby" from "this app could
   * read nobody", and it lets the settings the same answer carries keep working either way.
   */
  usersOffered: number
  multicast?: string
  share_room_titles?: boolean
  share_cost?: boolean
}

/**
 * The discovery snapshot as the page gets it: its people read one by one, and each person's agents likewise. What
 * the answer held is counted alongside what could be read, rather than thrown away or thrown over: the screen needs
 * both to tell an empty network from an answer it could not read, and the settings this same answer carries
 * (discoverable, and what it shares) stay readable even when its people do not.
 */
export function toDiscovered(raw: unknown): Discovered {
  const snapshot = DiscoveredSchema.parse(raw).snapshot
  const read = readEach(DiscoveredUserRowSchema, snapshot.users)
  return {
    ...snapshot,
    usersOffered: snapshot.users.length,
    users: read.items.map((row) => ({
      ...row,
      agents: readEach(DiscoveredAgentSchema, row.agents ?? []).items,
      agentsOffered: (row.agents ?? []).length,
      teams: row.teams ?? [],
    })),
  }
}

/** POST /v1/notificationPreferences {} */
export const NotificationPreferencesSchema = z.object({
  preferences: z.object({
    version: count.optional(),
    direct_mentions: z.boolean(),
    human_requests: z.boolean(),
    task_updates: shortText,
  }),
})
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>['preferences']

/**
 * POST /v1/runtimeDefaults {} (recorded 2026-09-20 on an account with nothing set, so every field answered null):
 * the defaults a new Jam-owned agent starts with. Null is what the daemon answers for a field the account has not
 * set, and an unset field is not a field set to zero or to off, so each is kept nullable and shown as the built-in.
 * The Docker sandbox and local-bridge fields are left out: they sit behind an experiment this app does not read.
 */
export const RuntimeDefaultsSchema = z.object({
  defaults: z.object({
    compact_at_tokens: count.nullish(),
    permission_timeout_secs: count.nullish(),
    question_timeout_secs: count.nullish(),
    idle_secs: count.nullish(),
    room_activity: shortText.nullish(),
    room_owner_approvals: z.union([z.boolean(), shortText]).nullish(),
    resume: z.union([z.boolean(), shortText]).nullish(),
  }),
})
export type RuntimeDefaults = z.infer<typeof RuntimeDefaultsSchema>['defaults']

/** POST /v1/logConfig {} */
export const LogConfigSchema = z.object({ config: z.object({ level: shortText }) })
export type LogConfig = z.infer<typeof LogConfigSchema>['config']

/** POST /v1/contactsOverview {profile} */
const ContactsSnapshotSchema = z.object({
  contacts: z.array(z.record(z.string(), z.unknown())),
  received: z.array(z.record(z.string(), z.unknown())),
  sent: z.array(z.record(z.string(), z.unknown())),
  contacts_truncated: z.boolean().optional(),
  received_truncated: z.boolean().optional(),
  sent_truncated: z.boolean().optional(),
})
export const ContactsOverviewSchema = z.object({
  overview: z.object({
    scopes: z.array(
      z.object({ scope: shortText, label: shortText, snapshot: ContactsSnapshotSchema, error: text.optional() }),
    ),
  }),
})
export type ContactsOverview = z.infer<typeof ContactsOverviewSchema>['overview']

/**
 * POST /v1/dashboard {profile, range} (recorded 2026-09-18, and again 2026-09-20 with an agent's traffic in it).
 * A series carries one name per line and one value per name at each point; `series_keys` are the ids behind the names
 * and are empty for a series that has none (the message types), so a line is keyed by its name where there is no id.
 */
const NamedValueSchema = z.object({ name: shortText, value: count, key: shortText.nullish() })
export type NamedValue = z.infer<typeof NamedValueSchema>
const SeriesSchema = z.object({
  series: z.array(shortText).catch([]),
  series_keys: z.array(shortText).catch([]),
  points: z.array(z.object({ label: shortText, values: z.array(count).catch([]) })).catch([]),
})
export type Series = z.infer<typeof SeriesSchema>
export const DashboardSchema = z.object({
  snapshot: z.object({
    range: shortText,
    executions: count.optional(),
    agent_count: count.optional(),
    active_chats: count.optional(),
    activity_spark: z.array(count).catch([]).optional(),
    messages_per_day: z.array(NamedValueSchema).catch([]).optional(),
    messages_per_agent: SeriesSchema.optional(),
    messages_per_type: SeriesSchema.optional(),
    tool_volume: z.array(NamedValueSchema).catch([]).optional(),
    tool_call_latency: z.array(z.unknown()).optional(),
    per_agent: z
      .array(
        z.object({
          agent: shortText,
          agent_id: shortText.nullish(),
          messages: count.optional(),
          tool_calls: count.optional(),
          errors: count.optional(),
        }),
      )
      .catch([])
      .optional(),
    human_sent: count.optional(),
    human_recv: count.optional(),
  }),
})
export type Dashboard = z.infer<typeof DashboardSchema>['snapshot']
/** The ranges the daemon accepts. */
export const DASHBOARD_RANGES = ['today', 'yesterday', '7d', '30d', '3m', '6m', '12m'] as const
export type DashboardRange = (typeof DASHBOARD_RANGES)[number]

/**
 * What the coding agents on this computer used: POST /v1/usageReport {req:{kind}} and POST /v1/usageSessions {req:{}},
 * both recorded 2026-09-20 (the sessions twice: `attribution` appears only once an agent's own traffic is among them).
 * `pricing` says where an amount came from, and `missingPricing` marks a model the catalogue does not price, which is
 * why such a model is explained instead of being given an amount.
 */
const UsagePricingSchema = z.object({
  costKind: shortText.nullish(),
  currency: shortText.nullish(),
  source: shortText.nullish(),
  amountUsd: count.optional(),
  missingPricing: z.boolean().optional(),
})
const UsageAmountsSchema = z.object({
  inputTokens: count.optional(),
  outputTokens: count.optional(),
  cacheCreationTokens: count.optional(),
  cacheReadTokens: count.optional(),
  reasoningTokens: count.optional(),
  totalCost: count.optional(),
  missingPricing: z.boolean().optional(),
  pricing: z.array(UsagePricingSchema).catch([]).optional(),
})
export type UsageAmounts = z.infer<typeof UsageAmountsSchema>
const UsageModelSchema = UsageAmountsSchema.extend({
  provider: shortText.nullish(),
  model: shortText,
  cost: count.optional(),
})
export type UsageModel = z.infer<typeof UsageModelSchema>
/** The daemon's own kinds (`jam usage --help`, 2026-09-18); "blocks" answers the 5-hour windows and no rows. */
export const USAGE_KINDS = ['daily', 'weekly', 'monthly', 'blocks'] as const
export type UsageKind = (typeof USAGE_KINDS)[number]
export const UsageReportSchema = z.object({
  report: z.object({
    rows: z
      .array(
        UsageAmountsSchema.extend({
          period: shortText,
          archived: z.boolean().optional(),
          models: z.array(UsageModelSchema).catch([]).optional(),
        }),
      )
      .catch([]),
    totals: UsageAmountsSchema.optional(),
  }),
})
export type UsageReport = z.infer<typeof UsageReportSchema>['report']
export type UsageRow = UsageReport['rows'][number]

export const UsageSessionsSchema = z.object({
  report: z.object({
    sessions: z
      .array(
        UsageAmountsSchema.extend({
          sessionId: shortText,
          provider: shortText.nullish(),
          lastActivity: shortText.nullish(),
          attribution: z
            .object({ agentId: shortText.nullish(), peerName: shortText.nullish(), chatId: shortText.nullish() })
            .nullish()
            .catch(null),
        }),
      )
      .catch([]),
    agents: z
      .array(
        UsageAmountsSchema.extend({
          peerName: shortText,
          sessionCount: count.optional(),
          lastActivity: shortText.nullish(),
        }),
      )
      .catch([]),
    totals: UsageAmountsSchema.optional(),
  }),
})
export type UsageSessions = z.infer<typeof UsageSessionsSchema>['report']
export type UsageSession = UsageSessions['sessions'][number]
export type UsageAgent = UsageSessions['agents'][number]
