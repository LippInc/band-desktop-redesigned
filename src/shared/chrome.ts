import type { ThemePreference } from './settings'

/**
 * Native window colours (window background and the Windows caption buttons drawn by titleBarOverlay).
 * They must equal the --background and --foreground tokens in src/renderer/src/styles/globals.css;
 * src/shared/chrome.test.ts fails when the two drift apart.
 */
export const CHROME_COLORS = {
  light: { surface: '#f6f9f9', symbol: '#232728' },
  dark: { surface: '#131313', symbol: '#d7d7d7' },
  jam: { surface: '#0c1217', symbol: '#e6eaef' },
} as const

/** The window's native colours for a theme: Jam's own, or the light or dark one the setting or the system picks. */
export function chromeColorsFor(theme: ThemePreference, systemDark: boolean) {
  if (theme === 'jam') return CHROME_COLORS.jam
  return systemDark ? CHROME_COLORS.dark : CHROME_COLORS.light
}

/** Electron's nativeTheme knows light, dark and the system's choice; the Jam theme is a dark one. */
export function nativeThemeSource(theme: ThemePreference): 'system' | 'light' | 'dark' {
  return theme === 'jam' ? 'dark' : theme
}

/** Height of the title bar row, in px. Shared by the native overlay and the CSS header. */
export const TITLE_BAR_HEIGHT = 48
