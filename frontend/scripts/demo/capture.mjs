// Captures the hosted demo's real responses into per-account recordings, so the
// frontend can be served with no backend at all. Run against a live deployment:
//
//   node scripts/demo/capture.mjs [https://<host>] [email ...]
//
// Listing emails re-records only those accounts and merges them into the
// existing manifest, so one account can be retaken without sitting through
// the whole set again.
//
// Output is frontend/src/demo/recordings/<account>.json: one entry per request,
// keyed exactly the way the browser will ask for it later. Refusals are recorded
// too, because a role that cannot read something should keep seeing the same
// refusal it sees today — only without the wait.
//
// The seven accounts and their shared password are already printed on the public
// login page, so nothing new is baked in here. Fields that look like credentials
// are dropped on the way out.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const ORIGIN = (process.argv[2] || 'https://frontend-pi-eight-ew4t31qvv2.vercel.app').replace(/\/$/, '');
const API = `${ORIGIN}/api/v1`;
const PASSWORD = 'Password123!';
const OUT = new URL('../../src/demo/recordings/', import.meta.url).pathname;

const ACCOUNTS = [
  'demo@agency.com',
  'admin@agency.com',
  'pm@agency.com',
  'designer@agency.com',
  'viewer@agency.com',
  'sarah.jenkins@acmeglobal.com',
  'marc.wong@acmeglobal.com',
];

const REDACT = /^(token|secret|password|passwordhash|apikey|api_?key|authorization|cookie|session_?token|ip|ip_?address|client_?ip|envelope)$/i;

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const clean = {};
  for (const [key, raw] of Object.entries(value)) {
    if (REDACT.test(key)) continue;
    clean[key] = scrub(raw);
  }
  return clean;
}

function session() {
  const jar = new Map();
  let csrf = '';
  const state = { principal: '' };
  const call = async (method, path, body) => {
    const headers = {
      origin: ORIGIN,
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    };
    // Every /organizations/... read, including plain GETs, is refused with 400
    // unless the caller names the principal it is acting as.
    if (state.principal) headers['x-organization-principal'] = state.principal;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
    const res = await fetch(API + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') jar.delete(name);
      else jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = null;
    }
    return { status: res.status, body: json };
  };
  return {
    state,
    call,
    refresh: async () => {
      csrf = (await call('GET', '/identity/csrf')).body?.token || '';
    },
  };
}

// Kept deliberately below the live abuse budget of 100 requests a minute.
const pace = () => new Promise((r) => setTimeout(r, 650));

async function signIn(email) {
  const s = session();
  await s.refresh();
  const res = await s.call('POST', '/identity/login', { email, password: PASSWORD });
  if (res.status !== 200) {
    throw new Error(`login -> ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  await s.refresh();
  const internal = items((await s.call('GET', '/me/principals')).body)[0] || {};
  const client = items((await s.call('GET', '/me/client-principals')).body)[0] || {};
  // Client principals report their organization in camelCase, internal ones in
  // snake_case; reading only one form silently records an empty portal.
  s.state.org =
    internal.organizationId || internal.organization_id || client.organizationId || client.organization_id || '';
  s.state.principal = internal.id || client.id || '';
  if (!s.state.principal) throw new Error('this account has no principal to act as');
  return s;
}

const items = (body) => (Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : []);
const idOf = (row) => row?.id ?? row?.organization_id ?? row?.project_id ?? row?.client_id ?? null;
const first = async (s, path) => items((await s.call('GET', path)).body);

/** Every read this account can be asked for, built from what it can actually see. */
async function plan(s) {
  const paths = [];
  const at = (p) => {
    if (!paths.includes(p)) paths.push(p);
  };
  for (const p of ['/me', '/me/principals', '/me/client-principals', '/me/image', '/me/notification-preferences', '/me/sessions']) at(p);

  const org = s.state.org;
  if (!org) return { paths, org: '' };

  const o = `/organizations/${org}`;
  for (const p of [
    o, `${o}/team`, `${o}/team?limit=100`, `${o}/invitations`, `${o}/invitations?limit=100`, `${o}/logo`,
    `${o}/clients`, `${o}/clients?limit=100`, `${o}/clients?limit=100&page=1`, `${o}/clients?limit=1`,
    `${o}/projects`, `${o}/projects?limit=100`, `${o}/projects?limit=100&page=1`, `${o}/projects?limit=1`,
    `${o}/dashboard?limit=10`, `${o}/my-tasks`, `${o}/my-tasks?limit=100`, `${o}/my-tasks?limit=5`,
    `${o}/notifications?limit=8`, `${o}/notifications?limit=100&page=1`, `${o}/notifications?limit=5`,
    `${o}/reviews`, `${o}/reviews?limit=100`, `${o}/reviews?status=OPEN&limit=5`,
    `${o}/documents`, `${o}/documents?limit=100`, `${o}/audit?limit=100`, `${o}/reports`,
    `${o}/portal`, `${o}/portal/projects?limit=50`, `${o}/portal/projects?limit=1`,
    `${o}/portal/notifications?limit=8`, `${o}/portal/notifications?limit=100`,
    `${o}/portal/reviews?status=OPEN&limit=100`, `${o}/portal/reviews?status=OPEN&limit=1`,
  ]) at(p);

  for (const c of (await first(s, `${o}/clients?limit=100`)).slice(0, 5)) {
    at(`${o}/clients/${idOf(c)}`);
    at(`${o}/clients/${idOf(c)}/contacts`);
    at(`${o}/clients/${idOf(c)}/contacts?limit=100`);
    at(`${o}/clients/${idOf(c)}/invitations?limit=100`);
  }

  for (const p of (await first(s, `${o}/projects?limit=100`)).slice(0, 6)) {
    const base = `${o}/projects/${idOf(p)}`;
    for (const suffix of [
      '', '/members', '/members?limit=100', '/milestones', '/milestones?limit=100',
      '/milestones?status=OPEN&limit=10', '/tasks', '/tasks?limit=100', '/tasks?limit=1',
      '/deliverables', '/deliverables?limit=100', '/versions', '/versions?limit=100',
      '/discussions', '/discussions?limit=100', '/folders', '/folders?limit=100',
      '/grants', '/grants?limit=100', '/activity?limit=5', '/activity?limit=100',
      '/updates?limit=6', '/reviews?limit=10', '/reviews?limit=100', '/candidates',
      `/documents?project_id=${idOf(p)}&limit=100`,
    ]) at(base + suffix);

    for (const t of (await first(s, `${base}/tasks?limit=100`)).slice(0, 12)) {
      at(`${base}/tasks/${idOf(t)}`);
      at(`${base}/tasks/${idOf(t)}/checklist`);
      at(`${base}/tasks/${idOf(t)}/comments`);
      at(`${base}/tasks/${idOf(t)}/history`);
    }
    for (const d of (await first(s, `${base}/deliverables?limit=100`)).slice(0, 8)) {
      at(`${base}/deliverables/${idOf(d)}`);
      at(`${base}/deliverables/${idOf(d)}/versions`);
    }
    for (const r of (await first(s, `${base}/reviews?limit=10`)).slice(0, 6)) {
      at(`${base}/reviews/${idOf(r)}`);
      at(`${base}/reviews/${idOf(r)}/feedback?limit=100`);
    }
    for (const doc of (await first(s, `${base}/documents?limit=100`)).slice(0, 8)) {
      at(`${base}/documents/${idOf(doc)}`);
    }
    for (const m of (await first(s, `${base}/milestones?limit=100`)).slice(0, 8)) {
      at(`${base}/milestones/${idOf(m)}`);
    }
  }

  for (const p of (await first(s, `${o}/portal/projects?limit=50`)).slice(0, 6)) {
    const pid = idOf(p);
    if (!pid) continue;
    const base = `${o}/portal/projects/${pid}`;
    for (const suffix of ['', '/versions?limit=10', '/versions?limit=50', '/reviews?limit=10', '/reviews?status=OPEN&limit=1', '/notifications?limit=8']) at(base + suffix);
    at(`${o}/portal/updates?project_id=${pid}&limit=5`);
    for (const r of (await first(s, `${base}/reviews?limit=10`)).slice(0, 6)) {
      at(`${base}/reviews/${idOf(r)}`);
      at(`${base}/reviews/${idOf(r)}/feedback?limit=100`);
    }
  }
  return { paths, org };
}

await mkdir(OUT, { recursive: true });
const only = process.argv.slice(3);
const existing = await readFile(`${OUT}manifest.json`, 'utf8').then((t) => JSON.parse(t)).catch(() => []);
const manifest = existing.filter((row) => !only.length || !only.includes(row.email));
for (const email of ACCOUNTS) {
  if (only.length && !only.includes(email)) continue;
  let s;
  try {
    s = await signIn(email);
  } catch (error) {
    console.log(`SKIP ${email}: ${String(error).split('\n')[0]}`);
    continue;
  }
  const { paths, org } = await plan(s);
  const file = `${OUT}${email.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
  // One dropped TLS read must not throw away the ~90 requests already paid for,
  // so the file on disk starts the run and answered paths are merged into it.
  const doc =
    (await readFile(file, 'utf8')
      .then((t) => JSON.parse(t))
      .catch(() => null)) || { email, capturedFrom: ORIGIN, org, recordings: {} };
  doc.capturedFrom = ORIGIN;
  doc.org = org;
  const recordings = doc.recordings;
  let refused = 0;
  let missed = 0;
  for (const [index, path] of paths.entries()) {
    await pace();
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await s.call('GET', path);
        break;
      } catch (error) {
        if (attempt === 2) console.log(`  unreachable ${path}: ${String(error).split('\n')[0]}`);
        else await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    if (!res) {
      missed++;
      continue;
    }
    if (res.status >= 400) refused++;
    recordings['GET ' + path] = { status: res.status, body: scrub(res.body) };
    if (index % 10 === 0) await writeFile(file, JSON.stringify(doc, null, 1));
  }
  await writeFile(file, JSON.stringify(doc, null, 1));
  manifest.push({ email, org, reads: paths.length, refused, missed });
  console.log(`ok ${email}: ${paths.length - missed}/${paths.length} reads (${refused} refusals/misses, ${missed} unreachable)`);
}
manifest.sort((a, b) => ACCOUNTS.indexOf(a.email) - ACCOUNTS.indexOf(b.email));
await writeFile(`${OUT}manifest.json`, JSON.stringify(manifest, null, 1));
console.log(`wrote ${manifest.length} recordings to ${OUT}`);
