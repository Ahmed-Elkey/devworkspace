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
