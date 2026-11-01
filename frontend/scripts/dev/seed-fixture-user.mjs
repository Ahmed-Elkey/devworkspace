/**
 * Seeds the pre-existing "phase2" owner fixture account that some verification
 * suites log in with:
 *   p2-7c1bf40a-8623-4726-9c52-f5db8e088ebd@example.test
 * Everything goes through the real backend API (Vite proxy → :3001). Idempotent.
 */
import { client as makeClient, registerAndVerifyUser, principalOf, waitForMail, pw } from './seed-lib.mjs';

const OWNER = {
  name: 'Paige Elkahky',
  email: 'p2-7c1bf40a-8623-4726-9c52-f5db8e088ebd@example.test',
  password: pw.fixture,
};

async function main() {
  const api = makeClient();

  // 1. Try logging in first (idempotency)
  let login = await api.post('/identity/login', { email: OWNER.email, password: OWNER.password });
  if (login.ok) {
    console.log('[fixture] account exists and login works');
  } else {
    console.log('[fixture] login failed — seeding account fresh');
    await registerAndVerifyUser(api, OWNER);
    console.log('[fixture] registered + verified + logged in');
  }

  // 2. Org + principals
  let principal = principalOf(await api.call('/me/principals'));
  let orgId, principalId;
  if (principal) {
    orgId = principal.organizationId || principal.organization_id;
    principalId = principal.id;
    console.log('[fixture] org exists:', orgId);
  } else {
    const org = await api.post('/organizations', {
      name: 'Harbor Line Studio',
      description: 'Fixture org for local verification suites',
      timezone: 'Africa/Cairo',
    });
    if (!org.ok) throw new Error('org create failed: ' + JSON.stringify(org.data));
    // session rotates after org creation
    await api.post('/identity/login', { email: OWNER.email, password: OWNER.password });
    principal = principalOf(await api.call('/me/principals'));
    orgId = principal.organizationId || principal.organization_id;
    principalId = principal.id;
    console.log('[fixture] org created');
  }
  const hp = { 'x-organization-principal': principalId };

  // 3. Team members (owner → manager → member) via real invitation flow
  const members = [
    { name: 'Maya Hassan', email: 'maya.hassan@harborline.example', role: 'ADMIN' },
    { name: 'Omar Zaki', email: 'omar.zaki@harborline.example', role: 'MEMBER' },
  ];
  for (const m of members) {
    const inv = await api.post(`/organizations/${orgId}/invitations`, { email: m.email, role: m.role }, { headers: hp });
    if (!inv.ok && !/409|conflict/i.test(JSON.stringify(inv.data))) {
      console.log(`[fixture] invite ${m.email} skipped/failed:`, inv.status);
      continue;
    }
    // fresh API client for the invited user
    const mApi = makeClient();
    const mLogin = await mApi.post('/identity/login', { email: m.email, password: pw.members });
    if (mLogin.ok) {
      console.log(`[fixture] member ${m.email} already onboarded`);
    } else {
      await registerAndVerifyUser(mApi, { name: m.name, email: m.email, password: pw.members });
      const mail = await waitForMail(m.email, 'invitation');
      if (!mail) { console.log(`[fixture] no invitation mail for ${m.email}`); continue; }
      const token = /\/invitations\/accept\?token=([A-Za-z0-9_-]+)/.exec(mail.Text || '')[1];
      const acc = await mApi.post('/invitations/accept', { token });
      if (!acc.ok) console.log(`[fixture] accept failed for ${m.email}:`, acc.status, JSON.stringify(acc.data));
      else console.log(`[fixture] member ${m.email} joined as ${m.role}`);
    }
  }

  // 4. Client + contact + portal invitation
  let clients = (await api.call(`/organizations/${orgId}/clients`, { headers: hp })).data;
  let client = (clients?.items || clients || [])[0];
  if (!client) {
    const c = await api.post(`/organizations/${orgId}/clients`, {
      name: 'Lighthouse Media',
      description: 'Publishing house — content & events',
      status: 'ACTIVE',
    }, { headers: hp });
    client = c.data.fields || c.data;
    const contact = await api.post(`/organizations/${orgId}/clients/${client.id}/contacts`, {
      name: 'Farida Sami',
      email: 'farida.sami@lighthousemedia.example',
      status: 'ACTIVE',
    }, { headers: hp });
    console.log('[fixture] client + contact created');
    var contactId = (contact.data.fields || contact.data).id;
  } else {
    console.log('[fixture] client exists');
    // reuse existing contact for portal access below
    const contactsRes = await api.call(`/organizations/${orgId}/clients/${client.id}/contacts`, { headers: hp });
    const contactArr = (contactsRes?.data?.items || contactsRes?.data || []);
    var contactId = (contactArr[0] || {}).id;
  }

  // 5. Project + milestones + tasks + document (portal-enabled)
  const projs = (await api.call(`/organizations/${orgId}/projects`, { headers: hp })).data;
  let project = (projs?.items || projs || [])[0];
  const ensureProjectContent = async (proj, skipProjectCreate) => {
    const ms = (await api.call(`/organizations/${orgId}/projects/${proj.id}/milestones?limit=20`, { headers: hp })).data?.items || [];
    const tasks = (await api.call(`/organizations/${orgId}/projects/${proj.id}/tasks?limit=20`, { headers: hp })).data?.items || [];
    const docs = (await api.call(`/organizations/${orgId}/documents?limit=20`, { headers: hp })).data?.items || [];
    if (ms.length && tasks.length && docs.length) { console.log('[fixture] project content already seeded:', proj.name); return; }
    if (!skipProjectCreate) {
      const p = await api.post(`/organizations/${orgId}/projects`, {
        client_id: client.id,
        name: 'Lighthouse Annual Report Redesign',
        description: 'Print + web annual report with interactive charts.',
        due_at: '2026-12-10T16:00:00.000Z',
        portal_enabled: true,
        status: 'ACTIVE',
      }, { headers: hp });
      if (!p.ok) throw new Error('project create failed: ' + JSON.stringify(p.data).slice(0, 150));
      project = p.data.fields || p.data;
    }
    const msR = await api.post(`/organizations/${orgId}/projects/${project.id}/milestones`, {
      title: 'Phase A: data gather',
      due_at: '2026-11-08T12:00:00.000Z',
      status: 'COMPLETED',
      position: 1,
    }, { headers: hp });
    const ms2R = await api.post(`/organizations/${orgId}/projects/${project.id}/milestones`, {
      title: 'Phase B: layout + proof',
      due_at: '2026-11-28T16:00:00.000Z',
      status: 'OPEN',
      position: 2,
    }, { headers: hp });
    await api.post(`/organizations/${orgId}/projects/${project.id}/tasks`, {
      title: 'Collect KPI sheets from editorial',
      description: 'Gather circulation and revenue numbers per quarter.',
      milestone_id: (msR.data.fields || msR.data).id ?? null,
      due_at: '2026-11-05T16:00:00.000Z',
      priority: 'NORMAL',
      status: 'DONE',
      position: 1,
    }, { headers: hp });
    await api.post(`/organizations/${orgId}/projects/${project.id}/tasks`, {
      title: 'Sketch chart language',
      description: 'Three chart archetypes annotated for print + web.',
      assignee_id: principalId,
      milestone_id: (ms2R.data.fields || ms2R.data).id ?? null,
      due_at: '2026-11-22T16:00:00.000Z',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      position: 2,
    }, { headers: hp });
    const r = await api.post(`/organizations/${orgId}/documents`, {
      project_id: project.id,
      title: 'Harbor Line: annual report brief',
      content: {
        version: 1,
        blocks: [
          { type: 'heading', level: 1, spans: [{ text: 'Annual Report Brief' }] },
          { type: 'paragraph', spans: [{ text: 'Fixture brief for local verification of the documents flow.' }] },
        ],
      },
    }, { headers: hp });
    console.log('[fixture] project content seeded', r.ok ? 'OK' : JSON.stringify(r.data).slice(0, 120));
  };
  if (!project) {
    await ensureProjectContent(null, true);
    project = (await api.call(`/organizations/${orgId}/projects`, { headers: hp })).data?.items?.[0];
    console.log('[fixture] project + milestones + tasks + document created');
  } else {
    console.log('[fixture] project exists — checking content');
    await ensureProjectContent(project, false);
  }

  // 6. Portal access: invite the contact as project APPROVER (needs project_id)
  if (contactId) {
    const cinv = await api.post(`/organizations/${orgId}/clients/${client.id}/contacts/${contactId}/invitations`, {
      project_id: project.id,
      role: 'APPROVER',
    }, { headers: hp });
    if (!cinv.ok) {
      const code = cinv.data?.code || cinv.status;
      if (code === 'TARGET_UNAVAILABLE') {
        console.log('[fixture] portal invitation already exists — skipping invite (409)');
      } else {
        console.log('[fixture] portal invitation failed:', code, JSON.stringify(cinv.data).slice(0, 250));
      }
    } else {
      console.log('[fixture] portal invitation sent');
    }
    // always ensure the contact has an account and can accept via the invitation link
    const fApi = makeClient();
    const fMailLogin = await fApi.post('/identity/login', { email: 'farida.sami@lighthousemedia.example', password: pw.members });
    if (!fMailLogin.ok) {
      await registerAndVerifyUser(fApi, { name: 'Farida Sami', email: 'farida.sami@lighthousemedia.example', password: pw.members });
      console.log('[fixture] registered portal approver');
    }
    const invMail = await waitForMail('farida.sami@lighthousemedia.example', 'invitation');
    if (invMail) {
      const tk = /\/invitations\/accept\?token=([A-Za-z0-9_-]+)/.exec(invMail.Text || '')[1];
      const acc = await fApi.post('/invitations/accept', { token: tk });
      console.log('[fixture] portal approver accept:', acc.ok ? 'joined' : JSON.stringify(acc.data).slice(0, 150));
    } else {
      console.log('[fixture] no invitation mail for portal approver (invitation may already exist in DB — that is acceptable)');
    }
  }

  console.log('[fixture] SEED COMPLETE —', OWNER.email);
}
main().catch((e) => { console.error('[fixture] FAILED:', e.message); process.exit(1); });
