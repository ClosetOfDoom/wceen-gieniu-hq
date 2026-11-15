// Password header for scripts that call the deployed Netlify functions.
// The value comes only from the environment (STANLEY_ACCESS_TOKEN) and is never printed.
export function stanleyHeaders(extra = {}) {
  const token = process.env.STANLEY_ACCESS_TOKEN
  return token ? { ...extra, 'x-stanley-token': token } : { ...extra }
}
export function explainAuth(status) {
  return status === 401 || status === 503
    ? ` (brak lub zły STANLEY_ACCESS_TOKEN w środowisku — ustaw go w terminalu)`
    : ''
}
