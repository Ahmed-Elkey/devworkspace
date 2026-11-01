/**
 * Production bundle builder — run on the LOCAL machine right before migration.
 *
 * Collects everything the target server needs into one tarball the operator
 * copies manually (scp) to the new host:
 *   db.dump                     pg_dump --data-only of devworkspace_phase2
 *   storage.tar.gz              SeaweedFS volumes + filer metadata + master config
 *   frontend-dist.tar.gz        designed static frontend, freshly built
 *   secrets/phase2-credentials.json  fixed DB role passwords + PRODUCT_MAIL_KEY
 *   secrets/phase2-api.env      local product API runtime roles (reused on server)
 *   secrets/phase2-worker.env   local product worker runtime roles
 *   secrets/phase4-api.env      FILE_STORAGE keys for the API (optional)
 *   secrets/phase4-worker.env   FILE_STORAGE / CLEANUP_STORAGE keys for the worker
 *   secrets/s3-identities.json  bucket-scoped storage identities (SeaweedFS S3 config)
 *   secrets/better-auth-secret  session secret (never printed)
 *   counts.json                 per-table row counts, verified again after restore
 *   SHA256SUMS                  integrity manifest verified on the server
 *
 * The bundle contains live credentials: 0600 permissions, stored under
 * backend/.local (never committed), transferred only over a trusted channel.
 * After producing a bundle the local database is the migration snapshot —
 * re-run this script if local data changed since.
 *
 * Usage: node infra/prod/bundle.mjs [--out ../.local/prod-bundle.tgz]
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { resolve } from 'node:path';

const backend = resolve('.');
const frontendDirectory = resolve(backend, '..', 'frontend');
const stage = resolve(backend, '.local/bundle-work');
const out =
  process.argv.includes('--out')
    ? resolve(process.argv[process.argv.indexOf('--out') + 1])
    : resolve(backend, '.local/prod-bundle.tgz');

const marker = JSON.parse(await readFile('.local/pg-owner.json', 'utf8'));
if (marker.root !== backend || marker.port !== 55432) throw new Error('Unowned local cluster');
const dumpBinary = resolve(marker.bin, 'pg_dump');
const restoreBinary = resolve(marker.bin, 'pg_restore');
const vendorDump = resolve(backend, '.local/vendor/pg-client/bin/pg_dump');
const vendorRestore = resolve(backend, '.local/vendor/pg-client/bin/pg_restore');
if (!existsSync(dumpBinary) && !existsSync(vendorDump))
  throw new Error('pg_dump missing from the project-local PostgreSQL and backend/.local/vendor/pg-client');
if (!existsSync(restoreBinary) && !existsSync(vendorRestore))
  throw new Error('pg_restore missing from the project-local PostgreSQL and backend/.local/vendor/pg-client');
const pgDump = existsSync(dumpBinary) ? dumpBinary : vendorDump;
const pgRestore = existsSync(restoreBinary) ? restoreBinary : vendorRestore;

process.loadEnvFile('.env.local');
const admin = new Client({
  host: '127.0.0.1',
  port: 55432,
  database: 'devworkspace_phase2',
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});
await admin.connect();

/** Quote a schema/table identifier against SQL quoting surprises. */
const quoted = (identifier) => '"' + identifier.replace(/"/g, '') + '"';
/** Stream a file through sha256 without holding it in memory. */
function sha256(file) {
  return new Promise((ok, fail) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', fail)
      .on('end', () => ok(hash.digest('hex')));
  });
}

try {
  const serverVersion = (await admin.query('SHOW server_version')).rows[0].server_version.split(/\s+/)[0];
  const tables = (
    await admin.query(
      "SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')",
    )
  ).rows;
  const counts = {};
  for (const row of tables) {
    counts[row.schemaname + '.' + row.tablename] =
      (
        await admin.query(
          'SELECT count(*)::bigint AS n FROM ' + quoted(row.schemaname) + '.' + quoted(row.tablename),
        )
      ).rows[0].n;
  }

  await mkdir(stage, { recursive: true });
  await mkdir(resolve(stage, 'secrets'), { recursive: true });

  execFileSync(
    pgDump,
    [
      '--dbname=devworkspace_phase2',
      '--data-only',
      '--format=c',
      '--file=' + resolve(stage, 'db.dump'),
      '--host=127.0.0.1',
      '--port=55432',
      '--username=' + process.env.POSTGRES_USER,
    ],
    { env: { ...process.env, PGPASSWORD: process.env.POSTGRES_PASSWORD } },
  );
  const toc = execFileSync(pgRestore, ['--list', resolve(stage, 'db.dump')], { encoding: 'utf8' });
  if (!toc.includes('TABLE DATA')) throw new Error('Dump TOC has no table data');

  execFileSync('tar', ['-czf', resolve(stage, 'storage.tar.gz'), '-C', resolve(backend, '.local/native/storage'), '.']);
  execFileSync('pnpm', ['build'], { cwd: frontendDirectory, stdio: 'ignore' });
  execFileSync('tar', ['-czf', resolve(stage, 'frontend-dist.tar.gz'), '-C', resolve(frontendDirectory, 'dist'), '.']);

  const secretSources = [
    '.local/phase2-credentials.json',
    '.local/phase2-api.env',
    '.local/phase2-worker.env',
    '.local/phase4-api.env',
    '.local/phase4-worker.env',
    '.local/s3-identities.json',
  ];
  const stagedSecrets = [];
  for (const relative of secretSources) {
    const source = resolve(backend, relative);
    try {
      await copyFile(source, resolve(stage, 'secrets', relative.split('/').pop()));
      await chmod(resolve(stage, 'secrets', relative.split('/').pop()), 0o600);
      stagedSecrets.push(relative);
    } catch (error) {
      if ((error ?? {}).code !== 'ENOENT') throw error;
      console.error('optional: skipping absent ' + relative);
    }
  }
  const envLocal = await readFile('.env.local', 'utf8');
  const betterAuthSecret =
    envLocal
      .split('\n')
      .filter((line) => line.startsWith('BETTER_AUTH_SECRET='))
      .map((line) => line.slice('BETTER_AUTH_SECRET='.length).trim())
      .pop() ?? '';
  if (betterAuthSecret.length < 32) throw new Error('BETTER_AUTH_SECRET missing or too short');
  await writeFile(resolve(stage, 'secrets/better-auth-secret'), betterAuthSecret + '\n', { mode: 0o600 });
  stagedSecrets.push('secrets/better-auth-secret');

  await writeFile(
    resolve(stage, 'counts.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), serverVersion, counts }, null, 2) + '\n',
  );

  const manifest = [
    'db.dump',
    'storage.tar.gz',
    'frontend-dist.tar.gz',
    'counts.json',
    ...stagedSecrets.map((relative) => 'secrets/' + relative.split('/').pop()),
  ];
  const lines = [];
  for (const relative of manifest) lines.push((await sha256(resolve(stage, relative))) + '  ' + relative);
  await writeFile(resolve(stage, 'SHA256SUMS'), lines.join('\n') + '\n');

  await rm(out, { force: true });
  execFileSync('tar', ['-czf', out, '-C', stage, '.']);
  await chmod(out, 0o600);
  const bundleSize = (await stat(out)).size;
  const bundleHash = await sha256(out);
  console.log(
    JSON.stringify({
      event: 'bundle.ready',
      bundle: out,
      bytes: bundleSize,
      sha256: bundleHash,
      serverVersion,
      tables: Object.keys(counts).length,
    }),
  );
  console.error('The bundle holds live credentials; transfer it over a trusted channel and delete both copies when done.');
} finally {
  await admin.end();
  await rm(stage, { recursive: true, force: true });
}
