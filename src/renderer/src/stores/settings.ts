import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '@shared/settings'
import { jam } from '@/lib/platform'

interface SettingsState {
  settings: Settings
  loaded: boolean
  load(): Promise<void>
  update(patch: SettingsPatch): Promise<void>
}

/** This app's own preferences (settings.db in the main process), mirrored for the page. */
export const useSettings = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  load: async () => {
    const api = jam()
    if (!api) return set({ loaded: true })
    set({ settings: await api.settings.getAll(), loaded: true })
    api.settings.onChange((settings) => set({ settings }))
  },
  update: async (patch) => {
    const api = jam()
    // Optimistic, so a toggle feels instant; the main process's answer (validated, clamped) wins.
    set({ settings: { ...get().settings, ...patch } })
    if (api) set({ settings: await api.settings.update(patch) })
  },
}))
