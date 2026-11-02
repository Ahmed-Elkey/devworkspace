// Answers requests in the browser when the site is built as the offline demo, so
// nothing ever leaves the tab. The build flag decides it: a normal build talks to
// the real API, a demo build is self-contained.
import { problem, read, signOut, signedInAs, signIn, store, write } from './store.js'

export const demoMode = import.meta.env.VITE_DEMO === '1'

const CSRF = 'offline-demo-csrf'
const NO_SIGNUP = 'This is a demo: sign in with one of the accounts listed on this page.'

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch (_) {
    return null
  }
}

function respond(status, body, etag) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (etag != null) headers.set('etag', `"${etag}"`)
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    json: async () => body,
    text: async () => (body == null ? '' : JSON.stringify(body)),
    clone: () => respond(status, body, etag),
  }
}

export async function demoRequest(method, url, rawBody, headers) {
  const path = (url.startsWith('/api/v1') ? url.slice('/api/v1'.length) : url) || '/'
  const body = typeof rawBody === 'string' ? safeJson(rawBody) : rawBody

  if (path === '/identity/csrf') return respond(200, { token: CSRF })
  if (path === '/identity/login') {
    return signIn(body?.email, body?.password)
      ? respond(200, { status: 'ok' })
      : respond(401, problem('AUTH_FAILED', 401, 'Email or password is incorrect.'))
  }
  if (path === '/identity/logout') {
    signOut()
    return respond(200, { status: 'ok' })
  }
  if (/^\/identity\/(register|verify|recovery|reset)$/.test(path) || path === '/organizations') {
    return respond(400, problem('DEMO_ACCOUNT_REQUIRED', 400, NO_SIGNUP))
  }

  const email = signedInAs()
  if (!email) return respond(401, problem('SESSION_REQUIRED', 401, 'Sign in to continue.'))
  if (!(await store())) return respond(401, problem('SESSION_REQUIRED', 401, `${email} is not part of the offline demo.`))

  if (method === 'GET' || method === 'HEAD') {
    const hit = read(path)
    return respond(hit.status, hit.body)
  }
  const outcome = await write(method, path, body, headers)
  return respond(outcome.status, outcome.body, outcome.etag)
}
