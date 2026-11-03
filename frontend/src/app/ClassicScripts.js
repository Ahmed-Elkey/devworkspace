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
  const intervals = []
  const frames = []

  const origDocAdd = document.addEventListener.bind(document)
  const win = document.defaultView
  const origWinAdd = win.addEventListener.bind(win)
  const origSetInterval = win.setInterval.bind(win)
  const origClearInterval = win.clearInterval.bind(win)
  const origRaf = win.requestAnimationFrame.bind(win)
  const origCancelRaf = win.cancelAnimationFrame.bind(win)

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

  // Timers and animation frames a page starts belong to that page: under one
  // long-lived document they used to keep running after the user left, doing
  // work on a DOM that was no longer there.
  win.setInterval = function (fn, delay, ...args) {
    const id = origSetInterval(fn, delay, ...args)
    intervals.push(id)
    return id
  }
  win.clearInterval = function (id) {
    const i = intervals.indexOf(id)
    if (i !== -1) intervals.splice(i, 1)
    return origClearInterval(id)
  }
  win.requestAnimationFrame = function (fn) {
    const id = origRaf(fn)
    frames.push(id)
    return id
  }
  win.cancelAnimationFrame = function (id) {
    const i = frames.indexOf(id)
    if (i !== -1) frames.splice(i, 1)
    return origCancelRaf(id)
  }

  try {
    for (const code of [].concat(codes).flat()) {
      const el = document.createElement('script')
      el.textContent = code
      // A script that throws used to fail silently and leave half of the page
      // dead. Report it with the page it belongs to.
      el.addEventListener('error', (event) => {
        console.error('[dw] page script failed:', event.message || event.error || 'unknown error')
      })
      host.appendChild(el)
    }
  } catch (err) {
    console.error('[dw] page script could not be injected:', err)
  } finally {
    document.addEventListener = origDocAdd
    win.addEventListener = origWinAdd
    win.setInterval = origSetInterval
    win.clearInterval = origClearInterval
    win.requestAnimationFrame = origRaf
    win.cancelAnimationFrame = origCancelRaf
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
      for (const id of intervals) { try { origClearInterval(id) } catch (_) {} }
      intervals.length = 0
      for (const id of frames) { try { origCancelRaf(id) } catch (_) {} }
      frames.length = 0
    }
  }
}
