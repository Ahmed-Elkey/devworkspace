// The offline dataset. Every answer here was recorded from the real API, per
// account, so a viewer sees exactly what that role sees today — only instantly.
// Edits are applied to the copy in memory and kept for the tab, so the demo can
// be clicked through instead of being a screenshot.
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './accounts.js'

const files = import.meta.glob('./recordings/*.json')
const ACCOUNT_KEY = 'devworkspace_demo_account'
const STORE_PREFIX = 'devworkspace_demo_store:'

// Query parameters that narrow a list, as opposed to paging through it.
const FILTERS = new Set(['status', 'state', 'client_id', 'project_id', 'assignee_id', 'milestone_id', 'q', 'type', 'role', 'priority'])
const now = () => new Date().toISOString()
const slugFor = (email) => String(email).replace(/[^a-z0-9]+/gi, '-').toLowerCase()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A few project collections were absent when the original recordings were
// captured. A frontend-only demo must never expose a half-empty product just
// because a source endpoint happened to be unavailable at capture time. These
// records complete the Files, Deliverables and Documents flows for every
// internal demo role; they are copied into the same in-tab store as recorded
// data, so changes still behave like the rest of the demo.
const DEMO_COLLECTIONS = {
  folders: [
    { id: 'e4214ae3-7c46-4db4-a268-2ad0636f8ee1', name: 'Brand assets', position: 1, revision: 1 },
    { id: 'a96c75ce-7b96-4998-a904-27cae8ad713f', name: 'Client feedback', position: 2, revision: 1 },
  ],
  files: [
    { id: 'fe1d9c19-a1d8-42e4-8adb-bbc5fd530181', title: 'Storefront-home-v4.fig', folder_id: 'e4214ae3-7c46-4db4-a268-2ad0636f8ee1', byte_size: 2480000, version_number: 4, attachment_count: 3, asset_id: 'asset-storefront-v4', revision: 1 },
    { id: '15f64df4-24eb-40ea-b5b5-a2c953374010', title: 'Launch-messaging.pdf', folder_id: 'root', byte_size: 834000, version_number: 2, attachment_count: 1, asset_id: 'asset-launch-message', revision: 1 },
    { id: '4d5b12df-f7ee-4edb-a703-830b5d143e73', title: 'Product-shots.zip', folder_id: 'e4214ae3-7c46-4db4-a268-2ad0636f8ee1', byte_size: 12400000, version_number: 1, attachment_count: 0, asset_id: 'asset-product-shots', revision: 1 },
  ],
  deliverables: [
    { id: '7651484b-bbbf-440a-9389-1c38a8d1d95a', title: 'Storefront launch design', task_id: null, revision: 1 },
    { id: '0b748e4f-3adc-442e-9d5f-42a3498d3521', title: 'Campaign messaging pack', task_id: null, revision: 1 },
  ],
  versions: [
    { id: '604de7b2-54e0-422d-a71a-4bdf895d74f0', deliverable_id: '7651484b-bbbf-440a-9389-1c38a8d1d95a', version_number: 3, creator_name: 'Demo Showcase', created_at: '2026-10-28T09:30:00.000Z', share_status: 'ACTIVE', review_status: 'OPEN', revision: 1, share_revision: 1, digest: 'demo-storefront-v3' },
    { id: 'ee543491-e6f4-4ec4-af5e-213e4d1a7e2e', deliverable_id: '0b748e4f-3adc-442e-9d5f-42a3498d3521', version_number: 2, creator_name: 'Alex Morgan', created_at: '2026-10-30T14:15:00.000Z', share_status: 'ACTIVE', review_status: 'CLOSED', revision: 1, share_revision: 1, digest: 'demo-messaging-v2' },
  ],
  documents: [
    { id: 'c3e854d3-6e29-49ea-8606-cb3614e0b280', title: 'Storefront launch brief', summary: 'Goals, audience and launch milestones.', updated_at: '2026-10-31T10:00:00.000Z', revision: 1 },
    { id: 'ec8f922b-5070-4c5a-937b-213467cd7f15', title: 'Creative review notes', summary: 'Open decisions from the latest stakeholder review.', updated_at: '2026-10-30T16:20:00.000Z', revision: 1 },
  ],
}

function collectionFor(pathname) {
  const match = /\/projects\/[^/]+\/(folders|files|deliverables|versions|documents)$/.exec(pathname)
  return match ? match[1] : null
}

function demoCollection(pathname, params) {
  const collection = collectionFor(pathname)
  if (!collection) return null
  let items = structuredClone(DEMO_COLLECTIONS[collection] || [])
  if (collection === 'files') {
    const folder = params.get('folder_id')
    if (folder && folder !== 'root') items = items.filter((item) => item.folder_id === folder)
    if (folder === 'root') items = items.filter((item) => item.folder_id === 'root')
  }
  return { status: 200, body: { items, total: items.length, nextCursor: null } }
}

export function signedInAs() {
  try {
    return sessionStorage.getItem(ACCOUNT_KEY)
  } catch (_) {
    return null
  }
}

export function signIn(email, password) {
  const address = String(email || '').trim().toLowerCase()
  const known = DEMO_ACCOUNTS.some((account) => account.email === address)
  if (!known || password !== DEMO_PASSWORD) return false
  try {
    sessionStorage.setItem(ACCOUNT_KEY, address)
  } catch (_) {}
  current = null
  return true
}

export function signOut() {
  try {
    sessionStorage.removeItem(ACCOUNT_KEY)
  } catch (_) {}
  current = null
}

let current = null

async function dataset(email) {
  if (current?.email === email) return current
  let saved = null
  try {
    saved = sessionStorage.getItem(STORE_PREFIX + email)
  } catch (_) {}
  if (saved) {
    try {
      current = { email, recordings: JSON.parse(saved) }
      return current
    } catch (_) {}
  }
  const loader = files[`./recordings/${slugFor(email)}.json`]
  if (!loader) return null
  const module = await loader()
  const data = module.default ?? module
  current = { email, recordings: structuredClone(data.recordings ?? {}) }
  return current
}

// Start loading a role's recorded responses as soon as it is selected on the
// sign-in screen. By the time the visitor presses Sign in, the dashboard data
// is already in memory rather than waiting on the first protected request.
export async function preloadDemoAccount(email) {
  const address = String(email || '').trim().toLowerCase()
  if (!DEMO_ACCOUNTS.some((account) => account.email === address)) return null
  return dataset(address)
}

function persist() {
  if (!current) return
  try {
    sessionStorage.setItem(STORE_PREFIX + current.email, JSON.stringify(current.recordings))
  } catch (_) {
    // A tab full of edits is not worth breaking the page over.
  }
}

/** The recordings for whoever is signed in, or null when nobody is. */
export async function store() {
  const email = signedInAs()
  if (!email) return null
  return dataset(email)
}

export function splitKey(key) {
  const [pathname, search = ''] = key.split('?')
  return { pathname, params: new URLSearchParams(search) }
}

const reads = (recordings) =>
  Object.entries(recordings)
    .filter(([key]) => key.startsWith('GET '))
    .map(([key, entry]) => ({ ...splitKey(key.slice(4)), entry }))

const rows = (entry) => (Array.isArray(entry?.body?.items) ? entry.body.items : Array.isArray(entry?.body) ? entry.body : null)

/** The recorded list closest to what the page asked for. */
function pickVariant(list, wanted) {
  const usable = list.filter((item) =>
    [...item.params.keys()].every((key) => !FILTERS.has(key) || !wanted.has(key) || item.params.get(key) === wanted.get(key)),
  )
  const pool = usable.length ? usable : list
  return [...pool].sort((a, b) => {
    const sizeA = rows(a.entry)?.length ?? -1
    const sizeB = rows(b.entry)?.length ?? -1
    if (sizeB !== sizeA) return sizeB - sizeA
    // A recording without a refusals in it beats an empty or refused one.
    return (a.entry?.status ?? 500) - (b.entry?.status ?? 500)
  })[0]
}

function matches(row, params) {
  for (const key of FILTERS) {
    const want = params.get(key)
    if (!want) continue
    if (key === 'q') {
      const text = `${row?.name ?? ''} ${row?.title ?? ''} ${row?.summary ?? ''} ${row?.email ?? ''}`.toLowerCase()
      if (!text.includes(want.toLowerCase())) return false
      continue
    }
    const value = row?.[key] ?? row?.[key.replace(/_(\w)/g, (_, c) => c.toUpperCase())]
    if (String(value ?? '').toUpperCase() !== want.toUpperCase()) return false
  }
  return true
}

export function read(key) {
  const recordings = current?.recordings
  if (!recordings) return { status: 401, body: problem('SESSION_REQUIRED', 401) }
  const { pathname, params } = splitKey(key)
  const fallback = demoCollection(pathname, params)
  const exact = recordings['GET ' + key]
  // Prefer the real recording when it contains rows; replace only known
  // capture-time 404s with complete demo collections.
  if (exact && (exact.status < 400 || !fallback)) return exact
  if (fallback) return fallback

  const variants = reads(recordings).filter((item) => item.pathname === pathname)
  if (!variants.length) {
    // An id-shaped path is a single thing that is genuinely absent; anything else
    // is a list the demo simply has nothing in.
    const tail = pathname.split('/').filter(Boolean).pop() || ''
    return { status: UUID.test(tail) ? 404 : 200, body: UUID.test(tail) ? problem('NOT_FOUND', 404) : { items: [], total: 0 } }
  }
  const best = pickVariant(variants, params)
  if (best.entry.status >= 400) return best.entry
  const collected = rows(best.entry)
  if (!collected) return best.entry

  const filtered = collected.filter((row) => matches(row, params))
  const limit = Number(params.get('limit') || 0)
  const page = Number(params.get('page') || 1)
  const start = limit > 0 ? (Math.max(1, page) - 1) * limit : 0
  const items = limit > 0 ? filtered.slice(start, start + limit) : filtered
  return {
    status: 200,
    body: { ...best.entry.body, items, total: filtered.length, nextCursor: null },
  }
}

function problem(code, status, message) {
  return {
    type: `urn:devworkspace:problem:${code}`,
    title: message || code,
    status,
    code,
    message: message || code,
  }
}

/** Every stored copy of the thing a path points at, newest shapes first. */
function findRows(recordings, targetId) {
  const found = []
  for (const [key, entry] of Object.entries(recordings)) {
    if (!key.startsWith('GET ')) continue
    walk(entry.body, (row) => {
      if (row && typeof row === 'object' && row.id === targetId) found.push(row)
    })
  }
  return found
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  if (!value || typeof value !== 'object') return
  visit(value)
  for (const child of Object.values(value)) walk(child, visit)
}

const tail = (pathname) => pathname.split('/').filter(Boolean).pop() || ''

function listsHolding(recordings, pathname, targetId) {
  const touched = []
  for (const [key, entry] of Object.entries(recordings)) {
    if (!key.startsWith('GET ') || entry.status >= 400) continue
    const items = rows(entry)
    if (!items) continue
    if (splitKey(key.slice(4)).pathname !== pathname) continue
    const at = items.findIndex((row) => row?.id === targetId)
    if (at >= 0) touched.push({ items, at, entry })
  }
  return touched
}

export async function write(method, key, body, headers) {
  const recordings = current?.recordings
  if (!recordings) return { status: 401, body: problem('SESSION_REQUIRED', 401) }
  const { pathname, params } = splitKey(key)
  const segments = pathname.split('/').filter(Boolean)
  const last = tail(pathname)
  const payload = body && typeof body === 'object' ? body : {}

  if (method === 'DELETE') {
    if (!UUID.test(last)) return { status: 400, body: problem('INVALID_INPUT', 400) }
    const parent = '/' + segments.slice(0, -1).join('/')
    const removed = listsHolding(recordings, parent, last)
    for (const { items, at } of removed.reverse()) items.splice(at, 1)
    delete recordings['GET ' + pathname]
    for (const [key2] of Object.entries(recordings)) {
      if (key2.startsWith('GET ') && splitKey(key2.slice(4)).pathname.startsWith(pathname + '/')) delete recordings[key2]
    }
    persist()
    return { status: 204, body: null }
  }

  if (method === 'PATCH') {
    const targetId = UUID.test(last) ? last : params.get('id')
    const copies = targetId ? findRows(recordings, targetId) : []
    if (!copies.length) return { status: 404, body: problem('NOT_FOUND', 404) }
    const sent = headers.get('If-Match') || headers.get('if-match')
    if (sent && /^\s*"?\d+"?\s*$/.test(sent) && copies[0].revision != null) {
      if (String(sent.replace(/[^0-9]/g, '')) !== String(copies[0].revision)) {
        return { status: 412, body: problem('STALE_REVISION', 412, 'This item changed elsewhere. Reload before saving.') }
      }
    }
    const stamp = now()
    for (const copy of copies) {
      for (const [field, value] of Object.entries(payload)) if (value !== undefined) copy[field] = value
      copy.revision = Number(copy.revision ?? 1) + 1
      copy.updated_at = stamp
    }
    persist()
    return { status: 200, body: copies[0], etag: String(copies[0].revision) }
  }

  // POST either adds a row to a list that exists, or performs an action on one.
  const collection = reads(recordings).find((item) => item.pathname === pathname && rows(item.entry))
  if (collection && !UUID.test(last)) return create(recordings, pathname, collection, payload)

  const ownerId = segments[segments.length - 2]
  const owned = UUID.test(ownerId || '') ? findRows(recordings, ownerId) : []
  switch (last) {
    case 'read': {
      for (const row of owned) row.read_at = row.read_at || now()
      persist()
      return { status: 200, body: { status: 'ok' } }
    }
    case 'read-all': {
      walk(recordings, () => {})
      for (const [, entry] of Object.entries(recordings)) {
        for (const row of rows(entry) ?? []) if (row && 'read_at' in row) row.read_at = row.read_at || now()
      }
      persist()
      return { status: 200, body: { status: 'ok' } }
    }
    case 'decisions': {
      for (const row of owned) {
        row.decision = payload.decision ?? row.decision
        row.status = payload.decision === 'CHANGES' ? 'CHANGES_REQUESTED' : 'APPROVED'
        row.decided_at = now()
        row.revision = Number(row.revision ?? 1) + 1
      }
      persist()
      return { status: 200, body: { status: 'ok' } }
    }
    case 'comments':
    case 'replies':
    case 'feedback': {
      const list = reads(recordings).find((item) => item.pathname === pathname && rows(item.entry))
      if (list) return create(recordings, pathname, list, { ...payload, author_id: signedInAs(), occurred_at: now() })
      return { status: 200, body: { status: 'ok' } }
    }
    default:
      break
  }

  if (/(^|\/)(uploads?|finalize|retry|assets?|logo|image|preview|download|versions$)/.test(pathname)) {
    return { status: 503, body: problem('UNAVAILABLE', 503, 'Files are not part of the offline demo.') }
  }
  return { status: 200, body: { status: 'ok' } }
}

function create(recordings, pathname, collection, payload) {
  const template = rows(collection.entry)?.[0] ?? {}
  const row = { ...shallowPick(template), ...payload }
  row.id = crypto.randomUUID()
  row.revision = 1
  row.created_at = now()
  row.updated_at = now()
  if (!row.organization_id) row.organization_id = template.organization_id
  const projectId = pathname.match(/projects\/([0-9a-f-]{36})/i)?.[1]
  if (projectId && !row.project_id) row.project_id = projectId
  for (const item of reads(recordings).filter((entry) => entry.pathname === pathname)) {
    const items = rows(item.entry)
    if (items) items.unshift(row)
    if (item.entry.body && typeof item.entry.body === 'object') item.entry.body.total = items?.length ?? 1
  }
  persist()
  return { status: 201, body: row, etag: '1' }
}

// Copying structural fields from a sibling row keeps a created item renderable by
// the same code that renders a recorded one.
function shallowPick(row) {
  const keep = {}
  for (const [key, value] of Object.entries(row ?? {})) {
    if (['id', 'revision', 'created_at', 'updated_at', 'title', 'name', 'summary', 'total'].includes(key)) continue
    if (value === null || ['number', 'boolean'].includes(typeof value) || typeof value === 'string') keep[key] = value
  }
  return keep
}

export { problem, UUID }
