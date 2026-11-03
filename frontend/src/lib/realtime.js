/* Live updates.
 * The API emits invalidation hints over its notification socket
 * (`apps/api/src/communications-gateway.ts`): `notifications.changed` for the
 * recipient's own feed and `state.changed` for a project the client subscribed
 * to. Hints carry IDs only, so every handler re-reads through the normal REST
 * endpoints, which re-check authorization. */
import { io } from 'socket.io-client'
import { auth } from './auth.js'
import { demoMode } from '../demo/index.js'

let socket = null
let subscribedProject = null
const watchers = new Set()
let everConnected = false
// Serverless deployments have no socket gateway at all: every handshake ends
// in a 404 and every retry paints the console red. One failed handshake is
// enough to know there is nothing to talk to.
let gatewayMissing = false

function handshake(projectId) {
  const principal = auth.getActivePrincipal()
  if (!principal) return null
  const orgId = principal.organizationId || principal.organization_id || auth.activeOrgId
  if (!orgId || !principal.id) return null
  const isClient = auth.getClientPrincipals().some((p) => p.id === principal.id)
  const context = {
    organization_id: orgId,
    principal_id: principal.id,
    capacity: isClient ? 'CLIENT' : 'INTERNAL',
  }
  if (projectId) context.project_id = projectId
  return context
}

/** A reload must never land on top of something the user is doing. */
function busy() {
  const active = document.activeElement
  if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return true
  return Boolean(document.querySelector('dialog[open]'))
}

function notify(detail) {
  if (busy()) return
  window.dispatchEvent(new CustomEvent('devworkspace:invalidate', { detail }))
  for (const watch of [...watchers]) {
    try {
      watch(detail)
    } catch (_) {
      /* one broken watcher must not stop the others */
    }
  }
  const reload = window.__DW_RELOAD__
  if (typeof reload === 'function') Promise.resolve(reload()).catch(() => {})
}

export function start(options = {}) {
  if (typeof window === 'undefined' || !auth.activeOrgId) return
  // The offline demo has no server to tell it anything changed, and the pages it
  // shows are edited by the visitor alone.
  if (demoMode) return null
  // No gateway on this deployment: trying again only repeats the same 404.
  if (gatewayMissing) return null
  const projectId = options.projectId || window.__DW_PROJECT_ID__ || null
  if (!socket) {
    const context = handshake(projectId)
    if (!context) return
    socket = io({
      transports: ['websocket'],
      auth: context,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // Serverless deployments have no gateway to reach. Give up after a few
      // attempts instead of retrying forever.
      reconnectionAttempts: 3,
    })
    socket.on('connect', () => {
      everConnected = true
      notify({ reason: 'reconnect' })
    })
    socket.on('connect_error', (err) => {
      // The first handshake failed and nothing ever connected: this deployment
      // has no gateway. Stop here instead of letting every navigation start a
      // fresh round of failed handshakes.
      if (everConnected) return
      gatewayMissing = true
      try {
        socket.io.opts.reconnection = false
        socket.disconnect()
      } catch (_) {}
    })
    socket.on('notifications.changed', () => notify({ reason: 'notifications' }))
    socket.on('state.changed', (payload) => notify({ reason: 'project', ...payload }))
    subscribedProject = projectId
  } else if (projectId && projectId !== subscribedProject) {
    subscribedProject = projectId
    socket.emit('subscribe', { project_id: projectId }, () => {})
  }
  // A dead socket must not mean stale data: poll only while the live feed is down.
  // `everConnected` is what proves a gateway exists at all. Serverless deployments
  // have none, and there a periodic re-read of every widget catches up to nothing
  // — it only makes the page look like it keeps losing its own data.
  if (!start.timer) {
    start.timer = setInterval(() => {
      if (!everConnected || (socket && socket.connected)) return
      notify({ reason: 'catch-up' })
    }, 30000)
  }
  return socket
}

/** Close the live feed and forget it (sign-out, or a page that must not talk to it). */
export function stop() {
  if (socket) {
    try { socket.disconnect() } catch (_) {}
    socket = null
  }
  subscribedProject = null
  everConnected = false
  gatewayMissing = false
  if (start.timer) {
    clearInterval(start.timer)
    start.timer = null
  }
}

export function onChange(handler) {
  watchers.add(handler)
  start()
  return () => watchers.delete(handler)
}

export function status() {
  return socket && socket.connected ? 'live' : 'offline'
}
