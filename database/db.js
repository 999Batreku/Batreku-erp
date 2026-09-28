// PostgreSQL 连接与兼容查询层
// 提供 get/all/run/tx 接口，并把 SQLite 风格的 ? 占位符自动转换为 $1,$2
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ 缺少 DATABASE_URL 环境变量');
  process.exit(1);
}

const useSsl = /sslmode=require/i.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => {
  console.error('⚠️ 空闲 PostgreSQL 连接出错:', err.message);
});

// 将 ? 占位符（不在单引号字符串内）转换为 $1,$2,...
function convertPlaceholders(sql) {
  let out = '';
  let i = 0;
  let n = 0;
  let inStr = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      out += ch;
      // 转义的单引号 ''
      if (inStr && sql[i + 1] === "'") {
        out += sql[i + 1];
        i += 2;
        continue;
      }
      inStr = !inStr;
      i += 1;
      continue;
    }
    if (ch === '?' && !inStr) {
      n += 1;
      out += '$' + n;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function makeHelpers(executor) {
  async function query(text, params) {
    return executor.query(convertPlaceholders(text), params || []);
  }
  async function get(text, params) {
    const r = await query(text, params);
    return r.rows[0];
  }
  async function all(text, params) {
    const r = await query(text, params);
    return r.rows;
  }
  async function run(text, params) {
    let sql = text;
    // INSERT 且未显式 RETURNING 时补 RETURNING id，模拟 lastInsertRowid
    if (/^\s*INSERT/i.test(sql) && !/RETURNING/i.test(sql)) {
      sql = sql.replace(/\s*;?\s*$/, '') + ' RETURNING id';
    }
    const r = await query(sql, params);
    const first = r.rows[0];
    return {
      id: first ? first.id : undefined,
      lastInsertRowid: first ? first.id : undefined,
      changes: r.rowCount,
      rowCount: r.rowCount,
      rows: r.rows,
    };
  }
  return { query, get, all, run, executor };
}

const base = makeHelpers(pool);

// 事务：fn 接收 wrap(client) 的辅助对象
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = makeHelpers(client);
    const result = await fn(t);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query: base.query,
  get: base.get,
  all: base.all,
  run: base.run,
  tx,
  convertPlaceholders,
  close: () => pool.end(),
};
