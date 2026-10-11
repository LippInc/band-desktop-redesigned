import {
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Contact,
  Cpu,
  FlaskConical,
  House,
  Inbox,
  Info,
  MessagesSquare,
  Palette,
  Plug,
  Radar,
  ScrollText,
  SlidersHorizontal,
  TerminalSquare,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { SECTION_EXPERIMENTS } from '@shared/daemon'

/**
 * Jam's desktop sections (user guide, "Find the desktop sections"), in one place: the sidebar, the palette, the router
 * and the tests all read this list. Names, order and grouping are Jam's desktop sidebar's, seen with its two section
 * experiments on (2026-09-20): Home, Agents, Analytics at the top, then its Network group, then its Advanced group with
 * Sessions, and Inbox at the foot above Documentation. Band Desktop 0.4.14 added Teams, after Agents. `group` places a
 * section in ZCode's sidebar anatomy
 * (docs/DESIGN.md, "Sidebar"), with the room list where ZCode keeps its tasks.
 */
export type SectionId =
  'home' | 'rooms' | 'agents' | 'teams' | 'inbox' | 'sessions' | 'analytics' | 'contacts' | 'sonar' | 'documentation'

export interface Section {
  id: SectionId
  label: string
  /**
   * The line under the page's title, where Jam Desktop has one. Only Contacts has one: Agents and Sonar show their
   * title alone, and Home, Analytics and Documentation open straight into their content with no page title.
   */
  description?: string
  icon: LucideIcon
  path: string
  group: 'daily' | 'rooms' | 'network' | 'advanced' | 'more'
  /** Shown only while this experiment is on, as in the official app. */
  experiment?: string
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'home',
    label: 'Home',
    icon: House,
    path: '/',
    group: 'daily',
  },
  {
    id: 'rooms',
    label: 'Rooms',
    icon: MessagesSquare,
    path: '/rooms',
    group: 'rooms',
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: Bot,
    path: '/agents',
    group: 'daily',
  },
  {
    id: 'teams',
    label: 'Teams',
    icon: UsersRound,
    path: '/teams',
    group: 'daily',
  },
  {
    id: 'inbox',
    label: 'Inbox',
    icon: Inbox,
    path: '/inbox',
    group: 'more',
    experiment: SECTION_EXPERIMENTS.inbox,
  },
  {
    id: 'sessions',
    label: 'Sessions',
    // Jam Desktop's own line under Sessions, seen with its experiment on.
    description: 'Current host sessions across your local agents — room, process, binding, and Band state.',
    icon: TerminalSquare,
    path: '/sessions',
    group: 'advanced',
    experiment: SECTION_EXPERIMENTS.sessions,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    path: '/analytics',
    group: 'daily',
  },
  {
    id: 'sonar',
    label: 'Sonar',
    icon: Radar,
    path: '/sonar',
    group: 'network',
  },
  {
    id: 'contacts',
    label: 'Contacts',
    // Jam Desktop's own line under Contacts; its other sections show their title alone.
    description: 'Manage the people and agents your account can contact on Band.',
    icon: Contact,
    path: '/contacts',
    group: 'network',
  },
  {
    id: 'documentation',
    label: 'Documentation',
    icon: BookOpen,
    path: '/documentation',
    group: 'more',
  },
]

export function sectionById(id: SectionId): Section {
  const section = SECTIONS.find((item) => item.id === id)
  if (!section) throw new Error(`no section ${id}`)
  return section
}

/**
 * Jam's Settings pages (user guide, "Settings"), in its order. A page shows its title and then its groups, each with
 * its own note, as Jam Desktop's do: no page carries a line of its own under its title.
 */
export const SETTINGS_SECTIONS: readonly {
  id: SettingsSectionId
  label: string
  icon: LucideIcon
}[] = [
  { id: 'account', label: 'Account', icon: UserRound },
  {
    id: 'general',
    label: 'General',
    icon: SlidersHorizontal,
  },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: Plug,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
  },
  {
    id: 'runtime',
    label: 'Runtime',
    icon: Cpu,
  },
  {
    id: 'logs',
    label: 'Logs',
    icon: ScrollText,
  },
  {
    id: 'experiments',
    label: 'Experiments',
    icon: FlaskConical,
  },
  { id: 'learn-more', label: 'Learn more', icon: Info },
]

export type SettingsSectionId =
  | 'account'
  | 'general'
  | 'appearance'
  | 'integrations'
  | 'notifications'
  | 'runtime'
  | 'logs'
  | 'experiments'
  | 'learn-more'
