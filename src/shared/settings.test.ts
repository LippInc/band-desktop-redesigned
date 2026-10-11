import { describe, expect, it } from 'vitest'
import {
  APP_FONT_SIZES,
  CHAT_FONT_SIZE_NAMES,
  CHAT_FONT_SIZES,
  DEFAULT_SETTINGS,
  resolveSettings,
  sanitizeSettingsPatch,
  SettingsValidationError,
} from './settings'

describe('sanitizeSettingsPatch', () => {
  it('accepts valid values and clamps numbers', () => {
    expect(sanitizeSettingsPatch({ theme: 'dark', uiFontSize: 40, sidebarWidth: 10.4 })).toEqual({
      theme: 'dark',
      uiFontSize: 18,
      sidebarWidth: 200,
    })
  })

  it.each([
    [{ theme: 'sepia' }],
    [{ uiFontSize: '14' }],
    [{ chatFontSize: 'huge' }],
    [{ chatFontSize: 'Default' }],
    [{ chatFontSize: 1.5 }],
    [{ sidebarOpen: 'yes' }],
    [{ profile: '../../etc' }],
    [{ profile: '' }],
    [{ unknownKey: true }],
    [null],
    [[]],
    ['theme=dark'],
  ])('refuses %j', (patch) => {
    expect(() => sanitizeSettingsPatch(patch)).toThrow(SettingsValidationError)
  })

  it('accepts a profile name the daemon could report', () => {
    expect(sanitizeSettingsPatch({ profile: 'work-2' })).toEqual({ profile: 'work-2' })
  })

  it('accepts the Jam theme, and refuses a near miss of its name', () => {
    expect(sanitizeSettingsPatch({ theme: 'jam' })).toEqual({ theme: 'jam' })
    expect(() => sanitizeSettingsPatch({ theme: 'Jam' })).toThrow(SettingsValidationError)
  })

  it("keeps Jam's three app font sizes within the size's limits", () => {
    for (const size of Object.values(APP_FONT_SIZES)) {
      expect(sanitizeSettingsPatch({ uiFontSize: size })).toEqual({ uiFontSize: size })
    }
  })

  it("takes each of Jam's six chat font sizes by its own name", () => {
    expect(CHAT_FONT_SIZE_NAMES).toEqual(['small', 'default', 'large', 'larger', 'extra large', 'maximum'])
    for (const name of CHAT_FONT_SIZE_NAMES) {
      expect(sanitizeSettingsPatch({ chatFontSize: name })).toEqual({ chatFontSize: name })
    }
    // Each is larger than the last, and Default is the app's own size: Jam's line says this one scales the
    // conversation on top of the app size rather than replacing it.
    const scales = CHAT_FONT_SIZE_NAMES.map((name) => CHAT_FONT_SIZES[name])
    expect(scales).toEqual([...scales].sort((a, b) => a - b))
    expect(new Set(scales).size).toBe(scales.length)
    expect(CHAT_FONT_SIZES.default).toBe(1)
  })
})

describe('resolveSettings', () => {
  it('falls back to defaults for missing or corrupt values', () => {
    expect(resolveSettings({ theme: 'nonsense', uiFontSize: 16 })).toEqual({ ...DEFAULT_SETTINGS, uiFontSize: 16 })
  })

  it('opens on the conversation at the app size, and keeps a chat size they picked', () => {
    expect(resolveSettings({}).chatFontSize).toBe('default')
    expect(resolveSettings({ chatFontSize: 'maximum' }).chatFontSize).toBe('maximum')
    expect(resolveSettings({ chatFontSize: 'enormous' }).chatFontSize).toBe('default')
  })

  it('opens in Dark until the person picks another theme, and keeps a theme they picked', () => {
    expect(resolveSettings({}).theme).toBe('dark')
    expect(resolveSettings({ theme: 'system' }).theme).toBe('system')
    expect(resolveSettings({ theme: 'jam' }).theme).toBe('jam')
  })
})
