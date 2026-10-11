import { Outlet, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect } from 'react'
import { matchesKeys, useCommands } from '@/commands/use-commands'
import { CommandPalette } from '@/components/shell/command-palette'
import { DaemonBanner } from '@/components/shell/daemon-banner'
import { SidePane } from '@/components/shell/side-pane'
import { Sidebar } from '@/components/shell/sidebar'
import { TitleBar } from '@/components/shell/title-bar'
import { isMac } from '@/lib/platform'
import { applyAppearance } from '@/lib/theme'
import { useNarrowWindow } from '@/lib/use-narrow'
import { cn } from '@/lib/utils'
import { useDaemon } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'

/**
 * ZCode's window, with Jam inside (docs/DESIGN.md, "Anatomy"): the sidebar on the canvas, then the main area with its
 * title bar, the connection banner, the page and the side pane.
 */
export function AppShell() {
  const settings = useSettings((state) => state.settings)
  const inSettings = useRouterState({ select: (state) => state.location.pathname.startsWith('/settings') })
  const narrow = useNarrowWindow()
  const drawerWanted = useUi((state) => state.drawerOpen)
  const setDrawerOpen = useUi((state) => state.setDrawerOpen)
  const drawerOpen = narrow && drawerWanted
  // A wide window keeps the sidebar in the layout, open or folded to Jam's rail; a narrow one lays it over the page as a
  // drawer.
  const railed = !narrow && !settings.sidebarOpen
  useAppearance()
  useShortcuts()
  useProfileRefresh()
  useWideWindowClosesDrawer(narrow)
  const hideDrawer = useCallback(() => setDrawerOpen(false), [setDrawerOpen])
  useEscapeCloses(drawerOpen, hideDrawer)
  const sidebar = <Sidebar mode={inSettings ? 'settings' : 'workspace'} drawer={narrow ? { open: drawerOpen } : null} />

  return (
    <div className="relative flex h-full bg-canvas">
      {narrow ? null : sidebar}
      <section
        aria-label="Main"
        // Behind an open drawer the page is out of reach, as behind a dialog.
        inert={drawerOpen}
        className={cn(
          'relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background',
          !narrow && 'border-l border-line',
        )}
      >
        <TitleBar cluster={narrow ? 'drawer' : railed ? 'history' : 'none'} />
        <DaemonBanner />
        <div className="flex min-h-0 flex-1">
          {/* A page that scrolls its own parts (a room: its header and composer stay while its conversation scrolls)
              fills this area exactly, so the area neither scrolls nor keeps a scrollbar gutter beside the page's own. */}
          <main className="min-w-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto has-[>[data-scroll=own]]:[scrollbar-gutter:auto] has-[>[data-scroll=own]]:overflow-y-hidden">
            <Outlet />
          </main>
          <SidePane />
        </div>
      </section>
      {/*
        The drawer and its backdrop come after the page: the window's drag regions follow document order, not stacking,
        so only there do a real mouse's presses on them win over the title bar's drag region beneath.
      */}
      {drawerOpen ? (
        <button
          type="button"
          aria-hidden="true"
          aria-label="Hide rooms"
          tabIndex={-1}
          className="absolute inset-0 z-30 animate-in bg-backdrop duration-200 fade-in-0 no-drag"
          onClick={hideDrawer}
        />
      ) : null}
      {narrow ? sidebar : null}
      <CommandPalette />
    </div>
  )
}

/**
 * The theme (the setting, or the system's for Auto) and the interface text size, on <html> where every token reads
 * them, kept current as either changes or the system switches between light and dark.
 */
function useAppearance() {
  const { theme, uiFontSize, chatFontSize } = useSettings((state) => state.settings)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => applyAppearance(theme, uiFontSize, chatFontSize)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme, uiFontSize, chatFontSize])
}

/**
 * Global shortcuts, every one from the command list. A shortcut pressed while the palette is open closes it first, so
 * the palette never stays over the page it just changed.
 */
function useShortcuts() {
  const commands = useCommands()
  useEffect(() => {
    const mac = isMac()
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      const command = commands.find((item) => matchesKeys(event, item.keys, mac))
      if (!command) return
      event.preventDefault()
      const ui = useUi.getState()
      if (ui.paletteOpen && command.id !== 'search') ui.setPaletteOpen(false)
      command.run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commands])
}

/** A window that turns wide closes the drawer, so it never comes back unasked when the window narrows again. */
function useWideWindowClosesDrawer(narrow: boolean) {
  useEffect(() => {
    const ui = useUi.getState()
    if (!narrow && ui.drawerOpen) ui.setDrawerOpen(false)
  }, [narrow])
}

/**
 * Escape closes the open drawer while focus is in it, or nowhere (a focused row that went away leaves it on the page's
 * body). It hears the key first, so a stray popup cannot swallow it (a
 * tooltip whose trigger the drawer covered before the tooltip's delay ran out stayed open and took the key); a dialog or
 * menu open over the drawer holds focus outside it and keeps the key for itself.
 */
function useEscapeCloses(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      const drawer = document.querySelector('aside[data-drawer]')
      const inDrawer =
        event.target instanceof Node && (drawer?.contains(event.target) || event.target === document.body)
      if (event.key === 'Escape' && inDrawer) close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, close])
}

/** The screens show the profile chosen in Settings; reading again when it changes. */
function useProfileRefresh() {
  const profile = useSettings((state) => state.settings.profile)
  const refresh = useDaemon((state) => state.refresh)
  useEffect(() => {
    void refresh(profile)
  }, [profile, refresh])
}
