// 一次性数据清理：去除超级管理员 + 用户多角色去重
// 用法: node cleanup_roles.js
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, 'database/batreku.db'));

const superRole = db.prepare("SELECT id FROM roles WHERE name = 'super_admin'").get();

if (superRole) {
  // 所有被授予 super_admin 的用户
  const affected = db.prepare('SELECT user_id FROM user_roles WHERE role_id = ?').all(superRole.id);
  for (const { user_id } of affected) {
    const other = db.prepare('SELECT role_id FROM user_roles WHERE user_id = ? AND role_id != ? ORDER BY id LIMIT 1').get(user_id, superRole.id);
    if (other) {
      // 已有其他角色：仅移除 super_admin
      db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(user_id, superRole.id);
      console.log('用户 ' + user_id + ': 移除超级管理员，保留现有角色');
    } else {
      // 只有 super_admin：降级为总经理
      const gm = db.prepare("SELECT id FROM roles WHERE name = 'general_manager'").get();
      if (gm) {
        db.prepare('UPDATE user_roles SET role_id = ? WHERE user_id = ? AND role_id = ?').run(gm.id, user_id, superRole.id);
        console.log('用户 ' + user_id + ': 超级管理员 → 总经理');
      }
    }
  }
  // 确认无引用后删除角色
  const remain = db.prepare('SELECT COUNT(*) AS c FROM user_roles WHERE role_id = ?').get(superRole.id).c;
  if (remain === 0) {
    db.prepare('DELETE FROM roles WHERE id = ?').run(superRole.id);
    console.log('超级管理员角色已删除');
  }
}

// 多角色去重：同一用户保留最早分配的一个角色
const dupes = db.prepare(`
  SELECT user_id, MIN(id) AS keep_id FROM user_roles
  GROUP BY user_id HAVING COUNT(*) > 1
`).all();
for (const d of dupes) {
  db.prepare('DELETE FROM user_roles WHERE user_id = ? AND id != ?').run(d.user_id, d.keep_id);
  console.log('用户 ' + d.user_id + ': 多角色已合并为一个');
}

console.log('清理完成');
db.close();
