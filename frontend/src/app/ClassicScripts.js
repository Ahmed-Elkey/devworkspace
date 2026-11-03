// The workspace/portal/project pages carry large classic scripts (page.js.txt)
// written for full documents. Under the SPA they are injected long after
// DOMContentLoaded has fired, and they used to leak window/document listeners
// forever because a full document reload was the only "cleanup". While a
// page's scripts execute, this module intercepts the two patterns that behave
// differently inside a single long-lived document:
//   1. DOMContentLoaded handlers are collected and invoked directly in order
//      (they would never fire naturally once the document is already loaded).
//   2. Every document/window listener the script registers synchronously is
//      attached normally, but returned as a disposer too, so leaving a page
//      detaches it — the parity behavior a full document reload used to give,
//      including the "unsaved changes" beforeunload prompts.
// Handlers registered on later async ticks cannot be intercepted; the scripts
// in this codebase deliberately structure their setup synchronously and guard
// every callback with element-existence checks, which covers the rest.

const DOC_HANDLED_EVENTS = new Set(['DOMContentLoaded'])

export function runPageScripts(codes, host) {
  const onReady = []
  const disposers = []

  const origDocAdd = document.addEventListener.bind(document)
  const win = document.defaultView
  const origWinAdd = win.addEventListener.bind(win)

  const track = (target, orig, type, fn, opts) => {
    orig(type, fn, opts) // orig is already bound to its receiver
    disposers.push(() => {
      try { target.removeEventListener(type, fn, opts) } catch (_) {}
    })
  }

  document.addEventListener = function (type, fn, opts) {
    if (DOC_HANDLED_EVENTS.has(type)) {
      onReady.push(fn)
      return
    }
    if (typeof fn !== 'function') {
      console.error('[dw] non-function listener for', type, '→', typeof fn, String(fn).slice(0, 80))
      return
    }
    track(document, origDocAdd, type, fn, opts)
  }

  win.addEventListener = function (type, fn, opts) {
    if (typeof fn !== 'function') {
      console.error('[dw] non-function window listener for', type, '→', typeof fn, String(fn).slice(0, 80))
      return
    }
    track(win, origWinAdd, type, fn, opts)
  }

  try {
    for (const code of [].concat(codes).flat()) {
      const el = document.createElement('script')
      el.textContent = code
      host.appendChild(el)
    }
  } finally {
    document.addEventListener = origDocAdd
    win.addEventListener = origWinAdd
  }

  // Behave like the document had just finished loading: fire the queued
  // DOMContentLoaded handlers exactly once, in registration order.
  for (const fn of onReady) {
    try { fn(new Event('DOMContentLoaded')) } catch (err) { console.error(err) }
  }

  return {
    dispose() {
      for (const d of disposers) { try { d() } catch (_) {} }
      disposers.length = 0
    }
  }
}
