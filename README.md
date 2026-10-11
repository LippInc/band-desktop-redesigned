# Jam, redesigned

An unofficial desktop front end for [BAND](https://band.ai/)'s Band Desktop (called Jam before version 0.4.14): every section of the official desktop app in a new look, with most of what you can do there (Status lists what stays in the official app). It runs on the daemon (`jamd`) that the official app installs, and the official Band Desktop stays installed next to it.

## What it needs

- Band Desktop installed and signed in, through the official app. Signing in, onboarding and updates stay there.
- Its daemon (`jamd`) running (the official app starts it). When it is not, this app says so and connects on its own once it is.

The app talks only to the daemon's local API (the named pipe `\\.\pipe\jam-<hash>` on Windows, `~/.jam/jam.sock` on macOS and Linux), from its main process, through a fixed list of named operations - and, for the one write whose input is a path on this computer (setting a room's plan file), from the main process alone, with the file chosen in a dialog there. It never reads Band's configuration or credentials, and never calls Band's servers.

## What this app never does

- **Run Band for you.** It never installs, starts, stops, restarts, updates or reconfigures Band, its daemon or its coding-tool plugins. When the daemon is not running, it says so and points to the official app.
- **Act on its own.** Every write happens because you did something: assigning work from Home, sending a message (an answer to an agent's question is one), deciding an agent's permission request with the three answers Band offers (Allow once, Deny, Deny always), stopping the turn an agent is working on, dismissing a mention, choosing the agent Home preselects, making a room, renaming one, deleting one, adding or removing a participant, making a team and editing a team, saving a copy of or deleting one of a room's files, attaching a file to a message, setting a room's plan file, turning a notification category on or off, and organising the room list - pinning a room, putting one in a folder, making a folder, and archiving a room or restoring it. Nothing happens on a timer or in the background. That list is the operations marked `write` in `src/main/daemon/operations.ts` plus the one write that lives in the main process alone (setting a room's plan file, whose path is chosen in a dialog there and never comes from the page), and each one's own comment says what it changes; a test fails if this paragraph and those two lists disagree.
- **Touch your account's keys.** Signing in or out, adding or removing an account, deleting the account or its local data, and revealing or replacing an agent's API key stay in the official app. The daemon routes behind them are refused before anything is sent (`src/main/daemon/forbidden.ts`).
- **Reach past the daemon.** It never reads or writes Band's configuration, state or credential files, and never calls Band's servers. The page cannot name a route: it asks the main process for one of a fixed list of operations, and every answer is checked against a schema first. One of Band's files is read: the user guide Band ships beside its daemon, shown read-only under Documentation and never copied into this project. Where it was read from is checked first - only an absolute path on this computer - and stays in the main process.
- **Trust what comes back.** Messages, file names and plans come from agents and people: they are shown as text or sanitised markdown, never as HTML; an image in a plan is never loaded (its text stands in); and a link opens only through the main process, and only if it is https or mailto. Local file paths and the errors that can name them stay in the main process.
- **Pass for Band on your computer.** It has its own app id, name, window title and folders, never registers the official app's URL protocol or file types, and never writes to its folders, so the official app and its CLI keep working beside it.
- **Break on a newer or older Band.** It records the daemon version it was built against (`BUILT_AGAINST` in `src/shared/daemon.ts`), tells you when the running one differs, ignores fields and events it does not know, and lets only the screen that needs a missing part degrade.

## Status

Every section of the official app is here. Home, with what waits on you, your agents' open work and the rooms they work in. Rooms: the room list, and a room's conversation - read back to the room's first message when you ask for it, and searched with Find in conversation - its agents' questions and permission requests, its work in Band's four views, its plan, participants and files. Agents. Teams. Inbox. Analytics, on both of Band's tabs. Sessions, Contacts, Sonar, Settings and Documentation, which shows Band's own user guide from the install on this computer.

What you can **change** from here is listed under "Act on its own" above. What still belongs to the official app: creating an agent, Band's Library of ready-made teams, a team's New room, downloading a file this computer does not hold, creating and editing a shared task, contact requests, runtime defaults, experiments, discovery and the coding-tool integrations. That list is not closed - `docs/jam/features.md` names every feature of the official app and says where it is here, and `docs/jam/differences.md` lists every place this app does or says something else, with the reason. Where a control is not here, this app says so rather than showing one that does nothing.

| Platform | State |
|---|---|
| Windows | Builds and runs from source; an unsigned installer (`pnpm dist:win`) |
| Linux | Installs, builds and passes the unit tests under WSL, the daemon client included over a Unix socket; the app window has not been opened on Linux yet |
| macOS | Not run yet, and nothing here has been checked on a Mac |

## Develop

Requires Node 22.18 or newer and pnpm 10.

```bash
pnpm install
pnpm dev            # the app with hot reload, on the FAKE daemon (fixtures in tests/fake-daemon)
pnpm dev:live       # the app on the Band daemon (jamd) on this computer (it writes only what you do in a room)
pnpm check          # typecheck, lint, format, unit tests, the identity check
pnpm test:e2e       # build, then drive the real app with Playwright (fake daemon)
pnpm ui:check       # build, then screenshot every state into design/reference/app/
pnpm dist:win       # an unsigned Windows installer in dist/
```

Development never reaches a real account by accident: `pnpm dev`, `pnpm check`, `pnpm test:e2e` and `pnpm ui:check` all run on the fake daemon. Only `pnpm dev:live`, `pnpm fixtures:record` and `pnpm smoke:packaged` reach the Band daemon on this computer: the last two only read, and `pnpm dev:live` writes only what you do in it. Each of them first checks an optional, untracked `.local/live-blackout.json` that can name days when nothing may touch the live daemon (`scripts/lib/live-guard.mjs`).

`pnpm check:identity` (part of `pnpm check`) fails when a file carries the user name, home folder or git identity of the person running it, or anything shaped like a key; the copyright holder's name is allowed on the lines that name the holder.

`docs/DESIGN.md` is the design spec, `docs/jam/routes.md` the daemon routes this app calls, and `docs/jam/features.md` the feature list.

## Licence

MIT for this project's own code (`LICENSE`). `NOTICE` lists the third-party code inside and its licences.
