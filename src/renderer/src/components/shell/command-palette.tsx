import { useNavigate } from '@tanstack/react-router'
import { List, MessagesSquare, Rocket } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useCommands, type Command as AppCommand } from '@/commands/use-commands'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { shortcutLabel } from '@/lib/platform'
import { sortRooms } from '@/lib/rooms'
import { cn } from '@/lib/utils'
import { useShellPart } from '@/stores/daemon'
import { useUi } from '@/stores/ui'

type Filter = 'all' | 'actions' | 'rooms'

const FILTERS: { id: Filter; label: string; icon: typeof List }[] = [
  { id: 'all', label: 'All', icon: List },
  { id: 'actions', label: 'Actions', icon: Rocket },
  { id: 'rooms', label: 'Rooms', icon: MessagesSquare },
]

const GROUP_ORDER: AppCommand['group'][] = ['Go to', 'Panels', 'Settings', 'Application']

/**
 * ZCode's command palette (docs/DESIGN.md, "Command palette"), Ctrl+K: a 512 card 80 from the top over a blurred backdrop,
 * a pill search field and filter tabs above grouped rows. It reads the one command list, so every shortcut matches, and
 * lists the account's rooms newest first, as ZCode's lists its tasks; choosing one opens it.
 */
export function CommandPalette() {
  const open = useUi((state) => state.paletteOpen)
  const setOpen = useUi((state) => state.setPaletteOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-20 w-[512px] translate-y-0 gap-0 rounded-2xl p-0.5 sm:max-w-[512px]"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search sections, rooms, and actions</DialogDescription>
        <PaletteBody close={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** The palette's contents, mounted only while it is open: each opening starts with an empty search and "All". */
function PaletteBody({ close }: { close(): void }) {
  const commands = useCommands()
  const rooms = useShellPart('rooms')
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')

  // The search field takes focus the moment it is attached, rather than when the dialog focuses it a moment later: on a
  // cold start, keys typed right after Ctrl+K reached the page before the field had focus (2026-09-19; the search command
  // also renders the palette at once, inside the keypress).
  const attachSearch = useCallback((field: HTMLInputElement | null) => field?.focus(), [])

  // The list leaves out Search itself (below), so every row closes the palette and runs its command.
  const run = (command: AppCommand) => {
    close()
    command.run()
  }

  return (
    <Command loop className="rounded-[14px]">
      <div className="space-y-2 border-b border-line p-2">
        {/* A placeholder is not a name: without its own, the field reads as an unnamed combobox. */}
        <CommandInput ref={attachSearch} aria-label="Search" placeholder="Search sections, rooms, and actions" />
        <div role="tablist" aria-label="Show" className="flex items-center gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-ui-base leading-none font-medium transition-colors outline-none [&_svg]:size-3',
                filter === item.id
                  ? 'border-line bg-selected text-foreground'
                  : 'border-transparent text-foreground-subtle hover:text-foreground',
              )}
            >
              <item.icon />
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {filter !== 'rooms'
          ? GROUP_ORDER.filter((group) => filter === 'all' || group !== 'Go to').map((group) => (
              <CommandGroup key={group} heading={group}>
                {commands
                  .filter((command) => command.group === group && command.id !== 'search')
                  .map((command) => (
                    <CommandItem
                      key={command.id}
                      value={`${command.label} ${command.keywords?.join(' ') ?? ''}`}
                      onSelect={() => run(command)}
                    >
                      <command.icon />
                      <span className="min-w-0 flex-1 truncate">{command.label}</span>
                      {command.shortcut ? <CommandShortcut>{shortcutLabel(command.shortcut)}</CommandShortcut> : null}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))
          : null}
        {filter !== 'actions' ? (
          <CommandGroup heading="Rooms">
            {rooms.state === 'ready' && rooms.data.length > 0 ? (
              sortRooms(rooms.data).map((room) => (
                <CommandItem
                  key={room.id}
                  value={`${room.title} ${room.id}`}
                  onSelect={() => {
                    close()
                    void navigate({ to: '/rooms/$roomId', params: { roomId: room.id } })
                  }}
                >
                  <MessagesSquare />
                  <span className="min-w-0 flex-1 truncate">{room.title}</span>
                </CommandItem>
              ))
            ) : (
              <div className="px-2.5 py-1.5 text-ui-base text-foreground-subtlest">
                {rooms.state === 'ready'
                  ? 'No rooms yet'
                  : rooms.state === 'unavailable'
                    ? 'Rooms are unavailable'
                    : 'Loading…'}
              </div>
            )}
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  )
}
