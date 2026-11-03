export function navigate(to, { replace = false } = {}) {
  if (replace) {
    window.location.replace(to)
  } else {
    window.location.href = to
  }
  return true
}
