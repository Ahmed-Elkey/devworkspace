# DevWorkspace Deployment

## Current live deployment — Vercel (functions only)

Both apps deploy from this repository through Vercel's GitHub integration: the
`backend` project runs the API as a single serverless function, the `frontend`
project serves the built Vite MPA and proxies `/api/*` to the API's production
domain so cookies, CSRF and `SameSite` behave as one origin.

Setup that the Vercel UI cannot infer from `vercel.json`:

* each project's **Root Directory** must be `backend` / `frontend`;
* install command is `pnpm install --frozen-lockfile --prod=false`, because
  `NODE_ENV=production` otherwise drops the toolchain the build needs;
* **Deployment Protection** must be set to preview-only, otherwise anonymous
  visitors on the production host get a 302 to the Vercel login.

Environment the API project needs beyond the database URLs and signing secrets:

| Variable | Value on Vercel | Why |
|---|---|---|
| `PRODUCT_ALLOW_REMOTE` | `true` | Without it the config layer rejects any database that is not on `127.0.0.1`, so a hosted database cannot be used at all. |
| `APP_ORIGIN` | the API project domain | The origin the API considers its own; cookies and CSRF are bound to it. |
| `APP_ALLOWED_ORIGINS` | `https://*.vercel.app` | Every visitor reaches the API through the frontend, whose preview and deployment hostnames are generated per push. Pinning one host makes sign-in fail with "Secure request check failed" on any other. Entries starting `https://*.` match a subdomain of that suffix only, so `vercel.app` itself and `vercel.app.attacker.test` stay refused. |
| `PRODUCT_DB_POOL_MAX` | `20` | One serverless instance serves several requests from one process, so it needs a wider pool than a container. At the old default of 6 concurrent visitors queue for a connection and the function returns 503. |

Signed-in visitors reach the API through the frontend rewrite, so the browser
never leaves one origin; the API domain is only ever contacted server-side.

### How many people at once

Measured against the live deployment (three separate waves):

* 21, 42 and 60 simultaneous sign-ins — all succeeded;
* 60 simultaneous authenticated page loads — all succeeded;
* 120 simultaneous page loads — 104 succeeded, 16 returned 504 with no error in
  the application logs. That ceiling is Vercel's function cold-start and
  concurrency limit, not this codebase; raising it is a plan/billing decision.

### How long a page takes

Every read goes from the API function across the region to the database, so one
authenticated request costs roughly half a second to several seconds. Measured on
the live deployment, the five reads that fill the dashboard took 2.4s, 3.7s, 6.1s,
6.7s and 7.3s; they are issued together, so the page is full at about the time of
the slowest one rather than the sum of all five. Shortening that further means
putting the database in the same region as the API, or paying for more database
and function capacity — the frontend has no way to make a distant query faster.

Two things make that number possible and are easy to undo by accident:

* **Per-visitor abuse budget.** Every deployment terminates TLS in a proxy in
  front of the Node process, so `request.socket.remoteAddress` is always
  `127.0.0.1` and the whole world shares one throttle bucket. The API now takes
  the last `X-Forwarded-For` hop, which is the address the proxy actually
  received the request from and not something a visitor can invent.
* **Per-visitor identity budget.** The smaller sign-in lane is keyed by account
  *and* address, because the demo account is shared: without the address in the
  key, one visitor retrying a wrong password locks every other visitor out of
  that account for a minute.

Self-service signup and password reset on Vercel will create a request that
never completes; use a pre-verified account instead.

A serverless function cannot hold a queue, a socket or a filesystem, so these
features are unreachable on this route even when everything else works:

| Feature | Why it is missing |
|---|---|
| File upload, assets, deliverables, review versions | the storage client only accepts the private loopback S3 endpoint (`packages/server/src/storage.ts`) |
| Email (verification, reset, invitations) | verification is `requireEmailVerification`, and the sealed envelope is consumed by the worker |
| Notifications and the project activity feed | both are projected by `materialize_notifications`, which runs in the tenant worker |
| Live updates | `/socket.io` has no gateway, so nothing is pushed; each page reads its own data when it loads and after you change something |

The worker also refuses any database that is not on `127.0.0.1`
(`apps/worker/src/mail.ts`), so it cannot be pointed at the hosted database.
Everything above works on the VPS route below, which runs the full stack.

---

# Alternative: production on a free Oracle Cloud VPS

**Goal:** deploy the whole project online, free and permanent, no paid domain,
all current data transferred exactly, Mailpit replaced by a real mail provider
(Brevo recommended, Gmail SMTP acceptable).

**Free zero-cost stack**

| Piece | Solution |
|---|---|
| Server + postgres + redis + files | Oracle Cloud Always Free (4 ARM OCPU / 24 GB) |
| TLS / HTTPS | Let's Encrypt on `devworkspace.<VPS-IP>.sslip.io` |
| Mailing | Brevo (free tier, 300/day, needs a sender address) or Gmail SMTP |
| Domain | free `sslip.io` subdomain + (optionally later `eu.org`) |

---

## Server prerequisites (self-service — user creates the Oracle account)

1. Free Oracle Cloud account, create a **VM Standard A1 Compute (ARM)**:
   * image **Oracle Linux 8/9 (aarch64)** or **Ubuntu 24.04 ARM**
   * shape `VM.Standard.A1.Flex`, **4 OCPU / 24 GB** (the "Always Free" ARM tier)
   * keep the SSH key pair; add a password login key too.
2. SSH into the server.
3. Install Docker and compose:

   *Oracle Linux:* `sudo dnf install -y docker` then `sudo systemctl enable --now docker`
   and install compose: https://docs.docker.com/compose/install/linux/
   *Ubuntu:* `sudo apt install -y docker.io docker-compose-plugin`

4. Open **80 and 443** to the world in the VPS security list (Oracle CLI:
   `oci compute security-list rule add ... destination 0.0.0.0/0 protocol all`).
   **This is the only open port the VPS ever needs** — the container stack itself
   never binds anything outside `127.0.0.1`.

---

## Workflow

### 1. Prepare the bundle locally (on your machine, right before deployment)

The bundle is built from the live local database and SeaweedFS volume:

```bash
cd backend
node infra/prod/bundle.mjs
```

Output (examples):

```
The bundle holds live credentials; transfer it over a trusted channel and delete both copies when done.
```

The file is `backend/.local/prod-bundle.tgz` (mode 0600).
**It contains live credentials.** Keep it out of git (it lives under `.local`),
move it over a trusted channel (scp/sftp) to the server, and delete BOTH copies
once deployment is verified.

> Note: if the local PostgreSQL runtime lacks `pg_dump`, install Postgres.app
> (v2.9.6+) and point `backend/.local/vendor/pg-client/bin` at its pg_dump before
> running the bundle. The client version must match the server major version
> (18 → 18).

### 2. Copy the repository to the server

```bash
scp -r backend user@server:/path/to/workspace/backend
```

The repository must be copied exactly (same `dist`, same source).

### 3. Run the bootstrap on the server

```bash
cd /path/to/workspace/backend
node infra/prod/bootstrap.mjs \
  --domain devworkspace.<VPS-IP>.sslip.io \
  --bundle /tmp/prod-bundle.tgz
```

The bootstrap:
* verifies `SHA256SUMS` for every file in the bundle (tamper check);
* restores the role passwords from the bundle so existing DB roles match;
* recreates `devworkspace_phase2` schema via the migration ledger;
* restores the data dump and **verifies row counts per table against the bundle
  manifest** (`restore: N tables match the bundle row counts`);
* restores the SeaweedFS volume files + filer metadata (files stay addressable);
* restores the built frontend static files;
* regenerates env files with 0600 permissions — **nothing is ever printed**;
* starts Caddy, PostgreSQL, Redis, SeaweedFS, the API, the worker and the proxy.

It waits until `https://devworkspace.<VPS-IP>.sslip.io/api/v1/health/ready`
responds and prints a status summary (never showing secrets).

If the bundle carries a mail account already (`--smtp`), verification mail works;
otherwise it reports `mail: NOT configured`.

### 4. Activate email (Brevo example — no paid domain needed)

Get a **sender address** and SMTP credentials (Brevo free tier needs
one verified sender only; it can mail arbitrary recipient addresses):

* Brevo: sign up for a free account, verify one sender email, generate a
  **transactional/API key**
* Gmail: an account with an **app password** (2FA on,
  "App passwords" → "Mail (Other Custom Name)")

Add the account and restart the mail workers:

```bash
node infra/prod/bootstrap.mjs \
  --domain devworkspace.<VPS-IP>.sslip.io \
  --smtp 'smtps://user:key@smtp-relay.brevo.com:587' \
  --from 'DevWorkspace <noreply@devworkspace.test>'
```

(For Gmail: `--smtp 'smtps://user:app-password@gmail.com:465'`.)
Once configured, `docker compose ps` will show a healthy API and the
registration flow sends real verification mail.

### 5. Verify

* `curl -k https://devworkspace.<VPS-IP>.sslip.io` — serves the built frontend;
* `curl -k https://devworkspace.<VPS-IP>.sslip.io/api/v1/health/ready` — API ok;
* register a test account and confirm the mail link
  `https://devworkspace.<VPS-IP>.sslip.io/register?token=...` arrives.

---

## Architecture

* All services run on the VPS host network, bound to `127.0.0.1` only.
* **Caddy** (image `caddy:2-alpine`) terminates TLS on 80/443 with automatic
  Let's Encrypt on the `sslip.io` host, preserving the original `Host` header.
* The **edge proxy** (`backend/scripts/proxy.mjs`, `PROXY_TLS=off`) on 127.0.0.1:8443
  performs all application-layer routing and guards — staging upload restrictions,
  origin pinning, 403 on `storage-admin`, 405 on mutating static paths.
* The **API** binds 127.0.0.1:3001, the **worker** has no port, the **frontend**
  is served from `frontend/dist` through the proxy.
* The environment is port-identical to development: PostgreSQL 55432, Redis 6379,
  SeaweedFS 9333/8080/8888/9000, API 3001, proxy 8443.

### Data durability notes

* PostgreSQL uses the docker volume `pg-data` (bind-backed on the host);
  the bootstrap script restores into it from the local dump. A new data dump
  is required whenever local data changes.
* Redis is configured without AOF persistence (development parity: the outbox
  retry pattern tolerates loss of in-flight jobs).
* SeaweedFS data lives in `backend/.local/prod/data/storage` — copied from the
  bundle; the filer metadata is preserved so S3 object names resolve to files.

### Reconfiguration without a data change

If you only need to change the domain or mail provider:

```bash
node infra/prod/bootstrap.mjs \
  --domain newdomain.sslip.io \
  --smtp 'smtps://...' \
  --from '...'
```

(no `--bundle`, database untouched — `docker compose up -d --force-recreate`
applies the new env files and restarts `redis api worker proxy caddy`).

---

## Troubleshooting

```bash
docker compose logs -f caddy api worker proxy
docker compose ps --format json
```

* Caddy 404/502 → check `docker compose ps` shows the proxy on 8443 healthy;
* `apiHealth: timed out` → ACME issuance may be in progress; wait and re-check;
  if the VPS security list blocked 80/443, ACME will fail and Caddy will show a
  self-signed cert — open the two ports.
* `restore MISMATCH` → the bundle was taken from a different DB state; re-build
  the bundle on the current local DB and redeploy.
* SeaweedFS 403 → the stored `s3-identities.json` does not match the current
  `FILE_STORAGE_*` keys; rebuild the bundle on a machine where the file storage
  identity keys are current.

---

## Files

| File | Purpose |
|---|---|
| `infra/prod/compose.prod.yaml` | All services, host network, loopback ports |
| `infra/prod/Caddyfile` | TLS termination + host header passthrough |
| `infra/prod/bootstrap.mjs` | One-shot server-side install/restore/start |
| `infra/prod/bundle.mjs` | Local data + files + secrets bundle (sha256-signed) |
| `scripts/proxy.mjs` | Edge proxy; `PROXY_TLS=off` when behind Caddy |
| `backend/.local/pg-owner.json` | PostgreSQL cluster ownership marker |
| `backend/.env.local` | Server-side prepare-phase2 admin connection |
| `backend/.local/prod-api.env`, `backend/.local/prod-worker.env` | Generated app secrets (0600) |
| `backend/infra/prod/.env.prod` | Compose interpolation (regenerated each bootstrap) |
