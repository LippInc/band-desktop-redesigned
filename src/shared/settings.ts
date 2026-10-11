/** Light and dark (ZCode's, or the system's pick of them), and Jam: Jam Desktop's own dark theme (docs/DESIGN.md). */
export const THEME_PREFERENCES = ['system', 'light', 'dark', 'jam'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** Jam's three app font sizes (Settings, Appearance), as interface text sizes in px. */
export const APP_FONT_SIZES = { small: 12, default: 14, large: 16 } as const

/**
 * Jam's six chat font sizes (Settings, Appearance), as multipliers of the app font size. Jam's own line
 * says this one scales the conversation and nothing else, so it is a factor over the interface size
 * rather than a size of its own: raising the app size raises the conversation with it, as Jam's does.
 */
export const CHAT_FONT_SIZES = {
  small: 0.875,
  default: 1,
  large: 1.125,
  larger: 1.25,
  'extra large': 1.5,
  maximum: 1.75,
} as const
export type ChatFontSize = keyof typeof CHAT_FONT_SIZES
export const CHAT_FONT_SIZE_NAMES = Object.keys(CHAT_FONT_SIZES) as ChatFontSize[]

/** This app's own preferences, kept in settings.db. Everything about Jam itself lives in the Jam daemon. */
export interface Settings {
  theme: ThemePreference
  /** Interface text size in px. Icons and layout dimensions stay fixed. */
  uiFontSize: number
  /** How much larger the conversation is than the rest of the interface (Jam: Chat font size). */
  chatFontSize: ChatFontSize
  sidebarOpen: boolean
  sidebarWidth: number
  sidePaneOpen: boolean
  sidePaneWidth: number
  /** The Jam account profile the screens show (Jam: "Home shows information for the selected account only"). */
  profile: string
}

export type SettingsPatch = Partial<Settings>

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  // The app opens in Dark, ZCode's dark in BAND's green: the look this app is built around shows first. Auto (the
  // system's light or dark) and Jam Desktop's own colours are one choice away in Appearance (docs/DESIGN.md, "What this app uses").
  theme: 'dark',
  uiFontSize: 14,
  chatFontSize: 'default',
  sidebarOpen: true,
  sidebarWidth: 264,
  sidePaneOpen: false,
  sidePaneWidth: 400,
  profile: 'default',
})

export const SETTINGS_LIMITS = {
  uiFontSize: { min: 12, max: 18 },
  sidebarWidth: { min: 200, max: 480 },
  sidePaneWidth: { min: 320, max: 720 },
} as const

/** A Jam profile name, as the daemon's accounts list reports it. */
export const PROFILE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsValidationError'
  }
}

export function isSettingsKey(key: string): key is keyof Settings {
  return (SETTINGS_KEYS as string[]).includes(key)
}

function clamp(value: number, { min, max }: { min: number; max: number }): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function validateValue<K extends keyof Settings>(key: K, value: unknown): Settings[K] {
  switch (key) {
    case 'theme':
      if (typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)) {
        return value as Settings[K]
      }
      break
    case 'uiFontSize':
    case 'sidebarWidth':
    case 'sidePaneWidth':
      if (typeof value === 'number' && Number.isFinite(value)) {
        return clamp(value, SETTINGS_LIMITS[key as keyof typeof SETTINGS_LIMITS]) as Settings[K]
      }
      break
    case 'sidebarOpen':
    case 'sidePaneOpen':
      if (typeof value === 'boolean') return value as Settings[K]
      break
    case 'chatFontSize':
      if (typeof value === 'string' && (CHAT_FONT_SIZE_NAMES as readonly string[]).includes(value)) {
        return value as Settings[K]
      }
      break
    case 'profile':
      if (typeof value === 'string' && PROFILE_PATTERN.test(value)) return value as Settings[K]
      break
  }
  throw new SettingsValidationError(`Invalid value for setting "${key}": ${JSON.stringify(value)}`)
}

/**
 * Validates a patch that crossed a trust boundary (IPC, storage). Unknown keys and wrong types throw; numbers are clamped
 * to their limits.
 */
export function sanitizeSettingsPatch(input: unknown): SettingsPatch {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new SettingsValidationError('A settings patch must be a plain object')
  }
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!isSettingsKey(key)) throw new SettingsValidationError(`Unknown setting "${key}"`)
    patch[key] = validateValue(key, value)
  }
  return patch as SettingsPatch
}

/** Builds complete settings from stored values. Anything missing or invalid falls back to its default. */
export function resolveSettings(stored: Readonly<Record<string, unknown>>): Settings {
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of SETTINGS_KEYS) {
    if (!(key in stored)) continue
    try {
      settings[key] = validateValue(key, stored[key])
    } catch {
      // keep the default for a corrupt or outdated value
    }
  }
  return settings as unknown as Settings
}
