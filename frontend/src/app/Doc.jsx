import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { api, esc } from '../lib/api.js'
import { auth } from '../lib/auth.js'
import * as helpers from '../lib/helpers.js'
import { runPageScripts } from './ClassicScripts.js'
import { navigate } from './navigate.js'
// The shared stylesheet is deliberately NOT imported here. Every page stylesheet
// already inlines it first, so a second copy would be emitted as its own chunk and
// can be linked *after* the page's styles, overriding that section's design.

// Expose shared API, Auth and sanitization helpers globally
// so all classic page scripts (page.js.txt) can consume them directly
if (typeof window !== 'undefined') {
  window.__API__ = api
  window.__AUTH__ = auth
  window.api = api
  window.auth = auth
  window.esc = esc
  window.__DW_HELPERS__ = helpers
  window.helpers = helpers
}

/**
 * Renders the page's original static markup verbatim, then executes its
 * original <script> blocks as classic scripts inside the host node —
 * same order and global semantics as the source page's end-of-body code.
 *
 * Strict Route Guard resolves BEFORE any markup or scripts are injected,
 * preventing any flash of protected content. Guards and session redirects
 * move through the SPA bridge (no document reload).
 */

const GUARD_STYLE = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg, #f8f8f8)',
  color: 'var(--fg, #111111)',
  padding: '24px',
}

const GUARD_CARD_STYLE = {
  maxWidth: '420px',
  width: '100%',
  padding: '24px',
  borderRadius: '14px',
  border: '1px solid var(--line, #e4e4e4)',
  background: 'var(--panel, #ffffff)',
  boxShadow: '0 10px 30px rgba(0,0,0,.06)',
}

const SPINNER_KEYFRAMES = '@keyframes dw-spin{to{transform:rotate(360deg)}}'

// The guard shows before the page's own stylesheet is loaded, so its buttons
// carry their own shape instead of waiting for a class that is not there yet.
const GUARD_BUTTON_STYLE = {
  display: 'inline-block',
  padding: '9px 16px',
  borderRadius: '999px',
  border: '1px solid var(--line, #d9d9d9)',
  background: 'var(--panel, #ffffff)',
  color: 'inherit',
  font: 'inherit',
  textDecoration: 'none',
  cursor: 'pointer',
}

export default function Doc({ body, scripts = [] }) {
  // A page reached through the app (not typed in the address bar) already has
  // a checked session: showing the "checking" screen again on every hop made
  // the app flash on each navigation. The guard still runs and still sends the
  // visitor away if the session is gone — the content is simply not hidden
  // behind a spinner while it re-checks.
  const [authorized, setAuthorized] = useState(() => {
    const path = window.location.pathname
    const needsSession = path.startsWith('/workspace') || path.startsWith('/project') || path.startsWith('/portal')
    if (!needsSession) return true
    return Boolean(auth.initialized && auth.user)
  })
  const [guardState, setGuardState] = useState('checking') // checking | slow
  const [guardAttempt, setGuardAttempt] = useState(0)
  const ref = useRef(null)
  const alive = useRef(true)
  const attempt = useRef(0)

  useEffect(() => () => { alive.current = false }, [])

  const checkGuard = useCallback(async () => {
    const path = window.location.pathname
    const isWorkspace = path.startsWith('/workspace') || path.startsWith('/project')
    const isPortal = path.startsWith('/portal')

    // Public / static / error pages don't require workspace auth
    if (!isWorkspace && !isPortal) {
      if (!alive.current) return
      setGuardState('checking')
      setAuthorized(true)
      return
    }

    if (alive.current) setGuardState('checking')
    try {
      // A retry asks the server again instead of reusing the answer that
      // never arrived.
      const session = await auth.init(attempt.current > 0)
      if (!alive.current) return

      if (!session.authenticated) {
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
        navigate(`/login?returnTo=${returnTo}&notice=session_ended`)
        return
      }

      if (isWorkspace && (!session.principals || session.principals.length === 0)) {
        navigate('/onboarding')
        return
      }

      if (isPortal && (!session.clientPrincipals || session.clientPrincipals.length === 0)) {
        // If the user has workspace access but no client access, redirect to workspace
        if (session.principals && session.principals.length > 0) {
          navigate('/workspace/dashboard')
          return
        }
      }

      setAuthorized(true)
    } catch (err) {
      if (!alive.current) return
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
      navigate(`/login?returnTo=${returnTo}&notice=session_ended`)
    }
  }, [])

  useEffect(() => {
    // A session request that never answers used to leave an empty white
    // viewport forever. Say so, and offer a way out.
    const timer = setTimeout(() => {
      if (alive.current) setGuardState((s) => (s === 'checking' ? 'slow' : s))
    }, 10000)
    checkGuard()
    return () => clearTimeout(timer)
  }, [checkGuard, guardAttempt])

  useLayoutEffect(() => {
    if (!authorized) return
    const host = ref.current
    if (!host) return

    host.innerHTML = body

    // Inject runtime logout button into .util (workspace/project) or .ph > .pr (portal)
    const util = host.querySelector('.util')
    const portalHeader = host.querySelector('.ph > .pr')
    const target = util || portalHeader
    if (target && !target.querySelector('#logout-btn')) {
      const logoutBtn = document.createElement('button')
      logoutBtn.id = 'logout-btn'
      logoutBtn.type = 'button'
      logoutBtn.className = 'ib'
      logoutBtn.textContent = 'Log out'
      logoutBtn.onclick = () => {
        // The server has to end the session before /login will stay put, so the
        // wait is real; saying so beats a button that looks dead.
        logoutBtn.disabled = true
        logoutBtn.textContent = 'Signing out…'
        auth.logout()
      }
      const dr = target.querySelector('#dr')
      if (dr) {
        target.insertBefore(logoutBtn, dr)
      } else {
        target.appendChild(logoutBtn)
      }
    }

    // Role-based navigation visibility: hide admin-only items (Team, Audit) for MEMBER
    const activePrincipal = auth.getActivePrincipal()
    if (activePrincipal && activePrincipal.role === 'MEMBER') {
      const teamNav = host.querySelector('nav a[href="/workspace/team"]')
      if (teamNav) {
        teamNav.hidden = true
        teamNav.style.display = 'none'
      }
      const auditNav = host.querySelector('nav a[href="/workspace/audit"]')
      if (auditNav) {
        auditNav.hidden = true
        auditNav.style.display = 'none'
      }
    }

    // In project pages, validate and propagate ?id=<uuid>
    const isProjectPage = window.location.pathname.startsWith('/project/')
    if (isProjectPage) {
      const params = new URLSearchParams(window.location.search)
      const projectId = params.get('id')
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

      if (!projectId || !uuidRegex.test(projectId)) {
        helpers.renderNotAvailableState(host, 'This project is not available.')
        return
      }

      window.__DW_PROJECT_ID__ = projectId

      // Propagate ?id=<uuid> across all project navigation and links at runtime
      const projectLinks = host.querySelectorAll('a[href^="/project/"]')
      projectLinks.forEach(a => {
        try {
          const rawHref = a.getAttribute('href')
          if (!rawHref) return
          const url = new URL(rawHref, window.location.origin)
          if (!url.searchParams.has('id')) {
            url.searchParams.set('id', projectId)
            a.setAttribute('href', url.pathname + url.search + url.hash)
          }
        } catch (_) {}
      })
    }

    // Classic scripts, wrapped so they behave the way they did inside a whole
    // document: DOMContentLoaded handlers fire once (they never would after a
    // SPA hop), and every document/window listener comes back as a disposer.
    // A fresh page scope goes up first: everything the page registers (its
    // loader, its document listeners, its timers) is taken back down when the
    // user leaves, instead of running against the next page.
    helpers.beginPageScope()
    const batch = runPageScripts(scripts.flat(), host)

    // An error inside a page's own code is reported with the page it belongs
    // to, instead of vanishing into the console as an anonymous failure.
    const onPageError = (event) => {
      console.error('[dw] page error on', window.location.pathname, event.error || event.message)
    }
    const onPageRejection = (event) => {
      console.error('[dw] page promise rejected on', window.location.pathname, event.reason)
    }
    window.addEventListener('error', onPageError)
    window.addEventListener('unhandledrejection', onPageRejection)

    /* Native fragment scroll ran before React committed; the original
       pages had static markup, so re-run it here for parity. */
    if (location.hash.length > 1) {
      const t = document.getElementById(decodeURIComponent(location.hash.slice(1)))
      if (t) t.scrollIntoView()
    }

    return () => {
      window.removeEventListener('error', onPageError)
      window.removeEventListener('unhandledrejection', onPageRejection)
      batch.dispose()
      helpers.endPageScope()
      // The page's own loader must not survive it: left in place it kept
      // rewriting the NEXT page's heading and widgets with this page's data.
      try { delete window.__DW_RELOAD__ } catch (_) { window.__DW_RELOAD__ = undefined }
      delete window.__DW_PROJECT_ID__
    }
  }, [authorized, body, scripts])

  if (!authorized) {
    // Still no protected markup until the guard resolves, but the wait is a
    // real screen instead of an empty white viewport: the page used to look
    // broken (or crashed) while the session request was in flight.
    if (guardState === 'slow') {
      return (
        <div style={GUARD_STYLE}>
          <div style={GUARD_CARD_STYLE}>
            <h1 style={{ margin: '0 0 8px', fontSize: '20px' }}>Still checking your session</h1>
            <p style={{ margin: '0 0 18px', color: 'var(--muted, #595959)' }}>
              The server did not answer in time. You can try again, or sign in again.
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                className="btn"
                type="button"
                style={GUARD_BUTTON_STYLE}
                onClick={() => {
                  attempt.current += 1
                  setGuardAttempt((n) => n + 1)
                }}
              >
                Try again
              </button>
              <a className="btn" href="/login" style={GUARD_BUTTON_STYLE}>
                Sign in
              </a>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div style={GUARD_STYLE}>
        <style>{SPINNER_KEYFRAMES}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--muted, #595959)' }}>
          <span
            style={{
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              border: '2px solid var(--line, #d9d9d9)',
              borderTopColor: 'var(--fg, #111111)',
              display: 'inline-block',
              animation: 'dw-spin .8s linear infinite',
            }}
            aria-hidden="true"
          />
          <span>Loading…</span>
        </div>
      </div>
    )
  }

  return <div ref={ref} />
}
