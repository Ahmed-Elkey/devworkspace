// Route-scoped stylesheets. The multipage app got per-document CSS isolation
// for free (one stylesheet per page document, gone on reload). Under the SPA
// all pages share one long-lived document, and these full-page stylesheets
// (base.css, login.css, auth.css, main.css… each with its own :root/body/.btn
// rules) silently accumulate and fight each other: navigating / → /login kept
// the landing's 286KB base.css styling the auth page through the class names
// both designs share. So page stylesheets are imported as asset URLs (?url)
// instead of bundling them globally, and each page injects its own as a real
// <link> only while it is on screen — mounted with the page, removed when the
// page unmounts, exactly the lifecycle a document reload used to provide.
//
// A refcount keyed by href lets several routes share one stylesheet (acct.css
// serves five workspace pages, main.css dozens) without racing removal: the
// <link> disappears only when the last page using it has unmounted.
//
// One more rule: the outgoing page's stylesheet is NOT removed while the
// incoming page's stylesheet is still downloading. Tearing the old one down
// first left the new page unstyled for a moment — a white flash on every
// navigation, which reads as a glitch.
import { useLayoutEffect } from 'react'

const LINKS = new Map() // href -> { count, link, loaded }
let loading = 0
let flushTimer = null

function existingStylesheet(href) {
  const target = new URL(href, document.baseURI).href
  return [...document.querySelectorAll('link[rel="stylesheet"]')].find(
    (link) => new URL(link.href, document.baseURI).href === target,
  )
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(flush, 0)
}

function flush() {
  flushTimer = null
  // A stylesheet is still on its way: keep the old one up so the page that is
  // arriving never shows up unstyled.
  if (loading > 0) return
  for (const [href, entry] of [...LINKS]) {
    if (entry.count > 0) continue
    if (entry.timer) clearTimeout(entry.timer)
    entry.link.remove()
    LINKS.delete(href)
  }
}

// The route shell shows its own neutral loading state. Keeping an inactive
// stylesheet alive while the incoming one downloads therefore buys us
// nothing, but it does allow two pages' global selectors to fight briefly.
// Remove inactive route styles immediately before mounting the next route.
function discardInactiveStyles(exceptHref) {
  for (const [href, entry] of [...LINKS]) {
    if (href === exceptHref || entry.count > 0) continue
    if (entry.timer) clearTimeout(entry.timer)
    entry.link.remove()
    LINKS.delete(href)
  }
}

export function usePageStylesheet(href) {
  useLayoutEffect(() => {
    if (!href) return undefined

    let entry = LINKS.get(href)
    if (!entry) {
      discardInactiveStyles(href)
      // Reuse a matching existing link on a direct entry when the browser has
      // one; otherwise this hook owns the route's only stylesheet link.
      const link = existingStylesheet(href) || document.createElement('link')
      const alreadyLoaded = Boolean(link.sheet)
      if (!alreadyLoaded) {
        link.rel = 'stylesheet'
        link.href = href
      }
      link.dataset.dwCss = href

      entry = { count: 0, link, loaded: alreadyLoaded, timer: null }
      LINKS.set(href, entry)

      const ready = () => {
        if (entry.loaded) return
        entry.loaded = true
        loading -= 1
        if (entry.timer) clearTimeout(entry.timer)
        entry.timer = null
        scheduleFlush()
      }
      if (!alreadyLoaded) {
        loading += 1
        link.addEventListener('load', ready)
        link.addEventListener('error', ready)
        // A stylesheet that never answers must not pin the old one forever.
        entry.timer = setTimeout(ready, 4000)
        if (!link.isConnected) document.head.appendChild(link)
      }
    }
    entry.count += 1

    return () => {
      entry.count -= 1
      scheduleFlush()
    }
  }, [href])
}
