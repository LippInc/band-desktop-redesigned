import type {
  Account,
  AgentList,
  AgentSession,
  AgentStatus,
  AgentTarget,
  BoardTask,
  ContactsOverview,
  DaemonInfo,
  Dashboard,
  DashboardRange,
  Discovered,
  HostPeer,
  DeletePreview,
  Experiments,
  Kickoff,
  LogConfig,
  NotificationPreferences,
  Participant,
  Room,
  RoomFiles,
  RoomHistoryPage,
  RoomMessages,
  RoomOrg,
  DirectoryEntry,
  DirectoryKind,
  RuntimePermission,
  RoomPlan,
  RuntimeDefaults,
  Team,
  TeamDraft,
  UsageKind,
  UsageReport,
  UsageSessions,
  WorkLane,
  WorkSummary,
} from './daemon'

/** A room's reads take the account profile and the room's id (a UUID; the daemon calls it `chat_id`). */
export interface RoomInput {
  profile: string
  roomId: string
}

/** One page of a room's files: the first without a cursor, each next one with the cursor the last page answered. */
export interface RoomFilesInput extends RoomInput {
  cursor?: string
}

/** One page of a room's conversation: page 1 is the newest (`RoomHistorySchema`). */
export interface RoomPageInput extends RoomInput {
  page: number
}

/** A message the person sends: its text, the participants it mentions (Band needs at least one), and any files staged onto it. */
export interface MessageInput extends RoomInput {
  content: string
  mentions: string[]
  attachmentIds?: string[]
}

/**
 * A file staged onto a message (user guide, "Use attachments"): its own name, its MIME kind, and its bytes as
 * base64 - the one form the daemon's artifact store takes. Nothing here is a path; the file came from the page's
 * own paste or drop, never from this machine's disk by name.
 */
export interface AttachmentInput {
  name: string
  mime: string
  /** The file's bytes, base64-encoded. */
  content: string
}

/** Jam's own attachment limits (user guide: "The attachment limit is ten files per message and 32 MB per file."). */
export const ATTACHMENT_LIMITS = { files: 10, bytes: 32 * 1024 * 1024 } as const

/** The longest base64 the store will take: the guide's 32 MB, encoded. Longer than this is not a file to stage. */
export const ATTACHMENT_MAX_BASE64 = 4 * Math.ceil(ATTACHMENT_LIMITS.bytes / 3)

/** A staged file's longest name and kind, and the kind's form: type/subtype. */
export const ATTACHMENT_NAME_MAX = 200
export const ATTACHMENT_MIME_MAX = 100
export const ATTACHMENT_MIME = /^[A-Za-z0-9][\w.+-]*\/[\w.+-]+$/

/**
 * Whether a staged file's name is one the store is sent: not blank, short, never a path (no slash either way), no
 * control character, and not "." or "..". What the daemon does with a name was never recorded, so nothing that could
 * steer a file system goes to it. The page refuses these when a file is staged; the main process refuses them again.
 */
export function isAttachmentName(name: string): boolean {
  const trimmed = name.trim()
  return (
    trimmed !== '' &&
    name.length <= ATTACHMENT_NAME_MAX &&
    !name.includes('/') &&
    !name.includes('\\') &&
    ![...name].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) &&
    trimmed !== '.' &&
    trimmed !== '..'
  )
}

/** Storing one file for a message: bound to a room, or unbound (`roomId: ''`) for Home's assignment, which opens its own room. */
export interface FileStoreInput {
  profile: string
  roomId: string
  name: string
  mime: string
  content: string
}

/**
 * The three answers Jam Desktop offers a permission request (0.4.10: Allow once, Deny, Deny always). The daemon also
 * knows `allow_always`, which Jam never offers: it creates no lasting grants (user guide, "Decide a permission request").
 */
export const PERMISSION_OUTCOMES = ['allow_once', 'deny_once', 'deny_always'] as const
export type PermissionOutcome = (typeof PERMISSION_OUTCOMES)[number]

export interface DecisionInput extends AgentTarget {
  requestId: string
  outcome: PermissionOutcome
}

/** One of a room's files, named the way the daemon names it. Where it is stored never reaches the page. */
export interface FileInput {
  profile: string
  id: string
}

/**
 * Stopping the turn one agent is working on, in one room. `hostSession` is that agent's session for this room: the
 * daemon interrupts the turn of that session alone, so another room's work carries on.
 */
export interface InterruptInput extends AgentTarget {
  hostSession: string
}

/** One session of one agent: what a read about that session alone is asked for. */
export interface AgentSessionInput extends AgentTarget {
  hostSession: string
}

/** An assignment from Home: the agent it goes to, the instruction the person wrote (user guide, "Assign work"), and any staged files. */
export interface KickoffInput extends AgentTarget {
  message: string
  attachmentIds?: string[]
}

/**
 * The named operations the page may ask the daemon for. Each one is a fixed route with a validated input and a validated
 * answer (src/main/daemon/operations.ts); there is no way to call a route by name from the page (README, "What this app
 * never does"). A new operation goes: its types here, its name in DAEMON_OPERATION_NAMES, its row in operations.ts, a
 * fixture in tests/fake-daemon, and a test.
 */
export interface DaemonOperations {
  ping: { input: void; output: DaemonInfo }
  accounts: { input: void; output: Account[] }
  experiments: { input: void; output: Experiments }
  rooms: { input: { profile: string }; output: Room[] }
  roomOrg: { input: { profile: string }; output: RoomOrg }
  runtimePermissions: { input: AgentSessionInput; output: RuntimePermission[] }
  searchDirectory: {
    input: { profile: string; kind: DirectoryKind; q: string }
    output: { entries: DirectoryEntry[]; truncated: boolean }
  }
  agentList: { input: { profile: string }; output: AgentList }
  teams: { input: { profile: string }; output: Team[] }
  discovered: { input: void; output: Discovered }
  notificationPreferences: { input: void; output: NotificationPreferences }
  logConfig: { input: void; output: LogConfig }
  runtimeDefaults: { input: void; output: RuntimeDefaults }
  contactsOverview: { input: { profile: string }; output: ContactsOverview }
  dashboard: { input: { profile: string; range: DashboardRange }; output: Dashboard }
  usageReport: { input: { kind: UsageKind }; output: UsageReport }
  usageSessions: { input: void; output: UsageSessions }
  roomParticipants: { input: RoomInput; output: Participant[] }
  roomMessages: { input: RoomInput; output: RoomMessages }
  roomHistory: { input: RoomPageInput; output: RoomHistoryPage }
  roomPlan: { input: RoomInput; output: RoomPlan }
  roomFiles: { input: RoomFilesInput; output: RoomFiles }
  roomWork: { input: RoomInput; output: WorkLane[] }
  roomBoard: { input: RoomInput; output: BoardTask[] }
  workSnapshot: { input: { profile: string }; output: WorkSummary }
  agentSessions: { input: AgentTarget; output: AgentSession[] }
  agentStatus: { input: AgentTarget; output: AgentStatus }
  defaultAgent: { input: { profile: string }; output: { peer: string | null } }
  fileDeletePreview: { input: FileInput; output: DeletePreview }
  hostPeers: { input: void; output: HostPeer[] }
  // Writes: the person's own actions, each one a click or a send.
  /** Stores one file for a message; the id it answers is what the send then attaches. */
  fileStore: { input: FileStoreInput; output: { id: string } }
  roomSend: { input: MessageInput; output: { id: string | null } }
  decidePermission: { input: DecisionInput; output: { decided: true } }
  kickoffWork: { input: KickoffInput; output: Kickoff }
  setDefaultAgent: { input: { profile: string; peer: string }; output: { set: true } }
  fileSaveCopy: { input: FileInput; output: { saved: true } }
  fileDelete: { input: FileInput & { impactToken: string }; output: { deleted: true } }
  interruptTurn: { input: InterruptInput; output: { interrupted: true } }
  dismissMention: { input: { profile: string; itemId: string }; output: { dismissed: true } }
  setRoomOrg: { input: { profile: string; org: RoomOrg }; output: { set: true } }
  createRoom: { input: { profile: string }; output: Room }
  renameRoom: { input: RoomInput & { title: string }; output: Room }
  deleteRoom: { input: RoomInput; output: { deleted: true } }
  addRoomParticipant: { input: RoomInput & { participantId: string }; output: { added: true } }
  removeRoomParticipant: { input: RoomInput & { participantId: string }; output: { removed: true } }
  setNotifications: { input: NotificationPreferences; output: { set: true } }
  createTeam: { input: { profile: string; draft: TeamDraft }; output: Team }
  updateTeam: { input: { profile: string; teamId: string; draft: TeamDraft }; output: Team }
}

export type DaemonOperationName = keyof DaemonOperations

export const DAEMON_OPERATION_NAMES = [
  'ping',
  'accounts',
  'experiments',
  'rooms',
  'roomOrg',
  'agentList',
  'teams',
  'discovered',
  'notificationPreferences',
  'logConfig',
  'runtimeDefaults',
  'contactsOverview',
  'dashboard',
  'usageReport',
  'usageSessions',
  'roomParticipants',
  'roomMessages',
  'roomHistory',
  'roomPlan',
  'roomFiles',
  'roomWork',
  'roomBoard',
  'workSnapshot',
  'agentSessions',
  'agentStatus',
  'defaultAgent',
  'fileDeletePreview',
  'hostPeers',
  'roomSend',
  'decidePermission',
  'kickoffWork',
  'setDefaultAgent',
  'fileSaveCopy',
  'fileStore',
  'fileDelete',
  'interruptTurn',
  'dismissMention',
  'runtimePermissions',
  'searchDirectory',
  'setRoomOrg',
  'createRoom',
  'renameRoom',
  'deleteRoom',
  'addRoomParticipant',
  'removeRoomParticipant',
  'setNotifications',
  'createTeam',
  'updateTeam',
] as const satisfies readonly DaemonOperationName[]

export type DaemonInput<K extends DaemonOperationName> = DaemonOperations[K]['input']
export type DaemonOutput<K extends DaemonOperationName> = DaemonOperations[K]['output']

/** The page's view of the operations: one function per name. */
export type DaemonOperationsApi = {
  [K in DaemonOperationName]: DaemonInput<K> extends void
    ? () => Promise<DaemonOutput<K>>
    : (input: DaemonInput<K>) => Promise<DaemonOutput<K>>
}

/**
 * Where the app stands with the daemon. `offline`: no daemon answered (it is not running, or it is starting); the app
 * never starts one and points to the official app instead. `connected` carries whether the running daemon speaks the wire
 * version this app was built against (`wire` is null when the daemon did not say).
 */
export type DaemonStatus =
  | { state: 'connecting' }
  | { state: 'connected'; version: string; wire: number | null; wireMatches: boolean }
  | { state: 'offline'; reason: 'not-found' | 'not-answering' }

/**
 * Something the daemon's live stream announced. An event means "something changed, read again": the page gets its name
 * and never its content. The one payload the page needs, the person's inbox (`inbox_snapshot`: no route answers it), is
 * validated and kept in the main process, and the page reads it with getInbox after that event.
 */
export interface DaemonEvent {
  receivedAt: number
  /** The event's own name (`room_directory_snapshot`, `inbox_snapshot`, `room_message`, recorded 2026-09-19). */
  kind: string | null
}

/** Error codes the main process puts in a refused operation's message, as `[jam:<code>] <text>`. */
export const DAEMON_ERROR_CODES = ['offline', 'unsupported', 'rejected', 'invalid-answer', 'timeout', 'input'] as const
export type DaemonErrorCode = (typeof DAEMON_ERROR_CODES)[number]
