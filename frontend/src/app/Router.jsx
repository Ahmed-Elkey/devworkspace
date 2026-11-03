// A single React shell keeps navigation instant. Route components unmount on
// every path change and own their cleanup, while the page stylesheet manager
// keeps the outgoing design visible until the next one is ready.

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

  useEffect(() => {
    setNavigator((to, replace) => startTransition(() => navigate(to, { replace })))
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

function RouteScope({ Cmp }) {
  const location = useLocation()
  return <Cmp key={location.pathname + location.search} />
}

// Intercept only ordinary same-origin page links. This preserves open-in-new-
// tab, downloads and external URLs, while avoiding a full browser reload for
// normal product navigation.
function LinkInterceptor() {
  const navigate = useNavigate()
  useEffect(() => {
    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target?.closest?.('a[href]')
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#')) return
      let url
      try { url = new URL(href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin || url.protocol === 'mailto:' || url.protocol === 'tel:') return
      let path = url.pathname
      if (/^\/(api|dw-staging|socket\.io)\b/.test(path)) return
      if (!ROUTE_TITLES.has(path)) {
        const htmlPath = path.endsWith('.html') ? path.slice(0, -5) : null
        if (htmlPath && ROUTE_TITLES.has(htmlPath)) path = htmlPath
        else return
      }
      const next = path + url.search + url.hash
      if (next === window.location.pathname + window.location.search + window.location.hash) return
      event.preventDefault()
      startTransition(() => navigate(next))
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
