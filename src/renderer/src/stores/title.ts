import { useEffect, type ReactNode } from 'react'
import { create } from 'zustand'

/** What a page shows at the left of the title bar (a room's title and actions, as ZCode shows a task's). */
export const useTitleSlot = create<{ node: ReactNode }>(() => ({ node: null }))

export function useTitleBar(node: ReactNode, deps: unknown[]): void {
  useEffect(() => {
    useTitleSlot.setState({ node })
    return () => useTitleSlot.setState({ node: null })
    // oxlint-disable-next-line react/exhaustive-deps -- the caller names what the node depends on
  }, deps)
}
