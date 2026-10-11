import { useSyncExternalStore } from 'react'

/**
 * A narrow window: the room list then opens as a drawer over the page instead of taking room beside it (user guide, "Find
 * the desktop sections": "On a narrow window, the room list can appear as a drawer over the room").
 */
export const NARROW_WINDOW = '(max-width: 767px)'

export const isNarrowWindow = (): boolean => typeof window !== 'undefined' && window.matchMedia(NARROW_WINDOW).matches

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(NARROW_WINDOW)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** Whether the window is narrow now, following it as it is resized. */
export function useNarrowWindow(): boolean {
  return useSyncExternalStore(subscribe, isNarrowWindow, () => false)
}
