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
import { useLayoutEffect } from 'react'

const LINKS = new Map() // href -> { count, link }

export function usePageStylesheet(href) {
  useLayoutEffect(() => {
    if (!href) return undefined

    let entry = LINKS.get(href)
    if (!entry) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.dataset.dwCss = href
      link.href = href
      document.head.appendChild(link)
      entry = { count: 0, link }
      LINKS.set(href, entry)
    }
    entry.count += 1

    return () => {
      entry.count -= 1
      if (entry.count === 0) {
        LINKS.delete(href)
        entry.link.remove()
      }
    }
  }, [href])
}
