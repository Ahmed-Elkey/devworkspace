// A tiny bridge that lets non-hook code — auth flows, Doc's route guard, the
// logout button — move the user to another route WITHOUT a full document
// reload. The Router installs a real navigate function at startup; if the
// caller somehow runs outside the SPA shell, it falls back to a location
// change so behavior degrades to the old multipage flow instead of breaking.
let navigateFn = null

export function setNavigator(fn) {
  navigateFn = fn
}

export function navigate(to, { replace = false } = {}) {
  if (navigateFn) {
    navigateFn(to, replace)
    return true
  }
  if (replace) {
    window.location.replace(to)
  } else {
    window.location.href = to
  }
  return false
}
