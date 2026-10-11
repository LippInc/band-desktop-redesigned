# The Band daemon's routes this app calls

The daemon (`jamd`) that Band Desktop installs answers HTTP on its local endpoint (the named pipe `\\.\pipe\jam-<hash>`
on Windows, `~/.jam/jam.sock` on macOS and Linux). These are the routes this app calls, with the request and answer
shapes it relies on, and the ones it never calls (`src/main/daemon/forbidden.ts`). Shapes are as of `jamd` 0.4.10, and
0.4.14 for Teams.

**Kinds.** *read · recorded*: a read whose answer shape was recorded from the daemon (`pnpm fixtures:record` repeats it).
*writes*: changes something in Band; called only as a named operation that a screen needs - or, for one whose input is a
path on this computer (`/v1/setPlan`), by the main process alone, with the path chosen in a dialog there - and only when
the person using the app does something. *writes · recorded*: a write whose request and answer were recorded.
*stream*: stays open. **never**: this app never calls it.

Requests are HTTP with `Host: jamd` and a JSON body; a malformed body answers 422 naming the first missing field, an
unknown route 404 with an empty body, a wrong method 405. Many peer-scoped reads take `{target: {profile, scope, handle}}`
and answer 404 "peer not found" without a local agent. A room is named by `chat_id`, a UUID (Band refuses anything else:
"Invalid format. Expected :uuid"); a room the account is not in answers 500 with Band's 404 on the routes that ask Band
(`roomParticipants`, `roomLocality`) and empty lists on the others.

## Daemon

| Route | Kind | Notes |
|---|---|---|
| `/v1/ping` | read · recorded | GET; version, update state, wire |
| `/v1/events` | stream | GET; 200, chunked, no content type; one JSON object per line: `{peer, kind: {kind: <name>, ...}}`. On opening it sends `inbox_snapshot` (the person's attention: `{peer: "human/<profile>", kind: {kind, profile, snapshot: {direct_mentions, mentions, open_questions_by_task, accepted_question_replies, pending_permissions, read_ids, done_ids, recovery}}}`; no route answers it), then every change. Recorded 2026-09-19 with an agent at work: `room_message`, `room_message_mutation`, `activity`, `room_thought_stream`, `task_lane_changed`, `room_board`, `agent_questions_asked` {room, questions [{id, group_id, answer_code, prompt, options, multi_select}]}, `agent_question_reply_accepted`, `agent_questions_resolved`, `runtime_permission_requested` and `runtime_permission_resolved` {record}, `attention_candidate`, `peer_added`, `peer_updated`, `runtime_gauges`, `room_connectivity_changed`, `room_directory_snapshot`, `fresh_room_directory`, `room_head_snapshot`, `room_recovery_status`, `inbound`, `stats_changed`, `account_rate_limits` |
| `/v1/shutdown` | **never** | the daemon is never stopped or updated by this app |
| `/v1/update` | **never** | the daemon is never stopped or updated by this app |

## Account

| Route | Kind | Notes |
|---|---|---|
| `/v1/accounts` | read · recorded | GET |
| `/v1/addAccount` | **never** | sign-in and account removal stay in the official app |
| `/v1/addOauthAccount` | **never** | sign-in and account removal stay in the official app |
| `/v1/deleteAccount` | **never** | sign-in and account removal stay in the official app |
| `/v1/deleteLocalAccountData` | **never** | sign-in and account removal stay in the official app |
| `/v1/removeAccount` | **never** | sign-in and account removal stay in the official app |
| `/v1/signOutAccount` | **never** | sign-in and account removal stay in the official app |

## Experiments

| Route | Kind | Notes |
|---|---|---|
| `/v1/listExperiments` | read · recorded | GET |

## Notifications

| Route | Kind | Notes |
|---|---|---|
| `/v1/notificationPreferences` | read · recorded | POST {} |
| `/v1/setNotificationPreferences` | writes | POST {preferences: NotificationPreferences}, the whole set at once, in the shape /v1/notificationPreferences answers |

## Logs

| Route | Kind | Notes |
|---|---|---|
| `/v1/logConfig` | read · recorded | POST {} |

## Rooms

| Route | Kind | Notes |
|---|---|---|
| `/v1/roomOrg` | read · recorded | POST {profile}; {folders, assignments, pinned, collapsed, archived} |
| `/v1/rooms` | read · recorded | POST {profile}; {rooms: [{id, title, task_id, updated_at, last_message_at}]}; a new room is "New Session", `last_message_at` null until its first message |
| `/v1/roomFileList` | read · recorded | POST {profile, chat_id, cursor?, limit?}; a page at a time, `next_cursor` asking for the one after it; {page: {files: [{id, local_artifact_id, name, mime, bytes, sha256, path, has_thumb, uploader_id, uploader_type, uploader_name, created_at, expires_at, local_only}], next_cursor, has_more, limit, status: local_complete or local_partial}} |
| `/v1/roomLocality` | read · recorded | POST {profile, chat_id}; {locality: {all_local, remote: []}} |
| `/v1/roomMessages` | read · recorded · **called** | POST {profile, chat_id, query: {page, page_size, message_type, since}} (`""` for every type and all time); {page: {messages, page, total_pages, next_cursor, has_more, limit, account_instance, last_included_mutation_sequence}}; the same messages as roomMessageSnapshot. **Page 1 is the newest page**: in the recorded answer its 50 ran to the room's last message, with `total_pages` 2 and `has_more` true, so paging forward walks backwards in time; within a page the messages are oldest first, as in the snapshot |
| `/v1/roomMessageSnapshot` | read · recorded | POST {profile, chat_id}; {snapshot: {chat_id, account_instance, last_included_mutation_sequence, messages, next_cursor, has_more, recovery: {state, detail, completed_rooms, total_rooms}}}, oldest first. A message (2026-09-19): {id, chat_id, content, message_type ("text", "tool_call", "tool_result", "task", "participant"), sender_id, sender_name, sender_type ("User", "Agent"), inserted_at, updated_at, mention_names {id: name}, tool_name, tool_call_id, thought_stream_id, system_event ("participant_added"), system_subject, connectivity_*, attachments}; a mention is `@[[participant id]]` in `content`. An agent's question is a text message ending in "Reply with `Answer <code>: <answer>`." and the marker `\u2063jam-hitl-question\u2063<question id>`; the answer is a person's message "Answer <code>: <answer>" |
| `/v1/roomParticipants` | read · recorded | POST {profile, chat_id}; {participants: [{id, handle, name, kind ("User", "Agent"), role ("owner", "member"), status ("active", "inactive"), connection_status, connection_observation, room_service, avatar_url}]}; an agent's id is its Band agent id, the person's their account's user id |
| `/v1/addRoomParticipant` | writes | POST {profile, chat_id, participant_id, role?}: adds an agent or a person to a room (`role` any string, optional) |
| `/v1/createRoom` | writes | POST {profile} and nothing else (no title field); {chat: {id, title: "New Session", task_id, updated_at, last_message_at}} |
| `/v1/deleteRoom` | writes | POST {profile, chat_id}; owner only |
| `/v1/removeRoomParticipant` | writes | POST {profile, chat_id, participant_id}; not yourself, not the owner |
| `/v1/renameRoom` | writes | POST {profile, chat_id, title}; {chat: {...}}; owner only |
| `/v1/roomSend` | writes | POST {profile, chat_id, content, mentions: [participant id], attachment_ids?: [artifact id]}; Band refuses an empty `mentions` ("minItems: 1"); answers {id}. An attachment id comes from `artifactStore`. The app's message, and its answer to an agent's question ("Answer <code>: <answer>", the agent's own instruction), both exercised live on 2026-09-19; a send carrying an attachment has not been exercised live |
| `/v1/setRoomOrg` | writes | POST {profile, org: RoomOrg} - the whole organisation at once, in the shape /v1/roomOrg answers: {folders, assignments, pinned, collapsed, archived}. `folders` is a list of {id, name}; `assignments` maps a room id to a folder id; `pinned` is a list of room ids; `collapsed` is a list of folder ids; and `archived` maps a room id to an **integer**, not a boolean - `{room id: true}` is refused with "invalid type: boolean, expected i64". What that number counts is not known |

## Work

| Route | Kind | Notes |
|---|---|---|
| `/v1/getRoomBoard` | read · recorded | POST {profile, chat_id}; {board: {chat_id, tasks: [{uid ("#1"), subject, detail, component_refs_declared, overall ("pending", ...), assignments, created_by {kind, id, name, handle}, created_at, updated_at, started_at, completed_at, history}], next_seq}} |
| `/v1/roomWorkLanes` | read · recorded | POST {profile, chat_id}; {lanes: [{peer_id ("<profile>/<scope>"), lane_id, active, items: [{id, subject, status ("pending", "in_progress", "completed"), active_form, owner, detail, linked_room_task_uid, linked_chat_id, origin_chat_id, updated_at, first_seen_at, status_changed_at, started_at, completed_at, blocks, blocked_by, metadata, deleted_at}], source {kind, adapter}}]} |
| `/v1/roomWorkSnapshot` | read · recorded | POST {profile}; the whole account's work (a `chat_id` is ignored): {snapshot: {boards: [{chat_id, tasks, next_seq}], lanes: [{room, lanes: [lane as roomWorkLanes]}]}} |
| `/v1/kickoffWork` | writes | POST {profile, agent: {profile, scope, handle}, message, artifact_ids?: [artifact id]}; {outcome: {chat_id, task_uid, message_id, delivery ("bound"), collaborator_agent_ids, runs_elsewhere}}. Its artifacts are stored unbound (`artifactStore.chat_id: ""`) until this write opens the room. It OPENS A ROOM: it takes no chat_id. An assignment carrying an artifact has not been exercised live |

## Plan

| Route | Kind | Notes |
|---|---|---|
| `/v1/getRoomPlan` | read · recorded | POST {chat_id} (profile optional); {plan: {chat_id, source: {raw, canonical, label, attachment_id, kind ("markdown"), event_profile, snapshot} or null, cache: {body, content_type ("markdown"), fetched_at, bytes} or null, last_error, live_source_state, watch_error, overlay: {states, focus}, updated_at, doc_rev}} |
| `/v1/setPlan` | writes | POST {profile, chat_id, source: a local `.md` path, label?, snapshot?}; `snapshot: true` also stores a copy in the room's Files (local only) |

## Files

| Route | Kind | Notes |
|---|---|---|
| `/v1/artifactDeletePreview` | read · recorded | POST {profile, id}; {preview: {impact_token, affected_plan_chat_ids}} - the rooms whose plan that file is the source of, and the token a delete must then carry |
| `/v1/artifactGet` | read · recorded | POST {profile, id}; {artifact: {id, profile, chat_id, name, mime, bytes, sha256, path, remote_id, has_thumb, created_by, origin, created_at}}. The main process alone calls it: its `path` is why it is not a named operation |
| `/v1/artifactDelete` | writes | POST {profile, id, impact_token} - the token from artifactDeletePreview |
| `/v1/artifactSaveCopy` | writes | POST {profile, id}: writes a copy to the person's Downloads folder |
| `/v1/artifactStore` | writes · recorded | POST {profile, chat_id (a room id, or `""` to stage unbound), source: {kind: "bytes", value: base64} or {kind: "path", ...}, name, created_by, mime}; {artifact: {id, profile, chat_id (null when unbound), name, mime, bytes, sha256, path, remote_id, has_thumb, created_by, origin, created_at}}. The app uses only the bytes variant and its main-process schema keeps only `artifact.id`, dropping the local `path` and every other field before the answer can reach the page |

## Inbox

| Route | Kind | Notes |
|---|---|---|
| `/v1/setInboxItemState` | writes | POST {profile, item_id, read: bool, done: bool} |

## Agents

| Route | Kind | Notes |
|---|---|---|
| `/v1/agent-list` | read · recorded | POST {profile}; {list: {rows: [{id, name, handle, is_external, description, tags, local: {peer_key ("<profile>/<scope>"), cwd, host}}], remote, org_name}} |
| `/v1/defaultAgent` | read · recorded | POST {profile}; {peer} |
| `/v1/list` | read · recorded | GET; {peers: [{peer: {scope, profile, cwd, agent_id, agent_name, handle, host, started_at, identity_class, host_sessions: [a session as `/v1/listSessions` gives it, except that no `handle` is on this route]}, state ("connected"), running, warning}]}. Every host session on this computer in one answer, which is what Sessions lists |
| `/v1/listSessions` | read · recorded | POST {target: {profile, scope, handle}}; {sessions: [{id ("default", or "<template>-<room id>"), room, provider, agent_session_id, provider_session_id, binding ("bound", "detached"), presence ("live", "unknown"), runtime, runtime_template_id, runtime_host_id, host_pid, window_pid, last_activity_at, last_seen_at, handle}]} |
| `/v1/status` | read · recorded | POST {target}: per peer; {status: {peer: {scope, profile, cwd, agent_id, agent_name, handle, host, host_sessions, ...}}} |
| `/v1/setDefaultAgent` | writes | POST {profile, peer}; `peer` is a local key `<profile>/<scope>` |

## Teams

Band Desktop 0.4.14 (wire 30) added Teams.

| Route | Kind | Notes |
|---|---|---|
| `/v1/listTeams` | read · recorded | POST {profile}; {teams: [{id, profile, name, description, guidelines, agent_ids, template_id (null for a team made by hand), role_ids, created_at_ms, updated_at_ms}]} |
| `/v1/createTeam` | writes · recorded | POST {profile, draft: {name, description, guidelines, agent_ids, role_ids}}; {team: {...as listed}}; 400 {error: "Choose at least one agent for the team.", control_error: {Invalid}} for no agent. |
| `/v1/updateTeam` | writes · recorded | POST {profile, team_id, draft: {...as createTeam}}; {team: {...}}; the whole draft at once, so an edit sends the roles back as they were |

## Runtime

| Route | Kind | Notes |
|---|---|---|
| `/v1/runtimeDefaults` | read · recorded | POST {}; {defaults: {compact_at_tokens, permission_timeout_secs, resume, idle_secs, question_timeout_secs, room_activity, room_owner_approvals, docker_sandbox, developer_network_destinations, production_network_access, local_platform_bridge, local_platform_origin}}. Every field is null on an account that has set none, which is what Jam shows as its built-in; Settings' Runtime page reads the first seven |
| `/v1/runtimePermissions` | read · recorded | POST {target, host_session}; {permissions: [{request: {id ("claude-permission:claudecode:<turn>:<n>"), session_id, chat_id, agent_session_id, turn_id, source_message_id, provider, action ("Write", "Bash"), description, metadata_json, display_truncated, durable_rule, command, created_at, expires_at}, status ("pending", "resolved"), decision: {id, outcome ("allow_once", "expired", ...), decided_at, reason}, resolved_at}]}. A Claude Code runtime's request lasts 60 s (the provider's tool call times out, "abandoned by the adapter"), and the agent may ask again |
| `/v1/decideRuntimePermission` | writes | POST {target: {profile, scope, handle}, id, outcome}; outcome allow_once, allow_always, deny_once, deny_always, cancelled or expired (the daemon's list; Jam Desktop offers Allow once, Deny and Deny always, and so does this app); answers {permission: record}. Allow once exercised live on 2026-09-19 |
| `/v1/interruptRuntimeTurn` | writes | POST {target: {profile, scope, handle}, host_session}: stops the turn on that ONE session, which is that agent's session for one room (`<template>-<room id>`). Its runtime keeps running and its other rooms are untouched. The CLI's `jam runtime interrupt --host-session` is the same thing |
| `/v1/replaceAgentApiKey` | **never** | never exposed (README) |
| `/v1/revealAgentApiKey` | **never** | never exposed (README) |

## Analytics

| Route | Kind | Notes |
|---|---|---|
| `/v1/dashboard` | read · recorded | POST {profile, range: today | yesterday | 7d | 30d | 3m | 6m | 12m} |
| `/v1/usageReport` | read · recorded | POST {req: {kind: daily | weekly | monthly | blocks}} |
| `/v1/usageSessions` | read · recorded | POST {req: {}} |

## Contacts

| Route | Kind | Notes |
|---|---|---|
| `/v1/contactsOverview` | read · recorded | POST {profile} |
| `/v1/searchDirectory` | read · recorded | POST {profile, kind, q}; {entries: [{id, kind, name, handle, description, tags, online}], truncated}. `kind` is exactly `agent` or `user` - `person` and `people` are refused with "Invalid value for enum". It searches **Band's own directory**, not this account: a single letter answered 50 entries with `truncated` true, and `online` was false for every one of them, this account's own agent included, so it is the identity's own state and not whether it can be added (recorded 2026-09-21) |

## Sonar

| Route | Kind | Notes |
|---|---|---|
| `/v1/listDiscovered` | read · recorded | GET; {snapshot: {discoverable, multicast ("ok"), share_room_titles, share_cost, users: [{deployment_scope, user_id, owner_handle, display_name, last_seen_ms, online, origins (["lan"]), teams ([]), agents: [{agent_id, handle, name, state ("connected"), activity: {kind: "idle", "working"}, tasks: {pending, in_progress, completed}, cost}]}]}. Sonar's people and their agents; a team's own fields have never been seen, because `teams` was empty in every reading |
