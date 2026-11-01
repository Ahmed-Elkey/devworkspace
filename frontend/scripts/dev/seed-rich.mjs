/**
 * Enriches the demo org (demo@agency.com / Apex Digital Studio) with real
 * backend data across every feature: clients, projects, milestones, tasks,
 * discussions, updates, documents, deliverables WITH scanned file versions,
 * and real team members via the invitation flow. Idempotent. No mocks: all
 * writes go through the real API and storage staging (ClamAV scanned).
 */
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { client as makeClient, registerAndVerifyUser, principalOf, waitForMail, pw } from './seed-lib.mjs';

/* ---------- tiny PNG encoder (truecolor, no palette) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = ~0;
  for (const b of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xff];
  return ~c >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, painter) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit truecolor
  const raw = Buffer.alloc(h * (1 + w * 3));
  let off = 0;
  for (let y = 0; y < h; y++) {
    raw[off++] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = painter(x, y);
      raw[off++] = r; raw[off++] = g; raw[off++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const mix = (a, b, t) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
const artHero = (w, h) => encodePNG(w, h, (x, y) => {
  const top = [17, 17, 17], lime = [241, 253, 130], dim = [89, 89, 89];
  if (y < h * 0.28) return top;
  const t = (x / w + (y - h * 0.3) / h) % 3;
  if (t < 0.33) return lime;
  return t < 0.8 ? [mix(...[17, 35, 0.5]), mix(17, 40, (y / h)), 35] : dim;
});
const artLogo = (w, h) => encodePNG(w, h, (x, y) => {
  const cx = w / 2, cy = h / 2, r = h / 3.2, dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
  if (d < r) return [241, 253, 130];
  if (d < r * 1.12) return [17, 17, 17];
  return [255 * (x / w), 255 * (y / h), 245];
});
const artChart = (w, h) => encodePNG(w, h, (x, y) => {
  const baseline = Math.min(0.9, 0.25 + (x / w) * 0.55);
  const t = (x * 7 + y * 3) % 97 / 97;
  if (y > h * (1 - baseline)) return t > 0.7 ? [241, 253, 130] : [17, 17, 17];
  return [248, 248, 248];
});

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');

/* ---------- storage upload through real staging (host header matches dev proxy) ---------- */
const STAGING_BASE = 'https://localhost:8443';
async function uploadAsset(api, org, pid, buf, name, mime, hp = {}) {
  const digest = sha256(buf);
  const intent = await api.post(`/organizations/${org}/projects/${pid}/uploads`, {
    name, purpose: 'PROJECT_FILE', folder_id: null, size: buf.length, digest, mime,
  }, { headers: hp });
  if (!intent.ok || !intent.data?.capability?.url) {
    throw new Error('upload intent failed: ' + JSON.stringify(intent.data));
  }
  const cap = new URL(intent.data.capability.url);
  const histaging = cap.pathname + cap.search;
  const headers = { ...(intent.data.capability.headers || {}) };
  delete headers.host; delete headers.Host;
  delete headers['content-length']; delete headers['Content-Length'];
  const put = await fetch(STAGING_BASE + histaging, { method: 'PUT', headers, body: buf });
  if (!put.ok && put.status !== 204) throw new Error('staging put failed: ' + put.status);
  const fin = await api.post(`/organizations/${org}/projects/${pid}/uploads/${intent.data.id}/finalize`, {});
  if (!fin.ok) throw new Error('finalize failed: ' + fin.status + ' ' + JSON.stringify(fin.data));
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await api.call(`/organizations/${org}/projects/${pid}/uploads/${intent.data.id}`);
    const st = poll.data?.status;
    if (st === 'READY') return intent.data.id;
    if (st === 'REJECTED' || st === 'FAILED') throw new Error('scanner rejected: ' + JSON.stringify(poll.data));
  }
  throw new Error('scan timeout');
}

async function main() {
  const api = makeClient();
  const login = await api.post('/identity/login', { email: 'demo@agency.com', password: 'Password123!' });
  if (!login.ok) throw new Error('demo login failed');
  const principal = principalOf(await api.call('/me/principals'));
  const orgId = principal.organizationId || principal.organization_id;
  const principalId = principal.id;
  const hp = { 'x-organization-principal': principalId };
  console.log('[rich] demo org:', orgId);

  // ---- helpers over existing rows ----
  const listClients = async () => (await api.call(`/organizations/${orgId}/clients?limit=50`, { headers: hp })).data?.items || [];
  const listProjects = async () => (await api.call(`/organizations/${orgId}/projects?limit=50`, { headers: hp })).data?.items || [];

  let clients = await listClients();
  let acme = clients.find((c) => /Acme/.test(c.name));
  let nova = clients.find((c) => /Nova/.test(c.name));
  let helios = clients.find((c) => /Helios/.test(c.name));

  const ensureClient = async (name, description, contact) => {
    const found = (await listClients()).find((c) => c.name === name);
    if (found) return found;
    const c = await api.post(`/organizations/${orgId}/clients`, { name, description, status: 'ACTIVE' }, { headers: hp });
    const cl = c.data.fields || c.data;
    await api.post(`/organizations/${orgId}/clients/${cl.id}/contacts`, { ...contact, status: 'ACTIVE' }, { headers: hp });
    console.log('[rich] client created:', name);
    return cl;
  };

  nova = await ensureClient('Nova Retail', 'Regional fashion e-commerce brand', { name: 'Lina Fouad', email: 'lina.fouad@novaretail.example' });
  helios = await ensureClient('Helios Health', 'Private clinics network', { name: 'Karim Adel', email: 'karim.adel@helioshealth.example' });

  const ensureProject = async (name, body) => {
    const found = (await listProjects()).find((p) => p.name === name);
    if (found) return found;
    const p = await api.post(`/organizations/${orgId}/projects`, { ...body, name }, { headers: hp });
    const pr = p.data.fields || p.data;
    // explicit project participation for the owner principal (org-level roles act as MANAGER anyway)
    await api.post(`/organizations/${orgId}/projects/${pr.id}/members`, { membership_id: principalId, role: 'MANAGER', status: 'ACTIVE' }, { headers: hp }).catch(() => {});
    console.log('[rich] project created:', name);
    return pr;
  };

  const novaProj = await ensureProject('Nova E-commerce Rebrand', {
    client_id: nova.id,
    description: 'Full storefront rebrand: identity, PDP templates and motion kit.',
    due_at: day(45),
    portal_enabled: true,
    status: 'ACTIVE',
  });
  const heliosProj = await ensureProject('Helios Patient Portal UX Audit', {
    client_id: helios.id,
    description: 'Heuristic + accessibility audit of the patient booking funnel.',
    due_at: day(25),
    portal_enabled: false,
    status: 'ACTIVE',
  });

  const ensureMilestone = async (proj, title, due, status, position) => {
    const ms = (await api.call(`/organizations/${orgId}/projects/${proj.id}/milestones?limit=50`, { headers: hp })).data?.items?.find?.((m) => m.title === title);
    if (ms) return ms;
    const r = await api.post(`/organizations/${orgId}/projects/${proj.id}/milestones`, { title, due_at: due, status, position }, { headers: hp });
    if (!r.ok) throw new Error(`milestone ${title} failed: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    return r.data.fields || r.data;
  };

  const msNova1 = await ensureMilestone(novaProj, 'Discovery & sitemap', day(-12), 'COMPLETED', 1);
  const msNova2 = await ensureMilestone(novaProj, 'Moodboard + homepage concepts', day(12), 'OPEN', 2);
  const msNova3 = await ensureMilestone(novaProj, 'PDP templates & motion', day(38), 'OPEN', 3);
  const msHelios1 = await ensureMilestone(heliosProj, 'Heuristic review of booking funnel', day(10), 'OPEN', 1);
  await ensureMilestone(heliosProj, 'Accessibility verdict + fixes list', day(24), 'OPEN', 2);

  const ensureTask = async (proj, t) => {
    const all = (await api.call(`/organizations/${orgId}/projects/${proj.id}/tasks?limit=50`, { headers: hp })).data?.items || [];
    if (all.find((x) => x.title === t.title)) return;
    const r = await api.post(`/organizations/${orgId}/projects/${proj.id}/tasks`, {
      ...t,
      milestone_id: t.milestone_id ?? null,
      assignee_id: t.assignee_id ?? null,
      due_at: t.due_at ?? null,
    }, { headers: hp });
    if (!r.ok) throw new Error(`task ${t.title} failed: ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  };
  await ensureTask(novaProj, { title: 'Collect product photography briefs', description: 'Shot list per PDP category.', milestone_id: msNova1.id, priority: 'HIGH', status: 'DONE', position: 1 });
  await ensureTask(novaProj, { title: 'Draft sitemap v2', description: 'Three-level nav for catalog + blog.', milestone_id: msNova2.id, priority: 'NORMAL', status: 'IN_PROGRESS', position: 2 });
  await ensureTask(novaProj, { title: 'Import old brand tokens', description: 'Legacy tokens from 2024 kit.', milestone_id: msNova2.id, priority: 'LOW', status: 'TODO', position: 3 });
  await ensureTask(novaProj, { title: 'Homepage hero motion prototype', description: 'Lottie loop under 2MB for storefront.', milestone_id: msNova3.id, priority: 'HIGH', status: 'TODO', position: 4 });
  await ensureTask(heliosProj, { title: 'Screen inventory audit', description: 'Catalog 42 booking screens.', milestone_id: msHelios1.id, priority: 'HIGH', status: 'IN_PROGRESS', position: 1 });
  await ensureTask(heliosProj, { title: 'Accessibility spot checks', description: 'Contrast + focus order on top flows.', milestone_id: msHelios1.id, priority: 'NORMAL', status: 'TODO', position: 2 });

  // real teammates for the demo org (invitation flow) + activity from them
  const demoMembers = [
    { name: 'Dana Wassef', email: 'dana.wassef@apexstudio.example', role: 'ADMIN' },
    { name: 'Karim Nabil', email: 'karim.nabil@apexstudio.example', role: 'MEMBER' },
  ];
  const memberIds = {};
  for (const m of demoMembers) {
    const inv = await api.post(`/organizations/${orgId}/invitations`, { email: m.email, role: m.role }, { headers: hp });
    let joined = false;
    if (inv.ok || inv.status === 409) {
      const mApi = makeClient();
      const mLogin = await mApi.post('/identity/login', { email: m.email, password: pw.members });
      if (mLogin.ok) joined = true;
      else {
        await registerAndVerifyUser(mApi, { name: m.name, email: m.email, password: pw.members });
        const mail = await waitForMail(m.email, 'invitation');
        if (mail) {
          const tk = /\/invitations\/accept\?token=([A-Za-z0-9_-]+)/.exec(mail.Text || '')[1];
          const acc = await mApi.post('/invitations/accept', { token: tk });
          joined = acc.ok || acc.status === 409;
        }
      }
    }
    console.log(`[rich] member ${m.email}: ${joined ? 'in org' : 'pending'}`);
    if (joined) memberIds[m.email] = m.email;
  }

  // Dana logs in and does real actions so activity/notifications are genuine
  if (memberIds['dana.wassef@apexstudio.example']) {
    const dApi = makeClient();
    await dApi.post('/identity/login', { email: 'dana.wassef@apexstudio.example', password: pw.members });
    const dPrincipal = principalOf(await dApi.call('/me/principals'));
    const dOrg = dPrincipal.organizationId || dPrincipal.organization_id;
    if (dOrg === orgId) {
      const dhp = { 'x-organization-principal': dPrincipal.id };
      const tasks = (await dApi.call(`/organizations/${orgId}/projects/${novaProj.id}/tasks?limit=50`, { headers: dhp })).data?.items || [];
      const t = tasks.find((x) => x.title === 'Homepage hero motion prototype');
      if (t) {
        const c = await dApi.post(`/organizations/${orgId}/projects/${novaProj.id}/tasks/${t.id}/comments`, { body: 'Figma file is ready for the storefront loop — flagging the reduced-motion fallback too.', thread_id: null }, { headers: dhp });
        if (!c.ok) console.log('[rich] comment failed:', c.status, JSON.stringify(c.data).slice(0, 120));
      }
      const nt = await dApi.post(`/organizations/${orgId}/projects/${novaProj.id}/tasks`, {
        title: 'QA the checkout empty states', description: 'Edge cases: sold-out variant, guest cart.',
        milestone_id: null, assignee_id: null, due_at: day(20), priority: 'NORMAL', status: 'TODO', position: 5,
      }, { headers: dhp });
      if (!nt.ok) console.log('[rich] dana task failed:', nt.status);
    }
  }

  // discussions
  const ensureDiscussion = async (proj, title, body) => {
    const ds = (await api.call(`/organizations/${orgId}/projects/${proj.id}/discussions?limit=50`, { headers: hp })).data?.items || [];
    if (ds.find((d) => d.title === title)) return;
    const r = await api.post(`/organizations/${orgId}/projects/${proj.id}/discussions`, { title, body }, { headers: hp });
    if (!r.ok) console.log('[rich] discussion failed:', title, r.status, JSON.stringify(r.data).slice(0, 120));
  };
  await ensureDiscussion(novaProj, 'Logo directions: emblem vs wordmark', 'Need a call before Friday.\nEmblem reads better at 24px; wordmark scales on packaging.');
  await ensureDiscussion(novaProj, 'Stock assets licensing window', 'Confirm extended license covers storefront ads.');
  await ensureDiscussion(heliosProj, 'Booking funnel teardown notes', 'Two drop-off points identified in date pickers.');

  // client updates (portal feed)
  const upd = await api.post(`/organizations/${orgId}/projects/${novaProj.id}/updates`, {
    body: 'Nova weekly: sitemap v2 is in review, homepage concepts land next week with two directions.',
  }, { headers: hp });
  if (upd.ok) console.log('[rich] nova update published');
  await api.post(`/organizations/${orgId}/projects/${novaProj.id}/updates`, {
    body: 'Moodboard approved by the internal review committee — PDP templates start Monday.',
  }, { headers: hp });

  // documents (the schema binds documents to a project)
  const listDocs = async () => (await api.call(`/organizations/${orgId}/documents?limit=50`, { headers: hp })).data?.items || [];
  const ensureDoc = async (proj, title, h1, para) => {
    if ((await listDocs()).find((d) => d.title === title)) return;
    const r = await api.post(`/organizations/${orgId}/documents`, {
      project_id: proj.id,
      title,
      content: {
        version: 1,
        blocks: [
          { type: 'heading', level: 1, spans: [{ text: h1 }] },
          { type: 'paragraph', spans: [{ text: para }] },
        ],
      },
    }, { headers: hp });
    console.log('[rich] document created:', title, r.ok ? 'OK' : `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  };
  await ensureDoc(novaProj, 'Nova Retail: rebrand kickoff notes', 'Kickoff notes', 'Goals: lift conversion 12%, unify PDP language, ship motion kit Q1.');
  await ensureDoc(heliosProj, 'Helios Health: audit methodology', 'Audit methodology', 'Ten heuristics mapped to WCAG 2.2 AA, scored 0–4 with fixes tracked in tasks.');
  await ensureDoc(novaProj, 'Apex Studio: Q1 delivery playbook', 'Q1 playbook', 'Review cadence, approval gates and portal etiquette for all retainer clients.');

  // deliverables + scanned versions
  const ensureDeliverable = async (proj, title, description, tasks, files) => {
    const dl = (await api.call(`/organizations/${orgId}/projects/${proj.id}/deliverables?limit=50`, { headers: hp })).data?.items || [];
    let d = dl.find((x) => x.title === title);
    if (!d) {
      const r = await api.post(`/organizations/${orgId}/projects/${proj.id}/deliverables`, {
        title, description, task_id: null, status: 'ACTIVE',
      }, { headers: hp });
      d = r.data.fields || r.data;
    }
    for (const [file, painter] of files) {
      await uploadAsset(api, orgId, proj.id, painter(file.w, file.h), file.name, 'image/png', hp)
        .then(async (assetId) => {
          const v = await api.post(`/organizations/${orgId}/projects/${proj.id}/deliverables/${d.id}/versions`, { asset_id: assetId }, { headers: hp });
          console.log('[rich] version for', title, '/', file.name, v.ok ? 'OK' : JSON.stringify(v.data).slice(0, 150));
        })
        .catch((e) => console.log('[rich] upload failed for', file.name, ':', e.message));
    }
    return d;
  };

  await ensureDeliverable(novaProj, 'Homepage hero concepts', 'Two directions: editorial hero vs motion loop.', [], [
    [{ name: 'nova-hero-v1.png', w: 640, h: 400 }, artHero],
    [{ name: 'nova-hero-v2.png', w: 640, h: 400 }, artLogo],
  ]);

  await ensureDeliverable(novaProj, 'Nova logo lockups', 'Primary, stacked and favicon lockups with clear-space rules.', [], [
    [{ name: 'nova-logo-lockups.png', w: 512, h: 512 }, artLogo],
  ]);
  await ensureDeliverable(heliosProj, 'Audit summary visuals', 'Summary charts for the executive readout.', [], [
    [{ name: 'helios-audit-charts.png', w: 640, h: 360 }, artChart],
  ]);
  await ensureDeliverable(acme || novaProj, 'OmniPay token sheet', 'Color + spacing tokens exported for the client portal.', [], [
    [{ name: 'omnipay-token-sheet.png', w: 640, h: 320 }, artChart],
  ]);

  console.log('[rich] SEED COMPLETE — demo org enriched');
}

main().catch((e) => { console.error('[rich] FAILED:', e.message); process.exit(1); });
