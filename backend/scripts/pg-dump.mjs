import { Client } from 'pg';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

process.loadEnvFile('.env.local');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

const url = new URL(DATABASE_URL);
const outFile = resolve(
  'backups',
  `dump-${url.pathname.slice(1)}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`,
);

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const { rows } = await client.query(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name",
  );
  const schemas = rows.map((r) => r.schema_name);

  const statements = [];
  statements.push(`-- DevWorkspace portable dump`);
  statements.push(`-- Generated: ${new Date().toISOString()}`);
  statements.push(`-- Source: ${DATABASE_URL.replace(/\/\/.*@/, '//***@')}`);
  statements.push('BEGIN;');
  statements.push('SET session_replication_role = replica;');

  for (const schema of schemas) {
    statements.push(`-- Schema: ${schema}`);
    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",
      [schema],
    );
    for (const { table_name } of tables.rows) {
      const rowsData = await client.query(
        `SELECT * FROM ${schema}.${table_name} FOR UPDATE`,
      );
      if (rowsData.rows.length === 0) {
        statements.push(`DELETE FROM ${schema}.${table_name};`);
        continue;
      }
      const columns = Object.keys(rowsData.rows[0]);
      const values = rowsData.rows
        .map((row) =>
          columns
            .map((col) => {
              const v = row[col];
              if (v === null) return 'NULL';
              if (typeof v === 'number') return String(v);
              if (typeof v === 'boolean') return v ? 'true' : 'false';
              if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
              return `'${String(v).replace(/'/g, "''")}'`;
            })
            .join(','),
        )
        .map((v) => `(${v})`)
        .join(',\n  ');
      statements.push(`DELETE FROM ${schema}.${table_name};`);
      statements.push(
        `INSERT INTO ${schema}.${table_name} (${columns.join(',')}) VALUES\n  ${values};`,
      );
    }
  }

  statements.push('SET session_replication_role = DEFAULT;');
  statements.push('COMMIT;');

  await client.end();

  const sql = statements.join('\n\n') + '\n';
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(resolve('backups'), { recursive: true });
  await writeFile(outFile, sql, 'utf8');
  console.log(`Dump written to ${outFile} (${Buffer.byteLength(sql, 'utf8')} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
