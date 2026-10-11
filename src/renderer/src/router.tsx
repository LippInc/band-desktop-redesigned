import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/shell/app-shell'
import { AgentsPage } from '@/pages/agents'
import { AnalyticsPage } from '@/pages/analytics'
import { ContactsPage } from '@/pages/contacts'
import { DocumentationPage } from '@/pages/documentation'
import { HomePage } from '@/pages/home'
import { InboxPage } from '@/pages/inbox'
import { RoomPage } from '@/pages/room'
import { RoomsPage } from '@/pages/rooms'
import { SessionsPage } from '@/pages/sessions'
import { SettingsPage } from '@/pages/settings/settings-page'
import { SonarPage } from '@/pages/sonar'
import { TeamsPage } from '@/pages/teams'
import { SETTINGS_SECTIONS } from '@/lib/sections'

// Hash history: the app is served from app://jam-redesign/index.html, so the route lives in the fragment.
const rootRoute = createRootRoute({ component: AppShell })

const home = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage })
const rooms = createRoute({ getParentRoute: () => rootRoute, path: '/rooms', component: RoomsPage })
const room = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms/$roomId',
  // Chat unless the link asks for Work (Home opens a room's Work view: user guide, "Follow active work").
  validateSearch: (search: Record<string, unknown>): { view?: 'work' } =>
    search.view === 'work' ? { view: 'work' } : {},
  component: RoomPage,
})
const agents = createRoute({ getParentRoute: () => rootRoute, path: '/agents', component: AgentsPage })
const teams = createRoute({ getParentRoute: () => rootRoute, path: '/teams', component: TeamsPage })
const inbox = createRoute({ getParentRoute: () => rootRoute, path: '/inbox', component: InboxPage })
const sessions = createRoute({ getParentRoute: () => rootRoute, path: '/sessions', component: SessionsPage })
const analytics = createRoute({ getParentRoute: () => rootRoute, path: '/analytics', component: AnalyticsPage })
const contacts = createRoute({ getParentRoute: () => rootRoute, path: '/contacts', component: ContactsPage })
const sonar = createRoute({ getParentRoute: () => rootRoute, path: '/sonar', component: SonarPage })
const documentation = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documentation',
  component: DocumentationPage,
})
const settingsIndex = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: () => {
    // Jam's Settings opens on Account unless something sends it to another page.
    throw redirect({ to: '/settings/$section', params: { section: 'account' } })
  },
})
const settings = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$section',
  beforeLoad: ({ params }) => {
    if (!SETTINGS_SECTIONS.some((page) => page.id === params.section)) {
      throw redirect({ to: '/settings/$section', params: { section: 'account' } })
    }
  },
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  home,
  rooms,
  room,
  agents,
  teams,
  inbox,
  sessions,
  analytics,
  contacts,
  sonar,
  documentation,
  settingsIndex,
  settings,
])

export const router = createRouter({ routeTree, history: createHashHistory() })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
