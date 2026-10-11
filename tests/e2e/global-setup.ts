import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * Fetches Electron's binary once, before any worker starts. Since Electron 44 its package installs no binary when the
 * dependencies are installed: the first launch downloads and unpacks it. Two workers launching at once on a fresh
 * checkout both unpacked it into the same folder, and the first run failed ("Process failed to launch!"). The script is
 * Electron's own and returns at once when the binary is already there. The path is from the repository root, where the
 * runner starts, as the fake daemon's fixtures are.
 */
export default function globalSetup(): void {
  const install = join(process.cwd(), 'node_modules', 'electron', 'install.js')
  const result = spawnSync(process.execPath, [install], { stdio: 'inherit' })
  if (result.status !== 0)
    throw new Error(`Electron's binary could not be installed (${install} exited ${result.status})`)
}
