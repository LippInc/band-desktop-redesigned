import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jam } from '@/lib/platform'
import { applyAppearance } from '@/lib/theme'
import { router } from '@/router'
import { useDaemon } from '@/stores/daemon'
import { useSettings } from '@/stores/settings'
import './styles/globals.css'

async function boot() {
  // The platform on <html>: on macOS the window's own buttons sit in the top-left corner, and globals.css moves what
  // starts there aside.
  document.documentElement.dataset.platform = jam()?.platform ?? 'web'
  // Settings first: the theme and text size must be right on the first frame. Until they are on <html>, the page is
  // transparent (globals.css), so the window's own colour, already the theme's, shows instead of a light flash.
  await useSettings.getState().load()
  const { theme, uiFontSize, chatFontSize } = useSettings.getState().settings
  applyAppearance(theme, uiFontSize, chatFontSize)
  void useDaemon.getState().start()
  const root = document.getElementById('root')
  if (!root) throw new Error('no #root element')
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </StrictMode>,
  )
}

void boot()
