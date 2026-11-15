export const TOKEN_HEADER: string
export const DEFAULT_APP_ORIGIN: string
export function appOrigin(env?: Record<string, string | undefined>): string
export function tokensMatch(given: string, expected: string): boolean
export function checkAccess(event: { headers?: Record<string, string | undefined> | null } | null | undefined, env?: Record<string, string | undefined>): 'ok' | 'unconfigured' | 'denied'
export function withStanleyAuth(
  inner: (event: any, context?: any) => Promise<any>,
  options?: { env?: Record<string, string | undefined> },
): (event: any, context?: any) => Promise<any>
