const ALLOWED_PROTOCOLS = new Set(['https:', 'mailto:'])

/** Only https and mailto links may leave the app for the system browser or mail client. */
export function isSafeExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false
  try {
    return ALLOWED_PROTOCOLS.has(new URL(raw).protocol)
  } catch {
    return false
  }
}
