import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = 'https://localhost:8443';
const CA = fs.readFileSync(new URL('../../../backend/.local/tls/localhost.pem', import.meta.url));
const MAILPIT = 'http://127.0.0.1:8025/api/v1';

const OWNER_EMAIL = 'demo@agency.com';
const PASSWORD = 'Password123!';
const ORG_NAME = 'Apex Digital Studio';
const PROJECT_HINT = 'OmniPay';

const DEMOS = [
  { email: 'admin@agency.com', name: 'Nadia Hassan', kind: 'internal', orgRole: 'ADMIN' },
  { email: 'pm@agency.com', name: 'Karim Sobhy', kind: 'internal', orgRole: 'MEMBER', projectRole: 'MANAGER' },
  { email: 'designer@agency.com', name: 'Layla Adel', kind: 'internal', orgRole: 'MEMBER', projectRole: 'CONTRIBUTOR' },
  { email: 'viewer@agency.com', name: 'Omar Saleh', kind: 'internal', orgRole: 'MEMBER', projectRole: 'VIEWER' },
  { email: 'sarah.jenkins@acmeglobal.com', name: 'Sarah Jenkins', kind: 'client', projectRole: 'APPROVER' },
  { email: 'marc.wong@acmeglobal.com', name: 'Marc Wong', kind: 'client', projectRole: 'REVIEWER' },
];

function req(path, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Origin: BASE, ...(options.headers || {}) };
    if (options.method === 'POST' && !headers['idempotency-key']) {
      headers['idempotency-key'] = crypto.randomUUID();
    }
    const r = https.request(new URL(path, BASE), { method: options.method || 'GET', headers, ca: CA, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* non-JSON responses are kept as text */ }
        resolve({
          status: res.statusCode,
          text,
          json,
          etag: res.headers.etag,
          cookies: res.headers['set-cookie'] || [],
          cookie: cookieHeader(res.headers['set-cookie']),
        });
      });
    });
    r.on('error', reject);
    if (options.body) {
      r.setHeader('Content-Type', 'application/json');
      r.write(JSON.stringify(options.body));
    }
    r.end();
  });
}

const cookieHeader = (setCookie) => (setCookie || []).map((c) => c.split(';')[0]).join('; ');

async function login(email, password) {
  const csrf = await req('/api/v1/identity/csrf');
  const res = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf.json.token, Cookie: csrf.cookie },
    body: { email, password },
  });
  if (res.status !== 200) return null;
  const session = res.cookies;
  const next = await req('/api/v1/identity/csrf', { headers: { Cookie: res.cookie } });
  const pairs = [...session, ...next.cookies].map((c) => c.split(';')[0]);
  return { email, token: next.json.token, cookie: [...new Set(pairs)].join('; ') };
}

async function waitForMailToken(email, subjectMatch, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const list = await (await fetch(MAILPIT + '/messages')).json();
    const hit = (list.messages || []).find((m) =>
      m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()) && subjectMatch.test(m.Subject || '')
    );
    if (hit) {
      const detail = await (await fetch(`${MAILPIT}/message/${hit.ID}`)).json();
      const body = [detail.Text, detail.Html].filter(Boolean).join(' ');
      // Tokens are JWTs, so the match must include the dot separators.
      const token = (body.match(/[?&]token=([A-Za-z0-9._~+/=-]+)/) || [])[1];
      if (token) return token;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('No ' + label + ' mail found for ' + email);
}

async function register(email, password, name) {
  const csrf = await req('/api/v1/identity/csrf');
  const res = await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf.json.token, Cookie: csrf.cookie },
    body: { email, password, name },
  });
  if (res.status >= 400 && res.status !== 409) throw new Error('register ' + email + ' -> ' + res.status + ' ' + res.text);
  // Re-running against an existing account: it is already verified if it can sign in.
  if (await login(email, password)) return;
  const verifyToken = await waitForMailToken(email, /verify/i, 'verification');
  const c2 = await req('/api/v1/identity/csrf');
  const verified = await req('/api/v1/identity/verify', {
    method: 'POST',
    headers: { 'x-csrf-token': c2.json.token, Cookie: c2.cookie },
    body: { token: verifyToken },
  });
  if (verified.status >= 400) throw new Error('verify ' + email + ' -> ' + verified.status + ' ' + verified.text);
}

const auth = (session, principalId) => ({
  Cookie: session.cookie,
  ...(session.token ? { 'x-csrf-token': session.token } : {}),
  ...(principalId ? { 'x-organization-principal': principalId } : {}),
});

async function internalPrincipal(session, orgId) {
  const res = await req('/api/v1/me/principals', { headers: { Cookie: session.cookie } });
  return (res.json?.items || []).find((p) => p.organizationId === orgId) || null;
}

async function clientPrincipal(session, orgId) {
  const res = await req('/api/v1/me/client-principals', { headers: { Cookie: session.cookie } });
  return (res.json?.items || []).find((p) => p.organizationId === orgId) || null;
}

async function run() {
  const owner = await login(OWNER_EMAIL, PASSWORD);
  if (!owner) throw new Error('Owner account ' + OWNER_EMAIL + ' did not sign in. Is the backend running?');

  const principals = (await req('/api/v1/me/principals', { headers: { Cookie: owner.cookie } })).json?.items || [];
  let orgId = null;
  let ownerPrincipal = null;
  for (const p of principals) {
    const id = p.organizationId || p.organization_id;
    const org = await req('/api/v1/organizations/' + id, { headers: auth(owner, p.id) });
    if (org.json?.name === ORG_NAME || org.json?.organization?.name === ORG_NAME) {
      orgId = id;
      ownerPrincipal = p;
      break;
    }
  }
  if (!orgId) throw new Error('Organization "' + ORG_NAME + '" not reachable for ' + OWNER_EMAIL);
  ownerPrincipal.orgId = orgId;
  console.log('Org      :', ORG_NAME, orgId);

  const projects = (await req(`/api/v1/organizations/${orgId}/projects?limit=100`, { headers: auth(owner, ownerPrincipal.id) })).json;
  const projectList = projects?.items || projects || [];
  const project = projectList.find((p) => (p.name || '').includes(PROJECT_HINT)) || projectList[0];
  if (!project) throw new Error('No project found in ' + ORG_NAME);
  console.log('Project  :', project.name, project.id);

  const clientId = project.client_id || project.clientId || null;
  if (!clientId && DEMOS.some((d) => d.kind === 'client')) throw new Error('Project "' + project.name + '" has no client, so client accounts cannot be created');

  async function ensureContact(demo, client) {
    const list = (await req(`/api/v1/organizations/${orgId}/clients/${client}/contacts?limit=100`, { headers: auth(owner, ownerPrincipal.id) })).json;
    const found = (list?.items || list || []).find((c) => (c.email || '').toLowerCase() === demo.email.toLowerCase());
    if (found) return found.id;
    const created = await req(`/api/v1/organizations/${orgId}/clients/${client}/contacts`, {
      method: 'POST',
      headers: auth(owner, ownerPrincipal.id),
      body: { name: demo.name, email: demo.email, status: 'ACTIVE' },
    });
    if (!created.json?.id) throw new Error('contact create failed for ' + demo.email + ': ' + created.status + ' ' + created.text);
    return created.json.id;
  }

  const results = [];
  for (const demo of DEMOS) {
    let session = await login(demo.email, PASSWORD);
    let state = session ? 'already existed' : 'new account';

    const locate = async () =>
      demo.kind === 'internal' ? internalPrincipal(session, orgId) : clientPrincipal(session, orgId);

    if (!session) {
      if (demo.kind === 'internal') {
        const inv = await req(`/api/v1/organizations/${orgId}/invitations`, {
          method: 'POST',
          headers: auth(owner, ownerPrincipal.id),
          body: { email: demo.email, role: demo.orgRole },
        });
        if (inv.status >= 400 && inv.status !== 409) throw new Error('invite ' + demo.email + ' -> ' + inv.status + ' ' + inv.text);
      } else {
        demo.contactId = await ensureContact(demo, clientId);
        const inv = await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts/${demo.contactId}/invitations`, {
          method: 'POST',
          headers: auth(owner, ownerPrincipal.id),
          body: { project_id: project.id, role: demo.projectRole },
        });
        if (inv.status >= 400 && inv.status !== 409) throw new Error('client invite ' + demo.email + ' -> ' + inv.status + ' ' + inv.text);
      }
      await register(demo.email, PASSWORD, demo.name);
      session = await login(demo.email, PASSWORD);
      if (!session) throw new Error('Could not sign in ' + demo.email + ' right after registering');
    }

    if (!(await locate())) {
      if (demo.kind === 'client') demo.contactId = demo.contactId || (await ensureContact(demo, clientId));
      const inviteToken = await waitForMailToken(demo.email, /invit/i, 'invitation');
      const accept = await req('/api/v1/invitations/accept', {
        method: 'POST',
        headers: auth(session),
        body: { token: inviteToken },
      });
      if (accept.status >= 400) throw new Error('accept invite for ' + demo.email + ' -> ' + accept.status + ' ' + accept.text);
      session = await login(demo.email, PASSWORD);
      if (!session) throw new Error('Could not sign in ' + demo.email + ' after accepting the invite');
      if (!(await locate())) throw new Error(demo.email + ' accepted the invite but still has no ' + (demo.kind === 'client' ? 'client' : 'org') + ' principal');
      state = 'joined ' + ORG_NAME;
    }

    if (demo.kind === 'internal' && demo.projectRole) {
      demo.principalId = (await locate()).id;
    }
    if (demo.kind === 'client') {
      demo.principalId = (await locate()).id;
      demo.contactId = demo.contactId || (await ensureContact(demo, clientId));
      const grant = await req(`/api/v1/organizations/${orgId}/projects/${project.id}/grants`, {
        method: 'POST',
        headers: auth(owner, ownerPrincipal.id),
        body: { contact_id: demo.contactId, role: demo.projectRole, status: 'ACTIVE' },
      });
      if (grant.status >= 400 && grant.status !== 409) state += ' | grant failed ' + grant.status;
      const portal = await req(`/api/v1/organizations/${orgId}/portal/projects?limit=20`, {
        headers: { Cookie: session.cookie, 'x-organization-principal': demo.principalId },
      });
      const visible = (portal.json?.items || portal.json || []).length;
      state += ' | portal ' + portal.status + ' (' + visible + ' projects)';
    }

    results.push({ role: demo.projectRole || demo.orgRole, email: demo.email, state });
  }

  for (const d of DEMOS.filter((x) => x.kind === 'internal' && x.projectRole)) {
    const add = await req(`/api/v1/organizations/${orgId}/projects/${project.id}/members`, {
      method: 'POST',
      headers: auth(owner, ownerPrincipal.id),
      body: { membership_id: d.principalId, role: d.projectRole, status: 'ACTIVE' },
    });
    console.log('Project role ' + d.projectRole.padEnd(12) + d.email + ' -> ' + add.status);
  }

  const members = (await req(`/api/v1/organizations/${orgId}/projects/${project.id}/members`, { headers: auth(owner, ownerPrincipal.id) })).json;
  const memberList = members?.items || members || [];
  const byPrincipal = new Map(memberList.map((m) => [m.membership_id || m.membershipId, m.id]));

  const assignments = [
    ['Write usage guidance for form fields', 'designer@agency.com'],
    ['Prepare handoff pack for engineering', 'designer@agency.com'],
    ['Schedule the launch checkpoint', 'pm@agency.com'],
  ];
  const tasks = (await req(`/api/v1/organizations/${orgId}/projects/${project.id}/tasks?limit=100`, { headers: auth(owner, ownerPrincipal.id) })).json;
  for (const t of tasks?.items || []) {
    const wanted = assignments.find(([title]) => t.title === title);
    if (!wanted) continue;
    const demo = DEMOS.find((d) => d.email === wanted[1]);
    const assigneeId = byPrincipal.get(demo?.principalId);
    if (!assigneeId) continue;
    if (t.assignee_id === assigneeId) continue;
    const fresh = await req(`/api/v1/organizations/${orgId}/projects/${project.id}/tasks/${t.id}`, { headers: auth(owner, ownerPrincipal.id) });
    const patch = await req(`/api/v1/organizations/${orgId}/projects/${project.id}/tasks/${t.id}`, {
      method: 'PATCH',
      // The API wants the numeric row revision, not the HTTP ETag header.
      headers: { ...auth(owner, ownerPrincipal.id), 'If-Match': '"' + fresh.json.revision + '"' },
      body: {
        title: fresh.json.title,
        description: fresh.json.description || '',
        milestone_id: fresh.json.milestone_id ?? null,
        assignee_id: assigneeId,
        priority: fresh.json.priority,
        status: fresh.json.status,
        due_at: fresh.json.due_at,
        position: fresh.json.position || 0,
      },
    });
    console.log('Assigned "' + t.title + '" -> ' + wanted[1] + ': ' + patch.status);
  }

  console.log('\n=== DEMO ACCOUNTS (' + PASSWORD + ') ===');
  console.log('OWNER       ' + OWNER_EMAIL.padEnd(34) + 'organization owner + project manager');
  for (const r of results) console.log(String(r.role).padEnd(12) + r.email.padEnd(34) + r.state);
}

run().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
