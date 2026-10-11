import { ChevronDown } from 'lucide-react'
import { useCommands, type Command } from '@/commands/use-commands'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { shortcutLabel } from '@/lib/platform'

const MENU: (string | '-')[] = [
  'search',
  'go:home',
  '-',
  'panels:sidebar',
  'panels:side-pane',
  '-',
  'settings:account',
  'go:documentation',
  'app:theme',
  '-',
  'app:reconnect',
]

/** The chevron at the end of the title bar's cluster, where ZCode keeps its window menu. Items come from the command list. */
export function AppMenu() {
  const commands = useCommands()
  const byId = new Map(commands.map((command) => [command.id, command]))
  const items = MENU.map((id) => (id === '-' ? id : byId.get(id))).filter((item): item is Command | '-' =>
    Boolean(item),
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="App menu"
        className="inline-flex h-12 w-[45px] items-center justify-center text-foreground transition-colors outline-none no-drag hover:bg-hover data-popup-open:bg-selected [&_svg]:size-4"
      >
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {items.map((item, index) =>
          item === '-' ? (
            <DropdownMenuSeparator key={`separator-${index}`} />
          ) : (
            <DropdownMenuItem key={item.id} onClick={() => item.run()}>
              <item.icon className="text-foreground-subtle" />
              {item.id === 'settings:account' ? 'Settings' : item.label}
              {item.shortcut ? <DropdownMenuShortcut>{shortcutLabel(item.shortcut)}</DropdownMenuShortcut> : null}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
