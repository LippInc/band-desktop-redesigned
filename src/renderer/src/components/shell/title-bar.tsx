import { PanelRight, SquarePen } from 'lucide-react'
import { commandById, useCommands } from '@/commands/use-commands'
import { AppMenu } from '@/components/shell/app-menu'
import { IconButton, TitleBarButton } from '@/components/shell/icon-button'
import { SidebarTopRow } from '@/components/shell/sidebar'
import { cn } from '@/lib/utils'
import { useSettings } from '@/stores/settings'
import { useTitleSlot } from '@/stores/title'

/**
 * ZCode's title bar (docs/DESIGN.md, "Title bar"): 48 tall over the main area and side pane, empty space drags the window,
 * the right cluster is 45×48 buttons, and the native caption buttons keep their 136 on Windows (titlebar-safe-right).
 * While the sidebar is not beside the page, history and a new-work button move to its left end, as ZCode's do: beside
 * the rail of a folded sidebar (`history`), and after Jam's Toggle sidebar on a narrow window, where it opens the drawer
 * (`drawer`). Its buttons run the command registry's commands and show their shortcuts.
 */
export function TitleBar({ cluster }: { cluster: 'none' | 'history' | 'drawer' }) {
  const sidePaneOpen = useSettings((state) => state.settings.sidePaneOpen)
  const node = useTitleSlot((state) => state.node)
  const commands = useCommands()
  const home = commandById(commands, 'go:home')
  const sidePane = commandById(commands, 'panels:side-pane')

  return (
    <header
      className={cn(
        'relative flex h-12 shrink-0 items-center border-b titlebar-safe-right transition-[padding] duration-300 drag-region',
        sidePaneOpen ? 'border-line' : 'border-transparent',
      )}
    >
      {cluster !== 'none' ? (
        <div className="flex items-center">
          <SidebarTopRow
            className="pr-0"
            slot={cluster === 'history' ? 'window-start-after-rail' : 'window-start'}
            start={cluster === 'drawer' ? 'toggle' : 'none'}
            end="none"
          />
          {/* Assigning work starts on Home, so this is Home's command under Jam's name for it. */}
          <IconButton label="Assign work" shortcut={home.shortcut} className="no-drag" onClick={home.run}>
            <SquarePen />
          </IconButton>
        </div>
      ) : null}
      <div className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-hidden pl-4">{node}</div>
      <div className="flex h-full shrink-0 items-center">
        <TitleBarButton
          label={sidePaneOpen ? 'Collapse side pane' : 'Expand side pane'}
          shortcut={sidePane.shortcut}
          active={sidePaneOpen}
          onClick={sidePane.run}
        >
          <PanelRight />
        </TitleBarButton>
        <div aria-hidden="true" className="h-full w-px bg-line" />
        <AppMenu />
      </div>
    </header>
  )
}
