/**
 * Second-pass demo seeder. Talks ONLY to the real local API (:3001) — no direct
 * SQL, no mocks. Idempotent: every ensure* looks for an existing row by name
 * before posting, so re-running is safe.
 *
 * Covers what seed-rich.mjs left empty: project participation for Nova/Helios,
 * assignees, checklists, threaded comments, discussion replies, client grants,
 * folders, richer documents and deliverables linked to tasks.
 *
 * File-dependent entities (versions, reviews) are NOT attempted: the scanner is
 * Windows-only (packages/server/src/processing.ts runs clamscan.exe), so an
 * upload can never reach SCANNED on this machine.
 *
 * Usage: node scripts/dev/seed-fill.mjs   (run from the frontend package)
 */
import { client as makeClient, principalOf, pw } from './seed-lib.mjs';

const day = (n, h = 9) => {
  const d = new Date();
  d.setUTCHours(h, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
};

const log = (...a) => console.log('[fill]', ...a);

/** Report a rejected write instead of dying: one bad payload must not abort the run. */
function report(what, r) {
  if (r.ok) return true;
  log(`FAIL ${what}: ${r.status} ${JSON.stringify(r.data).slice(0, 600)}`);
  return false;
}

async function main() {
  const api = makeClient();
  const login = await api.post('/identity/login', { email: 'demo@agency.com', password: 'Password123!' });
  if (!login.ok) throw new Error('demo login failed: ' + JSON.stringify(login.data));
  const principal = principalOf(await api.call('/me/principals'));
  const orgId = principal.organizationId || principal.organization_id;
  const hp = { headers: { 'x-organization-principal': principal.id } };
  const P = `/organizations/${orgId}`;
  log('org', orgId);

  const items = async (path) => (await api.call(path, hp)).data?.items || [];
  const byName = (list, name) => list.find((x) => x.name === name || x.title === name);
  const patch = async (path, body, revision) => {
    const token = await api.csrf();
    return api.call(path, {
      method: 'PATCH',
      body,
      headers: {
        'x-csrf-token': token,
        // the API only accepts an If-Match it can read as an entity tag, so the revision is quoted
        ...(revision == null ? {} : { 'if-match': `"${revision}"` }),
        ...hp.headers,
      },
    });
  };

  /* ---------------- clients ---------------- */
  const clients = async () => items(`${P}/clients?limit=100`);
  const ensureClient = async (spec, contacts) => {
    let c = byName(await clients(), spec.name);
    if (!c) {
      const r = await api.post(`${P}/clients`, { name: spec.name, description: spec.description, status: 'ACTIVE' }, hp);
      if (!report('client ' + spec.name, r)) return null;
      c = r.data.fields || r.data;
      log('client +', spec.name);
    }
    const existing = (await items(`${P}/clients/${c.id}/contacts?limit=100`)).map((x) => x.email);
    for (const ct of contacts) {
      if (existing.includes(ct.email)) continue;
      const r = await api.post(`${P}/clients/${c.id}/contacts`, { name: ct.name, email: ct.email, status: 'ACTIVE' }, hp);
      if (report('contact ' + ct.email, r)) log('contact +', ct.email);
    }
    return c;
  };

  const acme = byName(await clients(), 'Acme Global Ventures');
  const nova = byName(await clients(), 'Nova Retail');
  const helios = byName(await clients(), 'Helios Health');
  const sable = await ensureClient(
    { name: 'Sable Media', description: 'Streaming and podcast network with three live shows.' },
    [
      { name: 'Rana Guindy', email: 'rana.guindy@sablemedia.example' },
      { name: 'Yousef Barakat', email: 'yousef.barakat@sablemedia.example' },
    ],
  );
  const northwind = await ensureClient(
    { name: 'Northwind Logistics', description: 'Regional freight operator running 240 dispatch desks.' },
    [{ name: 'Tarek Mansour', email: 'tarek.mansour@northwindlog.example' }],
  );

  /* ---------------- projects ---------------- */
  const projects = async () => items(`${P}/projects?limit=100`);
  const team = await items(`${P}/team?limit=100`);
  const memberId = (email) => team.find((t) => t.email === email)?.id;

  /** roster-only call: attach teammates to a project that already exists. */
  const ensureProject = async (spec, roster) => {
    let p = byName(await projects(), spec.name);
    if (!p) {
      if (!spec.client_id) return null;
      const r = await api.post(`${P}/projects`, {
        client_id: spec.client_id, name: spec.name, description: spec.description,
        due_at: spec.due_at, portal_enabled: spec.portal_enabled, status: spec.status,
      }, hp);
      if (!report('project ' + spec.name, r)) return null;
      p = r.data.fields || r.data;
      log('project +', spec.name);
    }
    const PJ = `${P}/projects/${p.id}`;
    for (const [email, role] of roster) {
      const membership_id = memberId(email);
      if (!membership_id) continue;
      const current = await items(`${PJ}/members?limit=100`);
      if (current.find((m) => m.membership_id === membership_id)) continue;
      const r = await api.post(`${PJ}/members`, { membership_id, role, status: 'ACTIVE' }, hp);
      if (report(`member ${email} on ${spec.name}`, r)) log(`member + ${email} (${role}) on ${spec.name}`);
    }
    return Object.assign(p, { __members: await items(`${PJ}/members?limit=100`) });
  };

  const ROSTER_A = [
    ['demo@agency.com', 'MANAGER'],
    ['pm@agency.com', 'CONTRIBUTOR'],
    ['designer@agency.com', 'CONTRIBUTOR'],
    ['viewer@agency.com', 'VIEWER'],
    ['dana.wassef@apexstudio.example', 'MANAGER'],
  ];
  const ROSTER_B = [
    ['demo@agency.com', 'MANAGER'],
    ['pm@agency.com', 'CONTRIBUTOR'],
    ['admin@agency.com', 'MANAGER'],
    ['karim.nabil@apexstudio.example', 'CONTRIBUTOR'],
  ];

  const novaProj = nova && await ensureProject({ name: 'Nova E-commerce Rebrand' }, ROSTER_A);
  const heliosProj = helios && await ensureProject({ name: 'Helios Patient Portal UX Audit' }, ROSTER_B);
  const acmeProj = acme && await ensureProject({ name: 'OmniPay Design System & Brand Identity' }, ROSTER_A);

  const sableProj = sable && await ensureProject({
    client_id: sable.id,
    name: 'Sable podcast network microsite',
    description: 'Show-by-show microsite with episode embeds, season archives and a press kit.',
    due_at: day(34), portal_enabled: true, status: 'ACTIVE',
  }, ROSTER_A);
  const nwProj = northwind && await ensureProject({
    client_id: northwind.id,
    name: 'Northwind dispatch dashboard',
    description: 'Consolidate three legacy dispatch screens into one board with live load states.',
    due_at: day(58), portal_enabled: false, status: 'ACTIVE',
  }, ROSTER_B);
  const loyaltyProj = acme && await ensureProject({
    client_id: acme.id,
    name: 'Acme loyalty program launch',
    description: 'Points ledger, tiers and the launch campaign assets for the Q4 promotion.',
    due_at: day(21), portal_enabled: true, status: 'ACTIVE',
  }, ROSTER_A);

  /* ---------------- milestones ---------------- */
  const ensureMilestone = async (p, title, due, status, position) => {
    if (!p) return null;
    const PJ = `${P}/projects/${p.id}`;
    const found = byName(await items(`${PJ}/milestones?limit=100`), title);
    if (found) return found;
    const r = await api.post(`${PJ}/milestones`, { title, due_at: due, position, status }, hp);
    if (!report(`milestone ${title}`, r)) return null;
    return r.data.fields || r.data;
  };

  const PLAN = {
    [sableProj?.id]: [
      ['Episode archive IA', day(-8), 'COMPLETED', 1],
      ['Show pages and embeds', day(9), 'OPEN', 2],
      ['Press kit + launch', day(30), 'OPEN', 3],
    ],
    [nwProj?.id]: [
      ['Dispatch screen research', day(-3), 'COMPLETED', 1],
      ['Load state model', day(16), 'OPEN', 2],
      ['Driver safety review', day(40), 'OPEN', 3],
    ],
    [loyaltyProj?.id]: [
      ['Tier rules sign-off', day(-1), 'COMPLETED', 1],
      ['Ledger QA', day(7), 'OPEN', 2],
      ['Campaign launch', day(19), 'OPEN', 3],
    ],
    [novaProj?.id]: [
      ['Motion kit handoff', day(18), 'OPEN', 4],
    ],
    [heliosProj?.id]: [
      ['Fixes list triage', day(6), 'OPEN', 3],
    ],
  };

  /* ---------------- tasks ---------------- */
  const ensureTask = async (p, t) => {
    if (!p) return null;
    const PJ = `${P}/projects/${p.id}`;
    const all = await items(`${PJ}/tasks?limit=100`);
    const found = all.find((x) => x.title === t.title);
    if (found) return found;
    const r = await api.post(`${PJ}/tasks`, {
      title: t.title, description: t.description, milestone_id: t.milestone_id ?? null,
      assignee_id: t.assignee_id ?? null, priority: t.priority, status: t.status,
      due_at: t.due_at ?? null, position: t.position,
    }, hp);
    if (!report(`task ${t.title}`, r)) return null;
    return r.data.fields || r.data;
  };

  const TASKS = {
    [sableProj?.id]: [
      { title: 'Map the four shows to a shared nav', priority: 'HIGH', status: 'DONE', position: 1, due_at: day(-9), ms: 'Episode archive IA', description: 'One nav pattern that survives a fifth show being added later.' },
      { title: 'Transcript search across seasons', priority: 'NORMAL', status: 'IN_PROGRESS', position: 2, due_at: day(4), ms: 'Episode archive IA', description: 'Index season transcripts; results grouped per episode with a timestamp link.' },
      { title: 'Embed player fallback for no-JS', priority: 'LOW', status: 'TODO', position: 3, due_at: day(11), ms: 'Show pages and embeds', description: 'Static poster plus a download link when the player script fails.' },
      { title: 'Episode card density pass', priority: 'NORMAL', status: 'TODO', position: 4, due_at: day(13), ms: 'Show pages and embeds', description: 'Two rows maximum, runtime and season badge stay visible at 360px.' },
      { title: 'Press kit downloads', priority: 'HIGH', status: 'TODO', position: 5, due_at: day(24), ms: 'Press kit + launch', description: 'Logos, show stills and the one-pager, all behind a gated link.' },
      { title: 'Host read copy for launch', priority: 'NORMAL', status: 'BLOCKED', position: 6, due_at: day(26), ms: 'Press kit + launch', description: 'Waiting on the final episode one to record the intro read.' },
      { title: 'Season two teaser placement', priority: 'URGENT', status: 'TODO', position: 7, due_at: day(2), ms: 'Show pages and embeds', description: 'Trailer slot above the fold on every show page.' },
    ],
    [nwProj?.id]: [
      { title: 'Shadow three dispatchers', priority: 'HIGH', status: 'DONE', position: 1, due_at: day(-4), ms: 'Dispatch screen research', description: 'Note every screen switch during a live shift, including phone lookups.' },
      { title: 'Consolidate load states into one model', priority: 'HIGH', status: 'IN_PROGRESS', position: 2, due_at: day(6), ms: 'Load state model', description: 'Fourteen legacy statuses collapse to seven with an explicit colour contract.' },
      { title: 'Keyboard-only dispatch flow', priority: 'NORMAL', status: 'IN_PROGRESS', position: 3, due_at: day(9), ms: 'Load state model', description: 'Dispatchers never touch the mouse between 06:00 and 11:00.' },
      { title: 'Offline behaviour when the depot link drops', priority: 'HIGH', status: 'TODO', position: 4, due_at: day(14), ms: 'Load state model', description: 'Queue changes locally and replay them without double-assigning a driver.' },
      { title: 'Driver hours compliance report', priority: 'NORMAL', status: 'TODO', position: 5, due_at: day(21), ms: 'Driver safety review', description: 'Weekly export the safety officer signs before loads go out.' },
      { title: 'Fatigue warnings on back-to-back runs', priority: 'URGENT', status: 'BLOCKED', position: 6, due_at: day(28), ms: 'Driver safety review', description: 'Blocked until legal confirms the rest-window wording.' },
      { title: 'Retire the legacy overnight sheet', priority: 'LOW', status: 'TODO', position: 7, due_at: day(45), ms: 'Driver safety review', description: 'Print sheet stays until two depots approve the board.' },
      { title: 'Depot pilot training pack', priority: 'NORMAL', status: 'TODO', position: 8, due_at: day(38), ms: 'Driver safety review', description: 'One-pager plus a recorded walkthrough for shift leads.' },
    ],
    [loyaltyProj?.id]: [
      { title: 'Confirm earn rate with finance', priority: 'HIGH', status: 'DONE', position: 1, due_at: day(-2), ms: 'Tier rules sign-off', description: 'Points per dirham and the expiry window, in writing.' },
      { title: 'Tier boundary edge cases', priority: 'HIGH', status: 'IN_PROGRESS', position: 2, due_at: day(3), ms: 'Ledger QA', description: 'Spend exactly on a boundary and refunds that drop a member below it.' },
      { title: 'Migration dry run on staging data', priority: 'NORMAL', status: 'IN_PROGRESS', position: 3, due_at: day(8), ms: 'Ledger QA', description: 'Rehearse the ledger import and time it against the maintenance window.' },
      { title: 'Launch email set', priority: 'NORMAL', status: 'TODO', position: 4, due_at: day(12), ms: 'Campaign launch', description: 'Three emails: heads-up, launch day, first-points-earned.' },
      { title: 'In-store signage proofs', priority: 'LOW', status: 'TODO', position: 5, due_at: day(15), ms: 'Campaign launch', description: 'Counter cards for the eleven stores taking part.' },
      { title: 'Support macros for points queries', priority: 'NORMAL', status: 'TODO', position: 6, due_at: day(17), ms: 'Campaign launch', description: 'Answers the support team can paste without opening the ledger.' },
      { title: 'Rollback plan if the ledger drifts', priority: 'URGENT', status: 'TODO', position: 7, due_at: day(18), ms: 'Campaign launch', description: 'Freeze earning, keep redemption, and a way to credit corrections by hand.' },
    ],
    [novaProj?.id]: [
      { title: 'Package the motion kit for handoff', priority: 'HIGH', status: 'TODO', position: 6, due_at: day(17), ms: 'Motion kit handoff', description: 'Loops, transitions and the reduced-motion fallback in one archive.' },
      { title: 'Write the token usage rules', priority: 'NORMAL', status: 'IN_PROGRESS', position: 7, due_at: day(19), ms: 'Motion kit handoff', description: 'Which spacing and colour tokens the storefront team may extend.' },
    ],
    [heliosProj?.id]: [
      { title: 'Triage findings into fixes', priority: 'HIGH', status: 'IN_PROGRESS', position: 3, due_at: day(5), ms: 'Fixes list triage', description: 'Split 42 findings into must-fix-before-launch and backlog.' },
      { title: 'Re-test the booking confirmation step', priority: 'NORMAL', status: 'TODO', position: 4, due_at: day(9), ms: 'Fixes list triage', description: 'Focus order and announcement after the date picker change.' },
    ],
  };

  /* ---------------- checklists / comments / discussions ---------------- */
  const ensureChecklist = async (p, task, entries) => {
    if (!p || !task) return;
    const url = `${P}/projects/${p.id}/tasks/${task.id}/checklist`;
    const have = await items(url + '?limit=100');
    for (const [i, label] of entries.entries()) {
      if (have.find((h) => h.label === label)) continue;
      await api.post(url, { label, position: i + 1, completed: false }, hp);
    }
  };

  const ensureComment = async (p, task, body) => {
    if (!p || !task) return;
    const url = `${P}/projects/${p.id}/tasks/${task.id}/comments`;
    const have = await items(url + '?limit=100');
    if (have.find((h) => h.body === body)) return;
    const r = await api.post(url, { body, thread_id: null }, hp);
    if (!report('comment on ' + task.title, r)) return;
    const first = r.data.fields || r.data;
    return first;
  };

  const replyInThread = async (p, task, parentId, body) => {
    if (!p || !task || !parentId) return;
    const url = `${P}/projects/${p.id}/tasks/${task.id}/comments`;
    const have = await items(url + '?limit=100');
    if (have.find((h) => h.body === body)) return;
    await api.post(url, { body, thread_id: parentId }, hp);
  };

  const ensureDiscussion = async (p, d, replies) => {
    if (!p) return;
    const url = `${P}/projects/${p.id}/discussions`;
    const found = byName(await items(url + '?limit=100'), d.title);
    let disc = found;
    if (!disc) {
      const r = await api.post(url, { title: d.title, body: d.body }, hp);
      if (!report('discussion ' + d.title, r)) return;
      disc = r.data.fields || r.data;
    }
    for (const body of replies || []) {
      const rs = await items(`${url}/${disc.id}/replies?limit=100`);
      if (rs.find((x) => x.body === body)) continue;
      await api.post(`${url}/${disc.id}/replies`, { body }, hp);
    }
  };

  const ensureUpdate = async (p, body) => {
    if (!p) return;
    const url = `${P}/projects/${p.id}/updates`;
    const have = await items(url + '?limit=100');
    if (have.find((x) => (x.body || x.text || '').startsWith(body.slice(0, 40)))) return;
    await api.post(url, { body }, hp);
  };

  const ensureFolders = async (p, names) => {
    if (!p) return;
    const url = `${P}/projects/${p.id}/folders`;
    const have = await items(url + '?limit=100');
    for (const [i, name] of names.entries()) {
      if (have.find((f) => f.name === name)) continue;
      const r = await api.post(url, { name, position: i + 1 }, hp);
      if (report(`folder ${name}`, r)) log('folder +', name);
    }
  };

  const ensureDoc = async (p, title, blocks) => {
    if (!p) return;
    const have = await items(`${P}/documents?limit=100`);
    if (have.find((d) => d.title === title)) return;
    const r = await api.post(`${P}/documents`, { project_id: p.id, title, content: { version: 1, blocks } }, hp);
    if (report('document ' + title, r)) log('document +', title);
  };

  const ensureDeliverable = async (p, title, description, task) => {
    if (!p) return;
    const url = `${P}/projects/${p.id}/deliverables`;
    if (byName(await items(url + '?limit=100'), title)) return;
    const r = await api.post(url, { title, description, task_id: task ? task.id : null, status: 'ACTIVE' }, hp);
    if (report('deliverable ' + title, r)) log('deliverable +', title);
    return r.data.fields || r.data;
  };

  const pText = (t) => ({ type: 'paragraph', spans: [{ text: t }] });
  const pHead = (level, t) => ({ type: 'heading', level, spans: [{ text: t }] });
  /** a list item is an array of spans; bare strings are accepted anywhere in it */
  const li = (type, items) => ({
    type,
    items: items.map((x) => (Array.isArray(x) ? x : [x]).map((sp) => (typeof sp === 'string' ? { text: sp } : sp))),
  });

  /* ---------------- write it all ---------------- */
  const targets = [acmeProj, sableProj, nwProj, loyaltyProj, novaProj, heliosProj].filter(Boolean);
  const allTasks = {};

  for (const p of targets) {
    const PJ = `${P}/projects/${p.id}`;
    const members = await items(`${PJ}/members?limit=100`);
    /** project_membership.id is what a task assignee points at; only MANAGER/CONTRIBUTOR may hold work */
    const assign = (email) => {
      const mid = memberId(email);
      const m = members.find((x) => x.membership_id === mid && (x.role === 'MANAGER' || x.role === 'CONTRIBUTOR'));
      return m ? m.id : null;
    };
    const owner = assign('demo@agency.com') || assign('pm@agency.com') || assign('admin@agency.com') || members[0]?.id || null;
    const designer = assign('designer@agency.com') || assign('karim.nabil@apexstudio.example') || owner;
    const lead = assign('demo@agency.com') || owner;

    const msByName = {};
    for (const [title, due, status, position] of PLAN[p.id] || []) {
      msByName[title] = await ensureMilestone(p, title, due, status, position);
    }
    for (const existing of await items(`${PJ}/milestones?limit=100`)) {
      msByName[existing.title] = msByName[existing.title] || existing;
    }

    allTasks[p.id] = [];
    for (const t of TASKS[p.id] || []) {
      const created = await ensureTask(p, {
        ...t,
        milestone_id: msByName[t.ms]?.id ?? null,
        assignee_id: t.status === 'TODO' && t.position % 2 ? null : (t.assignee || (t.position % 2 ? designer : owner)),
      });
      if (created) allTasks[p.id].push(created);
    }

    // spread the work across whoever can hold it, so My tasks / team views are real
    const tasks = await items(`${PJ}/tasks?limit=100`);
    const holders = members.filter((m) => m.role === 'MANAGER' || m.role === 'CONTRIBUTOR').map((m) => m.id);
    if (holders.length) {
      for (const [i, t] of tasks.entries()) {
        const want = holders[i % holders.length];
        if (t.assignee_id === want) continue;
        const r = await patch(`${PJ}/tasks/${t.id}`, {
          title: t.title, description: t.description, milestone_id: t.milestone_id, assignee_id: want,
          priority: t.priority, status: t.status, due_at: t.due_at, position: t.position,
        }, t.revision);
        if (!report('assign ' + t.title, r)) continue;
        t.assignee_id = want;
      }
    } else if (lead) {
      for (const t of tasks) {
        if (t.assignee_id) continue;
        await patch(`${PJ}/tasks/${t.id}`, {
          title: t.title, description: t.description, milestone_id: t.milestone_id, assignee_id: lead,
          priority: t.priority, status: t.status, due_at: t.due_at, position: t.position,
        }, t.revision);
      }
    }
    const byTitle = (title) => tasks.find((t) => t.title === title);

    if (lead && designer && lead !== designer) {
      const first = tasks.find((t) => t.status !== 'DONE') || tasks[0];
      if (first) {
        const c = await ensureComment(p, first, 'Flagging the reduced-motion fallback here — it needs a decision before we hand the kit over.');
        await replyInThread(p, first, c?.id, 'Agreed. Ship the static version for launch and keep the loop behind the motion toggle.');
      }
      const second = tasks.find((t) => t.status === 'BLOCKED');
      if (second) await ensureComment(p, second, 'Chase list updated: this is the only blocker that needs the client on a call.');
    }

    for (const t of tasks.slice(0, 3)) {
      await ensureChecklist(p, t, [
        'Draft shared internally',
        'Client notes collected',
        'Final approved version linked',
      ]);
    }
    for (const t of tasks.filter((x) => x.status === 'DONE').slice(0, 2)) {
      await ensureChecklist(p, t, ['Signed off', 'Archive updated']);
      const cl = await items(`${PJ}/tasks/${t.id}/checklist?limit=100`);
      for (const item of cl.filter((c) => !c.completed)) {
        await patch(`${PJ}/tasks/${t.id}/checklist/${item.id}`, { completed: true }, item.revision);
      }
    }
  }

  /* discussions, updates, folders, documents, deliverables per project */
  const CONTENT = {
    [acmeProj?.id]: {
      disc: [
        { d: { title: 'Token naming: semantic or primitive?', body: 'The palette has 24 primitives. Do teams consume primitives directly or only the eight semantic aliases?' }, replies: ['Semantics only. Primitives stay private to the token build or every rename becomes a breaking change.', 'Agreed, and the linter should fail on a raw primitive in component code.'] },
        { d: { title: 'Who owns the icon set now', body: 'Design adds icons, but the engineering kit is versioned separately. Something has to be the source of truth.' }, replies: ['The kit in this project. Anything not here does not ship.'] },
      ],
      updates: [
        'Component library passed internal review. Nine of eleven components are frozen; the date picker and the file list still move.',
        'Accessibility contract is signed by both sides. Contrast and focus order are now acceptance criteria, not notes.',
      ],
      folders: ['Brand tokens', 'Component specs', 'Exports', 'Archive'],
      docs: [
        { title: 'OmniPay: component acceptance criteria', blocks: [
          pHead(1, 'Component acceptance criteria'),
          pText('A component is only done when every line below is true. Reviewers cite the line that failed.'),
          li('orderedList', ['Keyboard: reachable, visible focus, no trap.', 'Contrast: 4.5:1 for text, 3:1 for the state edge.', 'Every state rendered: empty, loading, error, disabled.', 'Density holds at 320px without horizontal scroll.', [{ text: 'Reduced motion: no animated state change exceeds 200ms.' }]]),
          pHead(2, 'Not accepted'),
          li('bulletList', ['A hover-only affordance.', 'Colour as the only carrier of meaning.', 'A component that ships without its empty state.']),
        ] },
        { title: 'OmniPay: handoff notes', blocks: [
          pHead(1, 'Handoff notes'),
          pText('How the kit travels to the client repository, and what stays behind.'),
          li('bulletList', ['Tokens ship as JSON plus the CSS custom properties.', 'Components ship as specs, not source — the client team writes the implementation.', 'The icon set ships as an SVG sprite with the usage rules attached.']),
          pHead(2, 'Support window'),
          pText('Six weeks of office-hours after handoff, booked in advance, one session per week.'),
        ] },
      ],
      deliv: [],
    },
    [sableProj?.id]: {
      disc: [
        { d: { title: 'Show pages: one template or one per show?', body: 'Each show wants a slightly different header. Do we bend one template or accept four?' }, replies: ['One template with a single slot that each show can fill — four templates will drift within a season.', 'Agreed, and the slot stays optional so a new show can launch with nothing in it.'] },
        { d: { title: 'Transcript hosting', body: 'Transcripts live with the episode or in a separate archive? Search is the deciding factor.' }, replies: ['Separate archive, but every episode page deep-links into it.'] },
      ],
      updates: [
        'Episode archive IA is closed. Season one and two transcripts are searchable, and each episode links straight to the timestamp.',
        'Show pages land next week. The teaser slot above the fold is the one thing we still need a final artwork for.',
      ],
      folders: ['Show artwork', 'Transcripts', 'Press kit', 'Archive'],
      docs: [
        { title: 'Sable: show page rules', blocks: [
          pHead(1, 'Show page rules'),
          pHead(2, 'What stays identical across shows'),
          li('bulletList', ['The nav, the episode list density, and the player position.', 'One teaser slot above the fold, optional per show.', 'Transcript link on every episode row.']),
          pHead(2, 'What each show may change'),
          pHead(3, 'Header artwork'),
          pText('A show may supply its own header crop, but the aspect ratio is fixed so the fold does not jump between shows.'),
          li('orderedList', [[{ text: 'Upload the crop at 2400x800.' }], [{ text: 'Confirm the safe area at 360px.' }], [{ text: 'Check contrast against the overlay text.' }]]),
        ] },
        { title: 'Sable: launch checklist', blocks: [
          pHead(1, 'Launch checklist'),
          pText('Everything below must be green before the announcement goes out.'),
          li('bulletList', ['Player embeds tested on the four shows.', 'Press kit links gated and expiring.', 'Transcript search returns results per season.', [{ text: 'Rollback: ' }, { text: 'point the nav at the old show index.', bold: true }]]),
        ] },
      ],
      deliv: [
        { title: 'Show page concept set', description: 'Header treatments for all four shows on one template.', task: 'Episode card density pass' },
        { title: 'Transcript search prototype', description: 'Season-grouped results with timestamp links.', task: 'Transcript search across seasons' },
      ],
    },
    [nwProj?.id]: {
      disc: [
        { d: { title: 'How many load states are honest?', body: 'Fourteen legacy statuses, but dispatchers only act on about six. Cutting to seven is the current proposal.' }, replies: ['Seven works if the retired statuses keep writing to history — the depot reports still reference them.'] },
        { d: { title: 'Offline queue behaviour', body: 'When the depot link drops, do we freeze the board or queue changes?' }, replies: ['Queue, but never let two dispatchers assign the same load on replay.'] },
      ],
      updates: [
        'Dispatch research is done after three shadowed shifts. The load-state model review is on Thursday.',
        'Keyboard-only flow is nearly there; the remaining gap is the bulk-assign panel.',
      ],
      folders: ['Research notes', 'State model', 'Safety', 'Depot pilots'],
      docs: [
        { title: 'Northwind: load state contract', blocks: [
          pHead(1, 'Load state contract'),
          pText('Seven states, each with one colour and one action. Nothing else may be coloured.'),
          li('orderedList', ['Assigned — a dispatcher owns it.', 'En route — the driver has accepted.', 'At depot — location confirmed.', 'Delayed — needs a reason code.', 'Blocked — safety or paperwork.', 'Delivered — closed for good.', 'Cancelled — never reuses a load id.']),
          pHead(2, 'Rules'),
          li('bulletList', ['A state change always names who made it.', [{ text: 'Cancelled loads keep their id for reporting.' }], ['Offline replay never produces two active assignments.']]),
        ] },
        { title: 'Northwind: shift findings', blocks: [
          pHead(1, 'Shift findings'),
          pText('Three shadowed shifts, 06:00 to 11:00, across two depots.'),
          pHead(2, 'What slows dispatchers down'),
          li('bulletList', ['Six screen switches to confirm one load.', 'Phone lookups happen outside the tool, so nothing is recorded.', 'The overnight sheet is printed and then retyped.']),
          pHead(2, 'What must not change'),
          pText('The safety officer sign-off stays a separate step even if it costs a click.'),
        ] },
      ],
      deliv: [
        { title: 'Load state board mock', description: 'Single board with the seven states and keyboard map.', task: 'Consolidate load states into one model' },
        { title: 'Depot pilot training pack', description: 'One-pager and recorded walkthrough for shift leads.', task: 'Depot pilot training pack' },
      ],
    },
    [loyaltyProj?.id]: {
      disc: [
        { d: { title: 'Refunds that drop a tier', body: 'If a refund takes a member below a tier boundary, do we demote immediately or at period end?' }, replies: ['Period end, otherwise a single return nukes a launch-week benefit.', 'Period end, but the ledger records the demotion reason at refund time.'] },
        { d: { title: 'Freeze or rollback', body: 'The agreed rollback is: stop earning, keep redemption. Confirming nobody reads that as a shutdown.' }, replies: ['Support script will say earning is paused, nothing about a shutdown.'] },
      ],
      updates: [
        'Earn rate is signed off by finance. Tier boundary QA is running now with two edge cases still open.',
        'Launch emails are drafted; in-store proofs need the eleven participating store names.',
      ],
      folders: ['Tier rules', 'Campaign', 'Ledger QA', 'Support'],
      docs: [
        { title: 'Acme loyalty: tier rules', blocks: [
          pHead(1, 'Tier rules'),
          pText('Three tiers, points expire after fourteen months, refunds adjust the balance at period end.'),
          li('bulletList', [[{ text: 'Member: ' }, { text: '0 - 1,999 points.', bold: true }]], ),
          li('bulletList', ['Silver: 2,000 - 5,999 points, one early-access drop per quarter.', 'Gold: 6,000+ points, free returns and a birthday credit.']),
          pHead(2, 'Boundary behaviour'),
          pText('A member who lands exactly on 2,000 upgrades on the next ledger run, not instantly. A refund that pushes them below 2,000 demotes at period end.'),
        ] },
        { title: 'Acme loyalty: launch runbook', blocks: [
          pHead(1, 'Launch runbook'),
          li('orderedList', ['Freeze earning writes at 04:00.', 'Run the ledger import and check the row count.', 'Re-enable earning and watch the drift alert for 30 minutes.', [{ text: 'If drift exceeds 0.1%, keep earning frozen and credit corrections by hand.' }]]),
          pHead(2, 'Who is on call'),
          pText('Finance sign-off, support lead, and one engineer who can read the ledger.'),
        ] },
      ],
      deliv: [
        { title: 'Launch email set', description: 'Heads-up, launch day, and first-points-earned emails.', task: 'Launch email set' },
        { title: 'Tier badge artwork', description: 'Three tier badges in the two store formats.', task: 'In-store signage proofs' },
      ],
    },
  };

  for (const p of targets) {
    const c = CONTENT[p.id];
    if (!c) continue;
    for (const { d, replies } of c.disc) await ensureDiscussion(p, d, replies);
    for (const u of c.updates) await ensureUpdate(p, u);
    await ensureFolders(p, c.folders);
    for (const doc of c.docs) await ensureDoc(p, doc.title, doc.blocks);
    for (const dv of c.deliv) await ensureDeliverable(p, dv.title, dv.description, byTitleIn(allTasks[p.id], dv.task));
  }

  /* the two older projects keep their content but gain structure */
  for (const p of [novaProj, heliosProj].filter(Boolean)) {
    const url = `${P}/projects/${p.id}/discussions`;
    const list = await items(url + '?limit=100');
    for (const d of list) {
      const replies = await items(`${url}/${d.id}/replies?limit=100`);
      if (replies.length) continue;
      await api.post(`${url}/${d.id}/replies`, { body: 'Noting this for the next internal review so it does not get lost in the thread.' }, hp);
    }
    await ensureFolders(p, ['Working files', 'Client handoff', 'Contracts']);
    const tasks = await items(`${P}/projects/${p.id}/tasks?limit=100`);
    for (const t of tasks.slice(0, 2)) {
      await ensureChecklist(p, t, ['Scoped with the client', 'Internal review done', 'Signed off']);
    }
  }
  if (novaProj) {
    await ensureDiscussion(novaProj, { title: 'Motion kit: which loops ship?', body: 'Six loops were prototyped. Launch needs three of them, the rest go in phase two.' }, ['Three is right — the hero, the add-to-cart confirm, and the empty state.']);
    await ensureUpdate(novaProj, 'Homepage concepts are approved. Motion kit packages this week so the storefront team can start wiring the hero.');
    await ensureDoc(novaProj, 'Nova: motion kit contents', [
      pHead(1, 'Motion kit contents'),
      pText('Three loops ship at launch. Each has a reduced-motion fallback that is the default for anyone who has it set system-wide.'),
      li('bulletList', ['Hero: 4s loop, under 2MB, poster frame first.', 'Add-to-cart: 600ms confirm, no colour flash.', 'Empty state: single slow drift, never loops forever.']),
      pHead(2, 'Handoff'),
      pText('Files land in the Motion kit folder with the license note attached.'),
    ]);
  }
  if (heliosProj) {
    await ensureDiscussion(heliosProj, { title: 'Must-fix versus backlog', body: '42 findings. Legal wants the consent-screen ones fixed before any patient data touches staging.' }, ['Consent screen and the date picker focus order are must-fix. Everything else can be scheduled.']);
    await ensureUpdate(heliosProj, 'Audit findings triaged: nine must-fix before launch, the rest scheduled. Consent screen is the first fix.');
    await ensureDoc(heliosProj, 'Helios: must-fix list', [
      pHead(1, 'Must-fix before launch'),
      li('orderedList', ['Consent screen wording needs the legal-approved version.', 'Date picker loses focus after the month change.', 'Error announcements are silent for screen reader users.', 'Appointment confirmations have no visible summary.']),
      pHead(2, 'Scheduled'),
      pText('The remaining findings stay in the backlog with the heuristic each one maps to.'),
    ]);
  }

  /* client access grants on the portal-enabled projects */
  for (const [p, client] of [[sableProj, sable], [loyaltyProj, acme], [novaProj, nova]]) {
    if (!p || !client) continue;
    const contacts = await items(`${P}/clients/${client.id}/contacts?limit=100`);
    const grants = await items(`${P}/projects/${p.id}/grants?limit=100`);
    const roles = ['APPROVER', 'VIEWER'];
    for (const [i, ct] of contacts.slice(0, 2).entries()) {
      if (grants.find((g) => g.contact_id === ct.id)) continue;
      const r = await api.post(`${P}/projects/${p.id}/grants`, { contact_id: ct.id, role: roles[i] || 'VIEWER', status: 'ACTIVE' }, hp);
      if (report('grant ' + ct.email, r)) log('grant +', ct.email, roles[i] || 'VIEWER');
    }
  }

  /* seed-rich.mjs posted the same update text on every run, so the client feed
     has near-identical rows. Newest stays, the rest are withdrawn. */
  for (const p of await projects()) {
    const url = `${P}/projects/${p.id}/updates?limit=100`;
    const all = (await items(url)).filter((u) => u.status !== 'WITHDRAWN');
    const groups = {};
    for (const u of all) (groups[u.body] = groups[u.body] || []).push(u);
    for (const list of Object.values(groups)) {
      list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      for (const dup of list.slice(1)) {
        const r = await api.post(`${url.replace('?limit=100', '')}/${dup.id}/withdraw`, {}, {
          headers: { ...hp.headers, 'if-match': `"${dup.revision}"` },
        });
        if (report('withdraw duplicate update', r)) log('withdrew duplicate update on', p.name);
      }
    }
  }

  /* ---------------- summary ---------------- */
  const count = async (path) => (await items(path)).length;
  const summary = {
    clients: await count(`${P}/clients?limit=100`),
    projects: await count(`${P}/projects?limit=100`),
    team: await count(`${P}/team?limit=100`),
    documents: await count(`${P}/documents?limit=100`),
    notifications: await count(`${P}/notifications?limit=100`),
    myTasks: await count(`${P}/my-tasks?limit=100`),
  };
  for (const p of [acmeProj, novaProj, heliosProj, sableProj, nwProj, loyaltyProj].filter(Boolean)) {
    const PJ = `${P}/projects/${p.id}`;
    summary[p.name] = {
      milestones: await count(`${PJ}/milestones?limit=100`),
      tasks: await count(`${PJ}/tasks?limit=100`),
      members: await count(`${PJ}/members?limit=100`),
      deliverables: await count(`${PJ}/deliverables?limit=100`),
      discussions: await count(`${PJ}/discussions?limit=100`),
      folders: await count(`${PJ}/folders?limit=100`),
      updates: await count(`${PJ}/updates?limit=100`),
    };
  }
  console.log(JSON.stringify(summary, null, 1));
  log('SEED COMPLETE — file versions/reviews skipped (scanner is Windows-only)');
}

function byTitleIn(list, title) {
  return list.find((t) => t.title === title) || null;
}

main().catch((e) => {
  console.error('[fill] FAILED:', e.message);
  process.exit(1);
});
