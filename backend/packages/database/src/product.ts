import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated-product/client.js';
import { Pool, type PoolConfig, type PoolClient } from 'pg';

// Honor libpq sslmode semantics from the connection URL. node-postgres does not
// parse sslmode from the connection string in every bundled version, so hosted
// providers requiring TLS (e.g. Neon) receive an explicit `ssl` option while
// plain local URLs behave exactly as before (no sslmode → no ssl override).
function dbConfig(url: string, max: number): PoolConfig {
  const sslmode = new URL(url).searchParams.get('sslmode');
  const ssl =
    !sslmode || sslmode === 'disable'
      ? undefined
      : sslmode === 'verify-ca' || sslmode === 'verify-full'
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false };
  return { connectionString: url, max, options: '-c timezone=UTC', ...(ssl ? { ssl } : {}) };
}
export function createIdentityDatabase(url: string, max = 6): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ ...dbConfig(url, max) }) });
}
export function createTenantPrisma(url: string, max = 6): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ ...dbConfig(url, max) }) });
}
export type IdentityDatabase = PrismaClient;
export type SqlTransaction = Pick<PoolClient, 'query'>;
export class TenantDatabase {
  readonly pool: Pool;
  constructor(url: string, max = 6) {
    this.pool = new Pool(dbConfig(url, max));
    this.pool.on('error', (error: NodeJS.ErrnoException) => {
      const code =
        typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
          ? error.code
          : 'CONNECTION_FAILURE';
      console.warn(JSON.stringify({ event: 'database.pool.client_error', code }));
    });
  }
  async transaction<T>(
    organizationId: string,
    work: (tx: SqlTransaction) => Promise<T>,
  ): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query('BEGIN');
      await tx.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      const result = await work(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
