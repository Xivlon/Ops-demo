import type { Pool, PoolClient } from '@neondatabase/serverless';

// Transaction callback type
export type TransactionCallback<T> = (client: PoolClient) => Promise<T>;

export abstract class BaseRepository {
  constructor(protected pool: Pool) {}

  protected async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows as T[];
    } catch (error) {
      console.error('Query failed:', sql.substring(0, 100), error);
      throw error;
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

  /**
   * Execute multiple operations in a transaction
   * Usage:
   * ```typescript
   * await repos.storage.transaction(async (client) => {
   *   await client.query('UPDATE storage SET status = $1 WHERE id = $2', ['picked_up', id]);
   *   await client.query('INSERT INTO audit_log ...');
   * });
   * ```
   */
  async transaction<T>(callback: TransactionCallback<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Execute a query within a transaction (internal use)
   * Returns a client that must be released manually
   */
  protected async withTransactionClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.transaction(callback);
  }
}
