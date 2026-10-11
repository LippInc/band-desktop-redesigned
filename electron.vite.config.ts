import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    // node:sqlite is a prefix-only Node builtin; keep it out of the bundle explicitly.
    build: { rollupOptions: { external: ['node:sqlite'] } },
  },
  preload: {
    resolve: { alias: sharedAlias },
  },
  renderer: {
    resolve: { alias: { ...sharedAlias, '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()],
  },
})
