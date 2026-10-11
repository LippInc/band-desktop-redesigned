import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  Moon,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  SquarePen,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { useMemo } from 'react'
import { flushSync } from 'react-dom'
import { SECTIONS, SETTINGS_SECTIONS } from '@/lib/sections'
import { isNarrowWindow } from '@/lib/use-narrow'
import { useDaemon, useExperiment } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { SECTION_EXPERIMENTS } from '@shared/daemon'

export interface Command {
  id: string
  label: string
  group: 'Go to' | 'Settings' | 'Panels' | 'Application'
  icon: LucideIcon
  /** As written in Settings and tooltips, e.g. "Ctrl+B"; the key handler reads `keys`. */
  shortcut?: string
  keys?: KeyMatch[]
  /** Words the palette also matches. */
  keywords?: string[]
  run(): void
}

export interface KeyMatch {
  /** `event.key` in lower case: `b`, `,`, `arrowleft`. */
  key: string
  mod?: boolean
  alt?: boolean
  shift?: boolean
  /**
   * Fires only when no text field has focus: a plain key (Jam's `b`), or a key a text field uses itself (Alt+Left moves
   * the caret by a word on macOS).
   */
  outsideFields?: boolean
}

/**
 * The one command registry: the palette, the app menu, the buttons that show a shortcut and the key handling all read
 * it, so a shortcut is written once. Jam's own shortcut, `b` for the sidebar outside a field, sits beside ZCode's Ctrl+B.
 */
export function useCommands(): Command[] {
  const navigate = useNavigate()
  const router = useRouter()
  const settings = useSettings((state) => state.settings)
  const update = useSettings((state) => state.update)
  const setPaletteOpen = useUi((state) => state.setPaletteOpen)
  const reconnect = useDaemon((state) => state.reconnect)
  const inbox = useExperiment(SECTION_EXPERIMENTS.inbox)
  const sessions = useExperiment(SECTION_EXPERIMENTS.sessions)
  // Find in conversation belongs to a room, as it does in Jam Desktop: it is offered only while one is open.
  const inRoom = useRouterState({ select: (state) => state.location.pathname.startsWith('/rooms/') })
  const askFind = useUi((state) => state.askFind)

  return useMemo(() => {
    const visible = SECTIONS.filter(
      (section) =>
        !section.experiment ||
        (section.experiment === SECTION_EXPERIMENTS.inbox && inbox) ||
        (section.experiment === SECTION_EXPERIMENTS.sessions && sessions),
    )
    const goTo: Command[] = visible.map((section) => ({
      id: `go:${section.id}`,
      label: section.label,
      group: 'Go to',
      icon: section.icon,
      ...(section.id === 'home'
        ? { shortcut: 'Ctrl+N', keys: [{ key: 'n', mod: true }], keywords: ['assign work', 'new'] }
        : {}),
      run: () => void navigate({ to: section.path }),
    }))
    const settingsPages: Command[] = SETTINGS_SECTIONS.map((page) => ({
      id: `settings:${page.id}`,
      label: `Settings: ${page.label}`,
      group: 'Settings',
      icon: SettingsIcon,
      ...(page.id === 'account' ? { shortcut: 'Ctrl+,', keys: [{ key: ',', mod: true }] } : {}),
      run: () => void navigate({ to: '/settings/$section', params: { section: page.id } }),
    }))
    // The Jam theme is a dark one, so from it the command offers light.
    const dark = settings.theme === 'dark' || settings.theme === 'jam'
    return [
      {
        id: 'search',
        label: 'Search',
        group: 'Go to',
        icon: Search,
        shortcut: 'Ctrl+K',
        keys: [{ key: 'k', mod: true }],
        // Rendered at once, inside the keypress, so the search field exists and has focus before the next key arrives
        // (a scheduled render let keys typed right after Ctrl+K reach the page on a cold start, 2026-09-19).
        run: () => flushSync(() => setPaletteOpen(true)),
      },
      ...goTo,
      ...(inRoom
        ? [
            {
              id: 'room:find',
              label: 'Find in conversation',
              group: 'Go to' as const,
              icon: Search,
              shortcut: 'Ctrl+F',
              // Ctrl+F while the composer has focus too: it is what a person presses to look through what is said.
              keys: [{ key: 'f', mod: true }],
              keywords: ['find', 'search the conversation'],
              run: () => flushSync(() => askFind()),
            },
          ]
        : []),
      {
        id: 'go:back',
        label: 'Go back',
        group: 'Go to',
        icon: ArrowLeft,
        shortcut: 'Alt+Left',
        keys: [{ key: 'arrowleft', alt: true, outsideFields: true }],
        keywords: ['history', 'previous'],
        run: () => router.history.back(),
      },
      {
        id: 'go:forward',
        label: 'Go forward',
        group: 'Go to',
        icon: ArrowRight,
        shortcut: 'Alt+Right',
        keys: [{ key: 'arrowright', alt: true, outsideFields: true }],
        keywords: ['history', 'next'],
        run: () => router.history.forward(),
      },
      {
        id: 'panels:sidebar',
        label: 'Toggle sidebar',
        group: 'Panels',
        icon: PanelLeft,
        shortcut: 'Ctrl+B',
        keys: [
          { key: 'b', mod: true },
          { key: 'b', outsideFields: true },
        ],
        // A narrow window opens the sidebar as a drawer over the page; a wide one folds it (a setting that is kept).
        run: () => {
          if (isNarrowWindow()) {
            const { drawerOpen, setDrawerOpen } = useUi.getState()
            setDrawerOpen(!drawerOpen)
          } else void update({ sidebarOpen: !useSettings.getState().settings.sidebarOpen })
        },
      },
      {
        id: 'panels:side-pane',
        label: 'Toggle side pane',
        group: 'Panels',
        icon: PanelRight,
        shortcut: 'Ctrl+Alt+B',
        keys: [{ key: 'b', mod: true, alt: true }],
        run: () => void update({ sidePaneOpen: !useSettings.getState().settings.sidePaneOpen }),
      },
      ...settingsPages,
      {
        id: 'app:theme',
        label: dark ? 'Switch theme to light' : 'Switch theme to dark',
        group: 'Application',
        icon: dark ? Sun : Moon,
        keywords: ['appearance', 'dark mode'],
        run: () => void update({ theme: dark ? 'light' : 'dark' }),
      },
      {
        id: 'app:reconnect',
        label: 'Reconnect to Band',
        group: 'Application',
        icon: RefreshCw,
        keywords: ['daemon', 'offline'],
        run: () => void reconnect(),
      },
      {
        id: 'app:new-window-room',
        label: 'Assign work',
        group: 'Application',
        icon: SquarePen,
        keywords: ['task', 'new room'],
        run: () => void navigate({ to: '/' }),
      },
    ]
  }, [navigate, router, settings.theme, update, setPaletteOpen, reconnect, inbox, sessions, inRoom, askFind])
}

/** One command of the registry, for a button that shows its label and shortcut and runs it. */
export function commandById(commands: Command[], id: string): Command {
  const command = commands.find((item) => item.id === id)
  if (!command) throw new Error(`no command ${id}`)
  return command
}

/** Whether a keyboard event is one of a command's shortcuts. `mod` is Ctrl, or Cmd on macOS. */
export function matchesKeys(event: KeyboardEvent, keys: KeyMatch[] | undefined, mac: boolean): boolean {
  if (!keys) return false
  const inField =
    event.target instanceof HTMLElement &&
    (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))
  return keys.some((match) => {
    const mod = mac ? event.metaKey : event.ctrlKey
    if (event.key.toLowerCase() !== match.key) return false
    if (Boolean(match.mod) !== mod || Boolean(match.alt) !== event.altKey || Boolean(match.shift) !== event.shiftKey) {
      return false
    }
    if (match.outsideFields && inField) return false
    return true
  })
}
