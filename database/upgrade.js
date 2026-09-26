// 幂等数据库升级：补充新角色与账号，不重建已有数据库
const bcrypt = require('bcryptjs');

module.exports = function upgrade(db) {
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
};
