#!/usr/bin/env node
/**
 * Diagnostic script to verify PostgreSQL/Neon connectivity and list tables.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/check-db.mjs
 */

import pg from 'pg';
import { Pool as NeonPool } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

// Print connection host/database without leaking credentials
let displayUrl;
try {
  const u = new URL(DATABASE_URL);
  displayUrl = `${u.protocol}//${u.username}:***@${u.host}${u.pathname}`;
} catch {
  displayUrl = '<could not parse>';
}
console.log('Connecting to:', displayUrl);

const isNeon = DATABASE_URL.includes('neon.tech');
const Pool = isNeon ? NeonPool : pg.Pool;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isNeon ? { rejectUnauthorized: false } : false,
});

async function run() {
  try {
    const currentDb = await pool.query('SELECT current_database() AS db, current_user AS user');
    console.log('Connected as:', currentDb.rows[0]);

    const tables = await pool.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `);

    if (tables.rows.length === 0) {
      console.log('No tables found in this database.');
    } else {
      console.log('Tables:');
      console.table(tables.rows);
    }
  } catch (error) {
    console.error('Connection/query failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
