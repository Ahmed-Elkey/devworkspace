/**
 * Production bootstrap — run ON THE TARGET SERVER (repo already copied):
 *
 *   node infra/prod/bootstrap.mjs --domain devworkspace.<SERVER-IP>.sslip.io \
 *        --bundle /path/to/prod-bundle.tgz [--smtp 'smtp://user:pass@host:587'] \
 *        [--from 'DevWorkspace <you@example.com>']
 *
 * Modes:
 *   --bundle  one-time restore: verify bundle integrity, prepare DB roles on
 *             new passwords, run migrations, restore local data, verify row
 *             counts against the bundle manifest, then start the whole stack.
 *   (no flag) reconfiguration: regenerate compose/env files for --domain and
 *             --smtp changes and recreate the app services; the database and
 *             the stored PostgreSQL credentials are preserved untouched.
 *
 * Credential policy: every output line contains service names, counts and
 * URLs only. Values are written directly into 0600 env files and never
 * printed. Add --assume-server to run this on a machine that also hosts the
 * native development stack (only useful for rehearsal on a scratch copy).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const backend = resolve('.');
const repoRoot = resolve(backend, '..');
const composeFile = 'infra/prod/compose.prod.yaml';
const composeEnv = 'infra/prod/.env.prod';

const argAfter = (flag) =>
  process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;
const domain = argAfter('--domain');
const bundlePath = argAfter('--bundle');
const smtpUrl = argAfter('--smtp');
const smtpFrom = argAfter('--from');
const assumeServer = process.argv.includes('--assume-server');
const firstRun = Boolean(bundlePath);
const composeArgs = ['compose', '-f', composeFile, '--env-file', composeEnv];

const fail = (message) => {
  console.error(message);
  process.exit(2);
};
if (!/^[a-z0-9.-]+(:\d+)?$/i.test(domain ?? ''))
  fail(
    'usage: node infra/prod/bootstrap.mjs --domain <name.sslip.io> --bundle <tgz> [--smtp smtp://user:pass@host:587 --from "DevWorkspace <address>"]',
  );
if (smtpUrl && !/^smtps?:\/\//.test(smtpUrl)) fail('--smtp must start with smtp:// or smtps://');
if (smtpUrl && !smtpFrom) fail('--from is required together with --smtp');
if (smtpFrom && (/[\r\n]/.test(smtpFrom) || !/<.+@.+>/.test(smtpFrom)))
  fail('--from must look like: DevWorkspace <address@provider>');
if (!assumeServer && existsSync(resolve(backend, '.local/native/storage')))
  fail(
    'This machine also hosts the native development stack (.local/native). Refusing to touch it; pass --assume-server only on a scratch rehearsal copy.',
  );
const appOrigin = 'https://' + domain;

/** Read a KEY=VALUE file into an object (values never printed). */
async function readEnvObject(path) {
  return Object.fromEntries(
    (await readFile(path, 'utf8'))
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf('=');
        if (at <= 0) throw new Error('Malformed env line in ' + path);
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

/** Write an env object (0600). Output text lists key names only. */
async function writeEnvObject(path, entries, comments = []) {
  for (const key of Object.keys(entries))
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(String(entries[key])))
      throw new Error('Illegal env entry: ' + key);
  await mkdir(resolve(path, '..'), { recursive: true });
  const header = comments.length ? comments.map((c) => '# ' + c).join('\n') + '\n' : '';
  await writeFile(
    path,
    header +
      Object.entries(entries)
        .map(([key, value]) => key + '=' + value)
        .join('\n') +
      '\n',
    { mode: 0o600 },
  );
}

/** docker compose wrapper from the backend directory. */
function compose(extra, capture = false) {
  const command = ['docker', ...composeArgs, ...extra];
  return capture ? execFileSync(command[0], command.slice(1), { cwd: backend, encoding: 'utf8' }) : execFileSync(command[0], command.slice(1), { cwd: backend });
}

/** Stream a file through sha256. */
function sha256(file) {
  return new Promise((ok, fail) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', fail)
      .on('end', () => ok(hash.digest('hex')));
  });
}

const stage = resolve(backend, '.local/bundle-work');
const prodDir = resolve(backend, '.local/prod');

/** Unpack + verify + place the bundle. Returns {counts, betterAuthSecret}. */
async function restoreBundle() {
  if (!existsSync(bundlePath)) fail('Bundle file not found: ' + bundlePath);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  execFileSync('tar', ['-xzf', bundlePath, '-C', stage]);
  const sums = (await readFile(resolve(stage, 'SHA256SUMS'), 'utf8')).trimEnd().split('\n');
  for (const line of sums) {
    const [expected, relative] = line.split(/\s+/);
    if ((await sha256(resolve(stage, relative))) !== expected) fail('Bundle integrity failure: ' + relative);
  }
  console.log('bundle: ' + sums.length + ' files verified against SHA256SUMS');

  const counts = JSON.parse(await readFile(resolve(stage, 'counts.json'), 'utf8'));
  await mkdir(prodDir, { recursive: true });
  await copyFile(resolve(stage, 'counts.json'), resolve(prodDir, 'counts.json'));
  await rename(resolve(stage, 'db.dump'), resolve(prodDir, 'db.dump'));
  if (existsSync(resolve(stage, 'secrets/s3-identities.json'))) {
    await copyFile(resolve(stage, 'secrets/s3-identities.json'), resolve(prodDir, 's3-identities.json'));
    await chmod(resolve(prodDir, 's3-identities.json'), 0o600);
  }

  const storageDir = resolve(prodDir, 'data/storage');
  await mkdir(storageDir, { recursive: true });
  execFileSync('tar', ['-xzf', resolve(stage, 'storage.tar.gz'), '-C', storageDir]);
  const frontendDist = resolve(repoRoot, 'frontend/dist');
  await mkdir(frontendDist, { recursive: true });
  execFileSync('tar', ['-xzf', resolve(stage, 'frontend-dist.tar.gz'), '-C', frontendDist]);

  await mkdir(resolve(backend, '.local'), { recursive: true });
  for (const name of ['phase2-credentials.json', 'phase4-api.env', 'phase4-worker.env']) {
    const source = resolve(stage, 'secrets', name);
    if (existsSync(source)) {
      await copyFile(source, resolve(backend, '.local', name));
      await chmod(resolve(backend, '.local', name), 0o600);
    }
  }
  const betterAuthSecret = (await readFile(resolve(stage, 'secrets/better-auth-secret'), 'utf8')).trimEnd();
  await rm(stage, { recursive: true, force: true });
  return { counts, betterAuthSecret };
}

/* --------------------------------------------------------------------- */

if (!existsSync('docker-compose.yml') && execFileSync('docker', ['compose', 'version'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().length < 10)
  fail('docker compose is required');

let carried;
if (firstRun) {
  carried = await restoreBundle();
  if (!existsSync(resolve(backend, '.local/phase2-credentials.json')))
    fail('Bundle did not carry .local/phase2-credentials.json');
} else if (!existsSync(resolve(backend, '.local/phase2-credentials.json'))) {
  fail('Missing .local/phase2-credentials.json: the first run requires --bundle');
}

/* PostgreSQL credentials survive re-runs: the cluster role cannot be changed
   by env rewrites, so reuse the values written during the --bundle run. */
const envLocalPath = resolve(backend, '.env.local');
let postgresAdminUser, postgresAdminPassword;
if (existsSync(envLocalPath)) {
  const existing = await readEnvObject(envLocalPath);
  postgresAdminUser = existing.POSTGRES_USER;
  postgresAdminPassword = existing.POSTGRES_PASSWORD;
}
if (!postgresAdminUser || !postgresAdminPassword) {
  if (!firstRun) fail('.env.local without POSTGRES credentials; rerun with --bundle');
  postgresAdminUser = 'dw_admin';
  postgresAdminPassword = randomBytes(24).toString('hex');
  await writeEnvObject(envLocalPath, {
    POSTGRES_USER: postgresAdminUser,
    POSTGRES_PASSWORD: postgresAdminPassword,
  }, ['prepare-phase2 admin connection (server-local only)']);
}

let redisPassword;
try {
  redisPassword = (await readEnvObject(resolve(backend, composeEnv))).REDIS_PASSWORD;
} catch {}
if (!redisPassword) redisPassword = randomBytes(24).toString('hex');

await writeEnvObject(resolve(backend, composeEnv), {
  POSTGRES_USER: postgresAdminUser,
  POSTGRES_PASSWORD: postgresAdminPassword,
  REDIS_PASSWORD: redisPassword,
  DOMAIN: domain,
  APP_ORIGIN: appOrigin,
}, ['compose interpolation file — regenerated by infra/prod/bootstrap.mjs']);

/* Marker consumed by scripts/prepare-phase2.mjs: the server runs the cluster
   through Docker, so the native-cluster ownership marker is a stub whose root
   and port fields match the prepare-phase2 expectations. */
await writeFile(
  resolve(backend, '.local/pg-owner.json'),
  JSON.stringify({ root: backend, data: resolve(backend, '.local/pg'), port: 55432, bin: '/usr/bin' }, null, 2) + '\n',
);
await mkdir(resolve(backend, '.local/pg'), { recursive: true });

if (firstRun) {
  compose(['up', '-d', 'postgres']);
  let ready = '';
  for (let attempt = 0; attempt < 40 && !ready.includes('accepting connections'); attempt++) {
    ready = execFileSync('docker', [...composeArgs, 'exec', '-T', 'postgres', 'pg_isready', '-p', '55432'], {
      cwd: backend,
      encoding: 'utf8',
    });
    if (!ready.includes('accepting connections')) execFileSync('sleep', ['2']);
  }
  if (!ready.includes('accepting connections')) fail('PostgreSQL did not become ready');

  execFileSync('node', ['scripts/prepare-phase2.mjs'], { cwd: backend });

  const dumpBytes = await readFile(resolve(prodDir, 'db.dump'));
  const restore = spawnSync(
    'docker',
    [
      ...composeArgs,
      'exec', '-T', '-e', 'PGPASSWORD=' + postgresAdminPassword, 'postgres', 'pg_restore',
      '--host=127.0.0.1', '--port=55432', '--username=' + postgresAdminUser,
      '--dbname=devworkspace_phase2', '--data-only', '--disable-triggers',
      '--single-transaction', '--exit-on-error',
    ],
    { cwd: backend, input: dumpBytes },
  );
  if (restore.status !== 0)
    fail('pg_restore failed: ' + (restore.stderr ?? '').toString().split('\n').slice(0, 4).join(' | '));

  const manifest = JSON.parse(await readFile(resolve(prodDir, 'counts.json'), 'utf8'));
  const mismatches = [];
  const checked = Object.entries(manifest.counts);
  for (const [table, expected] of checked) {
    const quoted = table.split('.').map((part) => '"' + part.replace(/"/g, '') + '"').join('.');
    const probe = execFileSync(
      'docker',
      [...composeArgs, 'exec', '-T', '-e', 'PGPASSWORD=' + postgresAdminPassword, 'postgres', 'psql',
        '-U', postgresAdminUser, '-d', 'devworkspace_phase2', '-t', '-A', '-c',
        'SELECT count(*) FROM ' + quoted],
      { cwd: backend, encoding: 'utf8' },
    );
    const actual = Number(probe.trim());
    if (!Number.isSafeInteger(actual) || actual !== expected)
      mismatches.push(table + ': got ' + (Number.isSafeInteger(actual) ? actual : probe.trim()) + ', expected ' + expected);
  }
  if (mismatches.length) fail('RESTORE MISMATCH (no data-loss tolerance): ' + mismatches.join('; '));
  console.log('restore: ' + checked.length + ' tables match the bundle row counts');
}

const phase2Api = await readEnvObject(resolve(backend, '.local/phase2-api.env'));
const phase2Worker = await readEnvObject(resolve(backend, '.local/phase2-worker.env'));
const merged = existsSync(resolve(backend, '.local/phase4-api.env'))
  ? await readEnvObject(resolve(backend, '.local/phase4-api.env'))
  : {};
const mergedWorker = existsSync(resolve(backend, '.local/phase4-worker.env'))
  ? await readEnvObject(resolve(backend, '.local/phase4-worker.env'))
  : {};

/* The session secret persists across reconfigurations: the --bundle run
   writes it once into prod-api.env and later runs keep its stored value. */
const previousApi = existsSync(resolve(backend, '.local/prod-api.env'))
  ? await readEnvObject(resolve(backend, '.local/prod-api.env'))
  : {};
const betterAuthSecret = carried?.betterAuthSecret ?? previousApi.BETTER_AUTH_SECRET;
if (!betterAuthSecret || betterAuthSecret.length < 32) fail('No BETTER_AUTH_SECRET available for the API env');

const redisUrl = 'redis://:' + redisPassword + '@127.0.0.1:6379';
const smtpEntries = smtpUrl ? { SMTP_URL: smtpUrl, SMTP_FROM: smtpFrom } : {};
await writeEnvObject(
  resolve(backend, '.local/prod-api.env'),
  { ...phase2Api, ...merged, BETTER_AUTH_SECRET: betterAuthSecret, REDIS_URL: redisUrl, APP_ORIGIN: appOrigin, ...smtpEntries },
  ['Product API runtime environment — generated by infra/prod/bootstrap.mjs'],
);
await writeEnvObject(
  resolve(backend, '.local/prod-worker.env'),
  { ...phase2Worker, ...mergedWorker, REDIS_URL: redisUrl, APP_ORIGIN: appOrigin, ...smtpEntries },
  ['Product worker runtime environment — generated by infra/prod/bootstrap.mjs'],
);

if (firstRun) compose(['up', '-d', 'redis', 'storage', 'api', 'worker', 'proxy', 'caddy']);
else compose(['up', '-d', '--force-recreate', 'redis', 'api', 'worker', 'proxy', 'caddy']);

let health = '';
for (let attempt = 0; attempt < 90 && typeof health !== 'number'; attempt++) {
  try {
    health = (await fetch(appOrigin + '/api/v1/health/ready', { signal: AbortSignal.timeout(4000) })).status;
  } catch {
    execFileSync('sleep', ['2']);
  }
}
const psRaw = compose(['ps', '--format', 'json'], true);
const serviceStates = psRaw
  .trimEnd()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const entry = JSON.parse(line);
    return entry.Service + '=' + (entry.State ?? entry.Status ?? '?');
  });
console.log(
  JSON.stringify({
    event: 'bootstrap.ready',
    origin: appOrigin,
    restoreVerified: firstRun ? 'row counts verified' : 'not applicable (existing data preserved)',
    apiHealth: typeof health === 'number' ? health : 'timed out — complete ACME issuance or inspect `docker compose ps`',
    services: serviceStates,
    mail: smtpEntries.SMTP_URL ? 'configured' : 'NOT configured — rerun with --smtp and --from after the e-mail account exists',
  }),
);
