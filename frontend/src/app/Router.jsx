// A single React shell keeps navigation instant. Route components unmount on
// every path change and own their cleanup, while the page stylesheet manager
// keeps the outgoing design visible until the next one is ready.

import React, { Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { ROUTES, ROUTE_TITLES } from './routes.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

// Nothing matched an internal link: keep the URL honest and show the designed
// 404 page inside the running app instead of bouncing the document to /404.
const Fallback404 = ROUTES.find((r) => r.path === '/404').component
const BOOT_SHELL = '/src/app/main.jsx'

function Inner() {
  const location = useLocation()

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

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Inner />
    </BrowserRouter>
  )
}
