import { useParams } from '@tanstack/react-router'
import { ExternalLink, Monitor, Moon, Palette, Sun } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { LogConfig, NotificationPreferences, RuntimeDefaults } from '@shared/daemon'
import { APP_FONT_SIZES, CHAT_FONT_SIZE_NAMES, type ChatFontSize, type ThemePreference } from '@shared/settings'
import { ComingNote, Page, PageSection, SettingsCard, SettingsRow } from '@/components/page'
import { unavailableText } from '@/components/room/unavailable'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { jam } from '@/lib/platform'
import { AGENT_DEFAULTS_NOTE, runtimeRows } from '@/lib/runtime'
import { cn } from '@/lib/utils'
import { SETTINGS_SECTIONS, type SettingsSectionId } from '@/lib/sections'
import { useAccount, useDaemon, useShellPart } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'

/** Jam's Settings (user guide, "Settings") in ZCode's settings frame: the page's title over its groups of rows. */
export function SettingsPage() {
  const { section } = useParams({ from: '/settings/$section' })
  const page = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]!
  return (
    <Page variant="settings" title={page.label}>
      <SettingsBody id={page.id} />
    </Page>
  )
}

function SettingsBody({ id }: { id: SettingsSectionId }) {
  switch (id) {
    case 'account':
      return <AccountSettings />
    case 'general':
      return <GeneralSettings />
    case 'appearance':
      return <AppearanceSettings />
    case 'notifications':
      return <NotificationSettings />
    case 'logs':
      return <LogSettings />
    case 'experiments':
      return <ExperimentSettings />
    case 'learn-more':
      return <LearnMore />
    case 'integrations':
      return <IntegrationSettings />
    case 'runtime':
      return <RuntimeSettings />
  }
}

/** A daemon read for a settings page: null while loading or unavailable. */
function useRead<T>(read: (api: NonNullable<ReturnType<typeof jam>>) => Promise<T>): T | null {
  const connected = useDaemon((state) => state.status.state === 'connected')
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    const api = jam()
    if (!api || !connected) return
    let current = true
    read(api)
      .then((data) => current && setValue(data))
      .catch(() => current && setValue(null))
    return () => {
      current = false
    }
    // oxlint-disable-next-line react/exhaustive-deps -- each caller passes a fixed read
  }, [connected])
  return value
}

function AccountSettings() {
  const profile = useSettings((state) => state.settings.profile)
  const account = useAccount(profile)
  const identity = account?.identity
  return (
    <PageSection title="Band deployment">
      <SettingsCard>
        <SettingsRow
          label={
            identity
              ? [identity.first_name, identity.last_name].filter(Boolean).join(' ') || identity.handle
              : 'No account'
          }
          description={
            identity
              ? [identity.handle && `@${identity.handle}`, identity.email].filter(Boolean).join(' · ')
              : 'Sign in with the official Band app.'
          }
          control={
            <span className="text-ui-base text-foreground-subtle">
              {account ? (account.signed_in ? 'Connected' : 'Needs sign-in') : ''}
            </span>
          }
        />
        <SettingsRow
          label="Sign-in and sign-out"
          description="Signing in, signing out and removing local data stay in the official Band app."
        />
      </SettingsCard>
    </PageSection>
  )
}

function GeneralSettings() {
  const status = useDaemon((state) => state.status)
  const appInfo = useDaemon((state) => state.appInfo)
  const discovery = useRead((api) => api.daemon.discovered())

  return (
    <>
      <PageSection title="Version & CLI">
        <SettingsCard>
          <SettingsRow
            label={appInfo?.name ?? 'This app'}
            description="A redesigned front end for Band."
            control={<Mono>{appInfo?.version ?? ''}</Mono>}
          />
          <SettingsRow
            label="Band daemon"
            description={
              appInfo
                ? `Built against Band ${appInfo.builtAgainst.daemonVersion} (protocol ${appInfo.builtAgainst.wire}).`
                : undefined
            }
            control={
              <Mono>
                {status.state === 'connected'
                  ? `${status.version} · protocol ${status.wire ?? 'not stated'}`
                  : 'Not connected'}
              </Mono>
            }
          />
        </SettingsCard>
      </PageSection>
      <PageSection
        title="LAN discovery"
        note="These expose your Band presence, room names and cost to nearby users. Turning one on or off changes the daemon's own setting, which stays in the official app."
      >
        <SettingsCard>
          <SettingsRow
            label="Discoverable"
            description="Whether nearby Band users can see this installation."
            control={<ReadOnlySwitch checked={discovery?.discoverable} />}
          />
          <SettingsRow
            label="Share room names"
            description="Nearby users see room titles, not only who is in them."
            control={<ReadOnlySwitch checked={discovery?.share_room_titles} />}
          />
          <SettingsRow
            label="Share usage estimate"
            description="Nearby users see per-agent and per-room cost."
            control={<ReadOnlySwitch checked={discovery?.share_cost} />}
          />
        </SettingsCard>
      </PageSection>
    </>
  )
}

function NotificationSettings() {
  const read = useRead<NotificationPreferences>((api) => api.daemon.notificationPreferences())
  /**
   * What a switch has been moved to, remembered against the read it was moved from. A fresh read wins: without that,
   * one touched switch would mask every later read for the life of the screen, and a reconnect would show what was
   * on screen before the daemon went away rather than what Jam holds now.
   */
  const [changed, setChanged] = useState<{ from: NotificationPreferences | null; set: NotificationPreferences } | null>(
    null,
  )
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const preferences = changed && changed.from === read ? changed.set : read

  /**
   * The daemon takes the whole set at once, so what is sent is the set just read with one switch moved. The switch
   * shows the new position straight away, and whatever happens the set is read back afterwards, so what is on screen
   * is what Jam holds rather than what this app hoped for.
   *
   * One write at a time: two in flight would each carry the other's switch at the value it had before, and whichever
   * answered last would decide - leaving the screen showing a set nobody had asked for.
   */
  const set = (part: Partial<NotificationPreferences>) => {
    const api = jam()
    if (!api || !preferences || sending) return
    const before = preferences
    setSending(true)
    setChanged({ from: read, set: { ...preferences, ...part } })
    setProblem(null)
    api.daemon
      .setNotifications({ ...preferences, ...part })
      .catch(() => setProblem('Band did not take that. Nothing changed.'))
      .finally(() => {
        // Read it back either way: after a refusal to undo the switch, after a success to pick up what Jam stored
        // (its `version` among it, which the next write has to carry).
        api.daemon
          .notificationPreferences()
          .then((fresh) => setChanged({ from: read, set: fresh }))
          // If the read back fails too, nothing is known to have changed, so the switch goes back where it was
          // rather than sitting on a setting that was never stored.
          .catch(() => setChanged(before === null ? null : { from: read, set: before }))
          .finally(() => setSending(false))
      })
  }

  return (
    <PageSection
      title="Notification categories"
      note="These settings apply to this Band installation. The operating system's permission still applies: a switch here cannot override one the system has blocked."
    >
      <SettingsCard>
        <SettingsRow
          label="Direct mentions"
          control={
            <Switch
              aria-label="Direct mentions"
              disabled={!preferences || sending}
              checked={preferences?.direct_mentions ?? false}
              onCheckedChange={(on) => set({ direct_mentions: on === true })}
            />
          }
        />
        <SettingsRow
          label="Human requests"
          description="Questions and permission requests."
          control={
            <Switch
              aria-label="Human requests"
              disabled={!preferences || sending}
              checked={preferences?.human_requests ?? false}
              onCheckedChange={(on) => set({ human_requests: on === true })}
            />
          }
        />
        {/* Jam chooses this one from a list. Which options that list holds has never been seen - a capture never
            opens a combo box - so it is shown as it stands rather than with a list this app invented
            (`docs/jam/differences.md`). */}
        <SettingsRow
          label="Task updates"
          description="Which task state changes send notifications."
          control={
            <span className="text-ui-base text-foreground-subtle">
              {preferences ? taskUpdates(preferences.task_updates) : ''}
            </span>
          }
        />
        {problem ? <SettingsRow label={problem} /> : null}
      </SettingsCard>
    </PageSection>
  )
}

function taskUpdates(value: string): string {
  if (value === 'completed_only') return 'Completed only'
  return value.replace(/_/g, ' ')
}

function LogSettings() {
  const config = useRead<LogConfig>((api) => api.daemon.logConfig())
  return (
    <>
      <PageSection
        title="Logging"
        note="Control how much the local daemon records. A finer level helps diagnose problems; it takes effect the next time the daemon starts."
      >
        <SettingsCard>
          <SettingsRow
            label="Daemon log level"
            description="Higher levels record more. Debug and trace are verbose."
            control={<Mono>{config?.level ?? ''}</Mono>}
          />
        </SettingsCard>
      </PageSection>
      <ComingNote>
        Changing the level writes to the daemon on this computer, which stays in the official app, and so does viewing
        the daemon and desktop logs.
      </ComingNote>
    </>
  )
}

function ExperimentSettings() {
  // Through the shell's own reading, so experiments never read while Jam is away say so rather than loading forever.
  const experiments = useShellPart('experiments')
  if (experiments.state !== 'ready') {
    // Why, as every other part says it; and while they are still being read, that, not "unavailable".
    return (
      <p className="text-ui-base text-foreground-subtle">
        {experiments.state === 'unavailable'
          ? `Experiments are unavailable right now. ${unavailableText('Experiments', experiments.reason)}`
          : 'Loading experiments…'}
      </p>
    )
  }
  return (
    <>
      <PageSection note="Optional features you can turn on. Each one is off by default, and it can change or be removed in a later release.">
        <SettingsCard>
          {experiments.data.experiments.map((experiment) => (
            <SettingsRow
              key={experiment.key}
              label={experiment.title}
              description={experiment.description}
              control={<ReadOnlySwitch checked={experiment.state === 'enabled'} label={experiment.title} />}
            />
          ))}
        </SettingsCard>
      </PageSection>
      <ComingNote>
        Turning an experiment on or off changes the daemon's own setting, which stays in the official app.
      </ComingNote>
    </>
  )
}

function LearnMore() {
  return (
    <>
      <PageSection title="Band">
        <SettingsCard>
          <SettingsRow
            label="Band"
            description="The platform Band Desktop connects to."
            control={<LinkButton onClick={() => openLink('https://band.ai/')}>band.ai</LinkButton>}
          />
          <SettingsRow
            label="Documentation"
            control={<LinkButton onClick={() => openLink('https://docs.band.ai/')}>docs.band.ai</LinkButton>}
          />
        </SettingsCard>
      </PageSection>
      <PageSection title="About this app">
        <SettingsCard>
          <SettingsRow
            label="Band Desktop, redesigned"
            description="It runs on the Band daemon (jamd) already on this computer. The official Band Desktop stays installed and does everything this app does not do yet."
          />
        </SettingsCard>
      </PageSection>
    </>
  )
}

/** Jam's theme names, in its order (Light, Dark, Auto), then the Jam theme; Auto is the system's choice. */
const THEME_LABELS: Record<ThemePreference, { label: string; icon: typeof Sun }> = {
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
  system: { label: 'Auto', icon: Monitor },
  jam: { label: 'Band', icon: Palette },
}
const THEME_ORDER = Object.keys(THEME_LABELS) as ThemePreference[]

/** A theme with its icon, as ZCode's theme select shows it. */
function ThemeLabel({ theme }: { theme: ThemePreference }) {
  const { label, icon: Icon } = THEME_LABELS[theme] ?? THEME_LABELS.system
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-4" />
      {label}
    </span>
  )
}

/** Jam's three app font sizes; a size stored from before them shows as its number. */
const FONT_SIZE_LABELS: Record<number, string> = {
  [APP_FONT_SIZES.small]: 'Small',
  [APP_FONT_SIZES.default]: 'Default',
  [APP_FONT_SIZES.large]: 'Large',
}

/**
 * Jam's Appearance page (Jam Desktop 0.4.10) in ZCode's settings card: the theme, with Jam's own words for it, and the app
 * font size in Jam's three steps. Here the size scales the interface's text only, as ZCode's type scale does (Jam's
 * scales everything: docs/jam/differences.md), and Jam's chat font size scales the conversation and nothing else.
 */
function AppearanceSettings() {
  const settings = useSettings((state) => state.settings)
  const update = useSettings((state) => state.update)
  return (
    <SettingsCard>
      <SettingsRow
        label="Theme"
        description="How Band looks on this machine."
        control={
          <Select value={settings.theme} onValueChange={(value) => void update({ theme: value as ThemePreference })}>
            <SelectTrigger aria-label="Theme">
              <SelectValue>{(value: ThemePreference) => <ThemeLabel theme={value} />}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {THEME_ORDER.map((theme) => (
                <SelectItem key={theme} value={theme}>
                  <ThemeLabel theme={theme} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsRow
        label="App font size"
        description="Scales the interface's text, including the conversation and composer."
        control={
          <Select
            value={String(settings.uiFontSize)}
            onValueChange={(value) => void update({ uiFontSize: Number(value) })}
          >
            <SelectTrigger aria-label="App font size">
              <SelectValue>{(value: string) => FONT_SIZE_LABELS[Number(value)] ?? `${value} px`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.values(APP_FONT_SIZES).map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {FONT_SIZE_LABELS[size]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsRow
        label="Chat font size"
        description="Additionally scales the conversation transcript. The room list, panels, and composer follow App font size only."
        control={
          <Select
            value={settings.chatFontSize}
            onValueChange={(value) => void update({ chatFontSize: value as ChatFontSize })}
          >
            <SelectTrigger aria-label="Chat font size">
              <SelectValue>{(value: string) => sentenceCase(value)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CHAT_FONT_SIZE_NAMES.map((name) => (
                <SelectItem key={name} value={name}>
                  {sentenceCase(name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsCard>
  )
}

/** Jam writes its size names with one capital: "Extra large", not "Extra Large". */
function sentenceCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Settings, Integrations (Jam Desktop 0.4.10, read 2026-09-20): its three coding tools, with Jam's own name and line
 * for each. Whether one is enabled is not shown, because no route this app may call reports it, and a switch drawn
 * from nothing would say "off" about an integration that is on. Enabling one is a write to the Jam install, which
 * this app never makes (`docs/jam/differences.md`).
 */
function IntegrationSettings() {
  return (
    <>
      <SettingsCard>
        {INTEGRATIONS.map((one) => (
          <SettingsRow
            key={one.label}
            label={one.label}
            description={one.description}
            control={<span className="text-ui-sm text-foreground-subtlest">In the official app</span>}
          />
        ))}
      </SettingsCard>
      <ComingNote>
        Whether each is enabled, and turning one on, stay in the official app: enabling an integration changes the Band
        install on this computer.
      </ComingNote>
    </>
  )
}

/** Jam's own three rows, in its order, with the line it writes under each. */
const INTEGRATIONS = [
  { label: 'Claude Code', description: 'Connect Claude Code sessions to Band rooms.' },
  { label: 'GitHub Copilot', description: 'Connect GitHub Copilot CLI or VS Code sessions to Band rooms.' },
  {
    label: 'Codex',
    description:
      'Show Codex app-server when creating local agents. Band enables the required experimental API automatically.',
  },
] as const

/**
 * Settings, Runtime (Jam Desktop 0.4.10, read 2026-09-20): its Agent defaults, with Jam's own label and line for
 * each and the value the account has set. Saving them writes to the Jam install, which this app does not do, so
 * Jam's Save defaults is left out rather than shown turned off (`docs/jam/differences.md`).
 */
function RuntimeSettings() {
  const defaults = useRead<RuntimeDefaults>((api) => api.daemon.runtimeDefaults())
  const rows = runtimeRows(defaults)
  return (
    <PageSection title="Agent defaults" note={AGENT_DEFAULTS_NOTE}>
      <SettingsCard>
        {rows.map((row) => (
          <SettingsRow
            key={row.key}
            label={row.label}
            description={row.help}
            control={
              <span
                className={cn(
                  'text-ui-base tabular-nums',
                  row.builtIn ? 'text-foreground-subtlest' : 'text-foreground',
                )}
              >
                {row.value}
              </span>
            }
          />
        ))}
      </SettingsCard>
      <ComingNote>
        Changing a default writes it to the Band install on this computer, which stays in the official app.
      </ComingNote>
    </PageSection>
  )
}

const openLink = (url: string) => void jam()?.shell.openExternal(url)

function LinkButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      {children}
      <ExternalLink className="text-foreground-subtle" />
    </Button>
  )
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-ui-sm text-foreground-subtle">{children}</span>
}

function ReadOnlySwitch({ checked, label }: { checked: boolean | undefined; label?: string }) {
  if (checked === undefined) return <span className="text-ui-base text-foreground-subtlest">Unknown</span>
  return <Switch checked={checked} disabled aria-label={label} />
}
