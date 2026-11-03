// Single-document navigation for the whole app. The browser loads one document
// per cold visit (each frontend/<path>.html) but every one of those documents
// boots THIS router, which then swaps pages in place: internal <a> clicks are
// intercepted and resolved client-side, and the target page's module is loaded
// lazily — only the code, styles and markup of the page being opened.
//
// Transition semantics: navigations run inside startTransition and every route
// hangs off one Suspense boundary above <Routes>, so while the next page's
// chunk loads the PREVIOUS page stays on screen instead of flashing to blank —
// the visual parity of a fast multipage hop, minus the reload.

import React, { Suspense, startTransition, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { ROUTES, ROUTE_TITLES } from './routes.jsx'
import { setNavigator } from './navigate.js'
import ErrorBoundary from './ErrorBoundary.jsx'

// Nothing matched an internal link: keep the URL honest and show the designed
// 404 page inside the running app instead of bouncing the document to /404.
const Fallback404 = ROUTES.find((r) => r.path === '/404').component
const BOOT_SHELL = '/src/app/main.jsx'

function Inner() {
  const location = useLocation()
  const navigate = useNavigate()

  // Give bridge callers (auth redirects, Doc's guard, logout) a way to move
  // around without the component tree above being destroyed on route change.
  useEffect(() => {
    setNavigator((to, replace) => {
      startTransition(() => navigate(to, { replace }))
    })
    return () => setNavigator(null)
  }, [navigate])

  // Keep the document title in step with the route. The served document's own
  // <head> still wins on cold loads, so this only ever needs to run after a
  // client-side hop.
  useEffect(() => {
    const title = ROUTE_TITLES.get(location.pathname)
    if (title) document.title = title
  }, [location.pathname])

  return (
    <ErrorBoundary resetKey={location.pathname + location.search}>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          {ROUTES.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={<RouteScope Cmp={route.component} />}
            />
          ))}
          <Route path="*" element={<Fallback404 />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

// While a page's code is still on its way, the app shows a real screen instead
// of an empty white viewport. A blank page reads as a crash.
function RouteLoading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg, #f8f8f8)',
        color: 'var(--muted, #595959)',
      }}
    >
      <style>{'@keyframes dw-spin{to{transform:rotate(360deg)}}'}</style>
      <span
        aria-hidden="true"
        style={{
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          border: '2px solid var(--line, #d9d9d9)',
          borderTopColor: 'var(--fg, #111111)',
          display: 'inline-block',
          animation: 'dw-spin .8s linear infinite',
        }}
      />
      <span style={{ marginLeft: '12px' }}>Loading…</span>
    </div>
  )
}

// A query change (e.g. /project/project-tasks?id=A → ?id=B) used to be a full
// document reload in the multipage app. Reconciling the same mounted component
// would leave ?id-driven page state stale, so key the route element by
// pathname + search: any real navigation gets a fresh mount, hash-only moves
// reconcile in place.
function RouteScope({ Cmp }) {
  const location = useLocation()
  return <Cmp key={location.pathname + location.search} />
}

// Mounted once for the lifetime of the document. Intercepts plain left-clicks
// on internal anchors so they resolve as SPA navigation; everything a user
// would expect to escape the router (modified clicks, target=_blank,
// downloads, external origins, API/storage paths, real assets) keeps its
// default behavior.
function LinkInterceptor() {
  const navigate = useNavigate()
  useEffect(() => {
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const el = e.target
      const a = el && el.closest ? el.closest('a[href]') : null
      if (!a) return
      if (a.target && a.target !== '_self') return
      if (a.hasAttribute('download')) return
      const href = a.getAttribute('href')
      if (!href || href.startsWith('#')) return

      let url
      try {
        url = new URL(href, window.location.href)
      } catch (_) {
        return
      }
      if (url.protocol === 'mailto:' || url.protocol === 'tel:') return
      if (url.origin !== window.location.origin) return

      let path = url.pathname
      if (/^\/(api|dw-staging|socket\.io)\b/.test(path)) return

      // Legacy links may still point at "<page>.html"; normalize them to the
      // clean route the platform would serve anyway, and let anything that is
      // not a page (assets, files with an extension) fall through to default.
      if (!ROUTE_TITLES.has(path)) {
        const last = path.slice(path.lastIndexOf('/') + 1)
        if (last.endsWith('.html') && ROUTE_TITLES.has(path.slice(0, -'.html'.length))) {
          path = path.slice(0, -'.html'.length)
        } else if (last.includes('.')) {
          return
        }
      }

      const next = path + url.search + url.hash
      if (path === window.location.pathname && url.search === window.location.search) {
        return // same document: browser default keeps hash scrolling honest
      }
      if (next === window.location.pathname + window.location.search + window.location.hash) {
        return
      }

      e.preventDefault()
      startTransition(() => navigate(next, { replace: false }))
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [navigate])
  return null
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <LinkInterceptor />
      <Inner />
    </BrowserRouter>
  )
}
