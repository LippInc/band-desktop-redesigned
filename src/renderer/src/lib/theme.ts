import { CHAT_FONT_SIZES, type ChatFontSize, type ThemePreference } from '@shared/settings'

/** The theme a page shows: the setting itself, or for Auto the system's light or dark. */
export function resolveTheme(theme: ThemePreference): 'light' | 'dark' | 'jam' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Puts the theme and the text sizes on <html>, where every token reads them. The app size is written
 * twice: once as the size in force, and once as the size the conversation multiplies, so that raising
 * the app size raises the conversation with it while Chat font size scales only the conversation.
 */
export function applyAppearance(theme: ThemePreference, uiFontSize: number, chatFontSize: ChatFontSize): void {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(theme)
  root.style.setProperty('--ui-font-size', `${uiFontSize}px`)
  root.style.setProperty('--app-font-size', `${uiFontSize}px`)
  root.style.setProperty('--chat-font-scale', String(CHAT_FONT_SIZES[chatFontSize] ?? 1))
}
