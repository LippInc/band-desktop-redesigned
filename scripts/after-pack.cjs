// electron-builder afterPack hook: flips Electron fuses on the packaged binary before it is wrapped in an installer.
// Why: Electron's security checklist says to turn off powerful features an app never uses
// (https://www.electronjs.org/docs/latest/tutorial/fuses). Development runs are unaffected - fuses only exist in packaged builds.
const path = require('node:path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

// Resolved per platform on purpose: packager.executableName only exists on the Linux packager (a map of all three crashed on Windows).
function electronBinary({ electronPlatformName, appOutDir, packager }) {
  switch (electronPlatformName) {
    case 'win32':
      return path.join(appOutDir, `${packager.appInfo.productFilename}.exe`)
    case 'darwin':
      return path.join(appOutDir, `${packager.appInfo.productFilename}.app`)
    case 'linux':
      return path.join(appOutDir, packager.executableName)
    default:
      throw new Error(`after-pack: unsupported platform ${electronPlatformName}`)
  }
}

exports.default = async function afterPack(context) {
  await flipFuses(electronBinary(context), {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // electron-builder embeds the asar integrity hash before this hook runs, so the app can refuse a tampered archive.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  })
}
