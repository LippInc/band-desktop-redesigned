import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built app (out/) through Playwright's Electron support. Run with `pnpm test:e2e`.
// Two workers: each spec file (one serial group on its own profile and fake daemon) runs beside the other. The app runs
// offstage, where each window has its own desktop and keeps its focus (scripts/lib/offstage.cjs); with OFFSTAGE=0 the
// windows share the screen and take focus from each other, so watch a run with --workers=1.
export default defineConfig({
  testDir: 'tests/e2e',
  // Electron's binary, fetched once before the workers start (a fresh checkout has none yet).
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
