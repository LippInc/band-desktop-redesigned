/**
 * Routes this app never calls, whatever the page asks for (README, "What this app never does"): deleting the account or
 * the local data, revealing or replacing an agent's API key, signing out, and signing in or removing an account (sign-in
 * stays in the official app). Stopping, updating or restarting the daemon itself is never this app's to do either.
 * The transport refuses these before sending; tests pin the list and fail if an operation points at one.
 */
export const FORBIDDEN_ROUTES: ReadonlySet<string> = new Set([
  '/v1/deleteAccount',
  '/v1/deleteLocalAccountData',
  '/v1/revealAgentApiKey',
  '/v1/replaceAgentApiKey',
  '/v1/signOutAccount',
  '/v1/removeAccount',
  '/v1/addAccount',
  '/v1/addOauthAccount',
  '/v1/shutdown',
  '/v1/update',
])

export class ForbiddenRouteError extends Error {
  constructor(route: string) {
    super(`This app never calls ${route}`)
    this.name = 'ForbiddenRouteError'
  }
}

/**
 * Every route the daemon has is `/v1/` and one name of letters, digits and hyphens, with
 * an optional query. Any other spelling (a percent escape, a dot segment, a doubled or trailing slash, a fragment) is
 * refused before the list is read, so no second spelling of a forbidden route can reach the daemon.
 */
const ROUTE_SHAPE = /^\/v1\/[A-Za-z][A-Za-z0-9-]*(?:\?[^#\s]*)?$/

/** Throws for a forbidden route, in any letter case or with a query string, and for any path not shaped like a route. */
export function assertRouteAllowed(path: string): void {
  if (!ROUTE_SHAPE.test(path)) throw new ForbiddenRouteError(path)
  const route = (path.split('?', 1)[0] ?? '').toLowerCase()
  for (const forbidden of FORBIDDEN_ROUTES) {
    if (route === forbidden.toLowerCase()) throw new ForbiddenRouteError(forbidden)
  }
}
