/**
 * Shared helpers for local dev seeders. Talks ONLY to the real local backend
 * (Vite proxy on :5199 → API :3001) and Mailpit (:8025). No mocks, no direct DB.
 */
import crypto from 'node:crypto';

const API_BASE = 'http://127.0.0.1:3001/api/v1';
const MAILPIT_BASE = 'http://127.0.0.1:8025/api/v1';
const ORIGIN = 'https://localhost:8443';

export function client() {
  const cookies = {};

  function header() {
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  function absorb(res) {
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const str of setCookie) {
      const parts = str.split(';')[0].split('=');
      const name = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (name) cookies[name] = val;
    }
  }

  async function call(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set('origin', ORIGIN);
    const ch = header();
    if (ch) headers.set('cookie', ch);
    if (method === 'POST' && !headers.has('idempotency-key')) {
      headers.set('idempotency-key', crypto.randomUUID());
    }
    let body = options.body;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      body = JSON.stringify(body);
    }
    const url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? path : '/' + path}`;
    const res = await fetch(url, { method, headers, body });
    absorb(res);
    const ctype = res.headers.get('content-type') || '';
    const data = ctype.includes('json') ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, ok: res.ok, data, headers: res.headers };
  }

  async function csrf() {
    const r = await call('/identity/csrf');
    if (r.data?.token) return r.data.token;
    throw new Error('csrf failed: ' + JSON.stringify(r.data));
  }
  async function post(path, body, extra) {
    const token = await csrf();
    return call(path, {
      method: 'POST',
      body,
      headers: { 'x-csrf-token': token, ...(extra?.headers || {}) },
    });
  }

  return { call, csrf, post, cookies: () => ({ ...cookies }) };
}

/** Fetch all Mailpit messages for an address whose subject contains part (case-insensitive). */
export async function waitForMail(to, subjectPart, { tries = 20, pauseMs = 500 } = {}) {
  const target = to.toLowerCase();
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${MAILPIT_BASE}/messages?limit=50`);
    const data = await res.json();
    const hit = (data.messages || [])
      .filter((m) => (m.To || []).some((t) => t.Address.toLowerCase() === target))
      .filter((m) => !subjectPart || (m.Subject || '').toLowerCase().includes(subjectPart.toLowerCase()))
      .sort((a, b) => b.ID - a.ID)[0];
    if (hit) {
      const detail = await (await fetch(`${MAILPIT_BASE}/message/${hit.ID}`)).json();
      return detail;
    }
    await new Promise((r) => setTimeout(r, pauseMs));
  }
  return null;
}

/** register + email-verify + login a new identity user via the real API. */
export async function registerAndVerifyUser(api, { name, email, password }) {
  let r = await api.post('/identity/register', { name, email, password });
  if (!r.ok && !/409|conflict|exists/i.test(JSON.stringify(r.data))) {
    throw new Error(`register failed: ${r.status} ${JSON.stringify(r.data)}`);
  }
  const mail = await waitForMail(email, 'verify');
  if (!mail) throw new Error(`no verification mail for ${email}`);
  const verifyToken = new URL(/https?:\/\/[^\s]+/.exec(mail.Text || mail.HTML || '')[0]).searchParams.get('token');
  r = await api.post('/identity/verify', { token: verifyToken });
  if (!r.ok) throw new Error(`verify failed: ${r.status} ${JSON.stringify(r.data)}`);
  const login = await api.post('/identity/login', { email, password });
  if (!login.ok) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.data)}`);
  return login;
}

export function principalOf(res) {
  const items = res?.data?.items || res?.data || [];
  return items[0] || null;
}

export const pw = {
  fixture: 'Disposable-phase2-password-123!',
  members: 'SeededLocal123!',
};
