import { app, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Standard roles only (clipboard, window, dev tools). App commands such as Ctrl+B or Ctrl+K are handled in the
 * renderer's shortcut registry, so no accelerator here may duplicate them - a toggle would fire twice.
 */
export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const isDev = !app.isPackaged

  const view: MenuItemConstructorOptions[] = [
    ...(isDev
      ? ([
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    { role: 'togglefullscreen' },
  ]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: 'appMenu' }] satisfies MenuItemConstructorOptions[]) : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: view },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
