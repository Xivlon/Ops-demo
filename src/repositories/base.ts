import type { Pool } from '@neondatabase/serverless';

export abstract class BaseRepository {
  constructor(protected pool: Pool) {}

  protected async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows as T[];
    } finally {
      client.release();
    }
  }

  protected async queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  protected async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return { rowCount: result.rowCount ?? 0 };
    } finally {
      client.release();
    }
  }
}
