// Remote counterpart of prepare-phase2.mjs.
// Provisioning the hosted (e.g. Neon) product database with the exact same
// role model, ownership checks and additive migration ledger as the local
// native infrastructure, so PRODUCT_ALLOW_REMOTE deployments inherit an
// identical database state.
//
// Required environment:
//   PRODUCT_ALLOW_REMOTE=true        - explicit opt-in (same gate as productConfig)
//   PHASE2_ADMIN_URL                 - admin PostgreSQL connection string for
//                                      the remote host (e.g. Neon owner role)
//
// Writes (secrets never printed to stdout):
//   .local/phase2-credentials-remote.json  - generated role passwords
//   .local/phase2-api-remote.env           - PRODUCT_API_URL / IDENTITY_URL / MAIL_KEY
//   .local/phase2-worker-remote.env        - DISPATCH_URL / WORKER_URL / MAIL_KEY

import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';

if (process.env.PRODUCT_ALLOW_REMOTE !== 'true')
  throw new Error('Remote provisioning requires PRODUCT_ALLOW_REMOTE=true');
const adminUrlSource = process.env.PHASE2_ADMIN_URL;
if (!adminUrlSource) throw new Error('PHASE2_ADMIN_URL is required');
const target = new URL(adminUrlSource);
if (
  target.protocol !== 'postgresql:' ||
  ['127.0.0.1', '::1', 'localhost'].includes(target.hostname)
)
  throw new Error('Refusing a local or non-postgresql admin URL');
target.search = '';
target.pathname = '/postgres';
const database = 'devworkspace_phase2';

let credentials;
let knownCredentials = true;
try {
  credentials = JSON.parse(await readFile('.local/phase2-credentials-remote.json', 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  knownCredentials = false;
  credentials = {};
  for (const role of ['api', 'identity', 'dispatch', 'worker'])
    credentials[role] = randomBytes(32).toString('hex');
  credentials.mailKey = randomBytes(32).toString('hex');
  await writeFile('.local/phase2-credentials-remote.json', JSON.stringify(credentials), {
    mode: 0o600,
  });
}
for (const key of ['api', 'identity', 'dispatch', 'worker', 'mailKey'])
  if (!/^[a-f0-9]{64}$/.test(credentials[key] ?? ''))
    throw new Error('Invalid remote credential record');

const admin = new Client({ connectionString: target.href, ssl: { rejectUnauthorized: false } });
await admin.connect();
for (const role of [
  'owner',
  'resolver',
  'dispatch_owner',
  'communications',
  'api',
  'identity',
  'dispatch',
  'worker',
]) {
  const name = 'dw2_' + role;
  const found = await admin.query(
    'SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolinherit,rolcanlogin FROM pg_roles WHERE rolname=$1',
    [name],
  );
  if (found.rowCount) {
    const r = found.rows[0];
    if (
      !knownCredentials ||
      r.rolsuper ||
      r.rolcreatedb ||
      r.rolcreaterole ||
      r.rolbypassrls ||
      r.rolinherit ||
      r.rolcanlogin !== !!credentials[role]
    )
      throw new Error('Unexpected existing database role: ' + name);
  }
  if (!found.rowCount)
    await admin.query(
      `CREATE ROLE ${name} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS ${
        credentials[role] ? 'LOGIN PASSWORD ' + "'" + credentials[role] + "'" : 'NOLOGIN'
      }`,
    );
}
const existingDatabase = await admin.query(
  'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',
  [database],
);
if (
  existingDatabase.rowCount &&
  (!knownCredentials || existingDatabase.rows[0].owner !== 'dw2_owner')
)
  throw new Error('Refusing an unowned product database');
if (!existingDatabase.rowCount)
  await admin.query(`CREATE DATABASE ${database} OWNER dw2_owner`);
await admin.query('GRANT dw2_resolver,dw2_dispatch_owner,dw2_communications TO dw2_owner');
// The remote admin role is not a superuser, so it cannot SET ROLE into
// dw2_owner during migrations without explicit membership.
await admin.query(`GRANT dw2_owner TO "${target.username}"`);
await admin.end();
target.pathname = '/' + database;
const db = new Client({ connectionString: target.href, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("SELECT pg_advisory_lock(hashtext('devworkspace-phase2-migrations'))");
if (
  !(await db.query("SELECT to_regclass('migration_meta.phase2_migration') AS ledger")).rows[0]
    .ledger &&
  !(await db.query("SELECT to_regclass('public.phase2_migration') AS ledger")).rows[0].ledger &&
  (await db.query('SELECT 1 FROM pg_tables WHERE schemaname=$1 LIMIT 1', ['public'])).rowCount
)
  throw new Error(
    'Existing product data lacks the owned migration ledger; review before migration',
  );
await db.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
await db.query(
  `GRANT CONNECT ON DATABASE ${database} TO dw2_api,dw2_identity,dw2_dispatch,dw2_worker`,
);
await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
await db.query('CREATE SCHEMA IF NOT EXISTS migration_meta');
if ((await db.query("SELECT to_regclass('public.phase2_migration') AS old")).rows[0].old)
  await db.query('ALTER TABLE public.phase2_migration SET SCHEMA migration_meta');
await db.query(
  'CREATE TABLE IF NOT EXISTS migration_meta.phase2_migration (name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz DEFAULT now())',
);
for (const name of [
  '0001-generated.sql',
  '0002-security.sql',
  '0003-hardening.sql',
  '0004-privilege-revocation.sql',
  '0005-identity-eligibility.sql',
  '0006-integrity.sql',
  '0007-scope-errors.sql',
  '0008-delivery-replay.sql',
  '0009-principal-pagination.sql',
  '0010-core.sql',
  '0011-client-access.sql',
  '0012-core-bindings.sql',
  '0013-files.sql',
  '0014-file-processing.sql',
  '0015-media.sql',
  '0016-file-integrity.sql',
  '0017-staging-cleanup.sql',
  '0018-processing-evidence.sql',
  '0019-profile-audit.sql',
  '0020-terminal-staging-cleanup.sql',
  '0021-reviews.sql',
  '0022-review-invariants.sql',
  '0023-review-events.sql',
  '0024-client-review-eligibility.sql',
  '0025-review-history-guards.sql',
  '0026-annotation-type.sql',
  '0027-review-resource-lifecycle.sql',
  '0028-communications.sql',
  '0029-assignment-recipient.sql',
  '0030-notification-project-binding.sql',
  '0031-delivery-visibility.sql',
  '0032-notification-envelope-integrity.sql',
  '0033-event-audit-correlation.sql',
  '0034-worker-audit-context.sql',
  '0035-expansion.sql',
  '0036-expansion-communications.sql',
  '0037-expansion-preferences.sql',
  '0038-expansion-guard.sql',
  '0039-update-withdrawal-invalidation.sql',
  '0040-expansion-project-events.sql',
  '0041-activity-attribution.sql',
  '0042-expansion-assignment-binding.sql',
  '0043-document-link-scheme.sql',
  '0044-delivery-stage-timestamps.sql',
]) {
  const sql = await readFile('packages/database/prisma/product/' + name, 'utf8');
  const digest = createHash('sha256').update(sql).digest('hex');
  const previous = await db.query(
    'SELECT digest FROM migration_meta.phase2_migration WHERE name=$1',
    [name],
  );
  if (previous.rowCount) {
    if (previous.rows[0].digest !== digest) throw new Error('Applied migration changed: ' + name);
    continue;
  }
  await db.query('BEGIN');
  try {
    await db.query('SET LOCAL ROLE dw2_owner');
    await db.query(sql);
    await db.query('RESET ROLE');
    await db.query('INSERT INTO migration_meta.phase2_migration(name,digest) VALUES($1,$2)', [
      name,
      digest,
    ]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
await db.end();
const runtimeUrl = (role) => {
  const u = new URL(target);
  u.username = 'dw2_' + role;
  u.password = credentials[role];
  u.search = '?sslmode=require';
  return u.href;
};
await writeFile(
  '.local/phase2-api-remote.env',
  `PRODUCT_ENABLED=true\nPRODUCT_API_URL=${runtimeUrl('api')}\nPRODUCT_IDENTITY_URL=${runtimeUrl('identity')}\nPRODUCT_MAIL_KEY=${credentials.mailKey}\n`,
  { mode: 0o600 },
);
await writeFile(
  '.local/phase2-worker-remote.env',
  `PRODUCT_ENABLED=true\nPRODUCT_DISPATCH_URL=${runtimeUrl('dispatch')}\nPRODUCT_WORKER_URL=${runtimeUrl('worker')}\nPRODUCT_MAIL_KEY=${credentials.mailKey}\n`,
  { mode: 0o600 },
);
console.log(
  'Additive Phase 2 migrations applied to the remote ' +
    database +
    ' database on ' +
    target.hostname +
    '. Runtime role files contain no migration credentials and no secret was printed.',
);
