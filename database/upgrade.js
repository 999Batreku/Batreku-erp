// 幂等数据库升级：补充新角色与账号，不重建已有数据库
const bcrypt = require('bcryptjs');

module.exports = function upgrade(db) {
  // 0. 老版本数据库补齐 users.department 列（幂等）
  const userCols = db.prepare('PRAGMA table_info(users)').all().map(function (c) { return c.name; });
  if (userCols.indexOf('department') === -1) {
    db.prepare('ALTER TABLE users ADD COLUMN department TEXT').run();
    console.log('✅ 已为 users 表补充 department 列');
  }

  // 1. 新增运营总监角色（若不存在）
  const role = db.prepare("SELECT id FROM roles WHERE name = 'operations_director'").get();
  let roleId;
  if (!role) {
    const r = db.prepare(
      "INSERT INTO roles (name, display_name, description, level) VALUES (?, ?, ?, ?)"
    ).run('operations_director', '运营总监', '负责客户审批、客户编码发放及整体运营管理', 'management');
    roleId = r.lastInsertRowid;
    console.log('✅ 已新增角色：运营总监 (operations_director)');
  } else {
    roleId = role.id;
  }

  // 2. 新增运营总监账号 ops/ops123（若不存在）
  const user = db.prepare("SELECT id FROM users WHERE username = 'ops'").get();
  let userId;
  if (!user) {
    const hash = bcrypt.hashSync('ops123', 10);
    const u = db.prepare(
      "INSERT INTO users (username, password, real_name, email, department, status) VALUES (?, ?, ?, ?, ?, 1)"
    ).run('ops', hash, '运营总监', 'ops@batreku.com', '运营部');
    userId = u.lastInsertRowid;
    console.log('✅ 已新增账号：ops / ops123（运营总监）');
  } else {
    userId = user.id;
  }

  // 3. 关联用户与角色（幂等）
  const exists = db.prepare(
    'SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ?'
  ).get(userId, roleId);
  if (!exists) {
    db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, roleId);
  }

  // 4. quotations 表新增审批相关字段（幂等）
  const qCols = db.prepare('PRAGMA table_info(quotations)').all().map(c => c.name);
  const qAlters = [
    { col: 'approval_status',  sql: "ALTER TABLE quotations ADD COLUMN approval_status TEXT DEFAULT 'draft'" },
    { col: 'approval_chain',   sql: "ALTER TABLE quotations ADD COLUMN approval_chain TEXT DEFAULT '[]'" },
    { col: 'rejected_by',      sql: "ALTER TABLE quotations ADD COLUMN rejected_by TEXT" },
    { col: 'rejected_at',      sql: "ALTER TABLE quotations ADD COLUMN rejected_at DATETIME" },
    { col: 'rejection_reason', sql: "ALTER TABLE quotations ADD COLUMN rejection_reason TEXT" },
  ];
  for (const a of qAlters) {
    if (qCols.indexOf(a.col) === -1) {
      db.prepare(a.sql).run();
      console.log('✅ quotations 表新增列:', a.col);
    }
  }

  // 5. users 表新增签名字段（幂等）
  const uCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (uCols.indexOf('signature_image') === -1) {
    db.prepare('ALTER TABLE users ADD COLUMN signature_image TEXT').run();
    console.log('✅ users 表新增列: signature_image');
  }

  // 6. 将已有 quotations 数据的 approval_status 从旧 status 同步
  // 旧 status: draft/pending/approved/rejected → 新 approval_status 映射
  db.prepare(`
    UPDATE quotations SET approval_status = CASE
      WHEN status = 'draft' THEN 'draft'
      WHEN status = 'pending' THEN 'pending_ops'
      WHEN status = 'approved' THEN 'approved'
      WHEN status = 'rejected' THEN 'rejected'
      ELSE 'draft'
    END
    WHERE approval_status IS NULL OR approval_status = 'draft'
  `).run();
};
