const express = require('express');
const bcrypt = require('bcryptjs');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/users
  router.get('/', (req, res) => {
    try {
      // 确保 users 表有 department 字段（迁移）
      try {
        db.prepare('ALTER TABLE users ADD COLUMN department TEXT').run();
      } catch (e) { /* 已存在 */ }
      // 从 employees 同步初始 department 到 users（仅当 users.department 为空时）
      db.prepare(`
        UPDATE users SET department = (
          SELECT e.department FROM employees e WHERE e.email = users.email AND users.department IS NULL
        ) WHERE department IS NULL AND email IS NOT NULL AND email != ''
      `).run();
      db.prepare(`
        UPDATE users SET department = (
          SELECT e.department FROM employees e WHERE e.name = users.real_name AND users.department IS NULL
        ) WHERE department IS NULL
      `).run();

      const users = db.prepare(`
        SELECT u.id, u.username, u.real_name, u.email, u.phone, u.status, u.created_at, u.department,
          r.name as role_name, r.display_name as role_display_name
        FROM users u
        LEFT JOIN (
          SELECT user_id, MIN(role_id) AS role_id FROM user_roles GROUP BY user_id
        ) ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        ORDER BY u.id
      `).all();
      res.json({ success: true, data: users });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/users
  router.post('/', (req, res) => {
    try {
      const { username, password, real_name, email, phone, role_name, department, status } = req.body;
      // 自动生成 username 和 password（如果前端未提供）
      const autoUsername = username || ('user_' + Date.now());
      const autoPassword = password || ('Pass' + Math.random().toString(36).slice(-8) + '!');

      const hash = bcrypt.hashSync(autoPassword, 10);
      const result = db.prepare('INSERT INTO users (username, password, real_name, email, phone, status, department) VALUES (?, ?, ?, ?, ?, ?, ?)').run(autoUsername, hash, real_name, email || null, phone || null, status !== undefined ? status : 1, department || '管理部');
      
      const userId = result.lastInsertRowid;

      // 角色映射：前端 role id -> 后端 role name
      const roleMap = {
        'general_manager': 'general_manager',
        'tech_director': 'technical_director',
        'operations_director': 'general_manager', // 降级到最接近的
        'dept_manager': 'sales_manager', // 降级到部门经理
        'sales': 'sales_rep',
        'social_media': 'sales_rep',
        'purchaser': 'procurement_staff',
        'warehouse_staff': 'warehouse_manager',
        'production_staff': 'production_manager',
        'finance_staff': 'finance_manager',
        'admin_staff': 'hr_manager',
        'aftersales_staff': 'sales_rep'
      };
      const resolvedRole = roleMap[role_name] || role_name || 'viewer';
      const role = db.prepare('SELECT id FROM roles WHERE name = ?').get(resolvedRole);
      if (role) db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, role.id);

      // 同步创建员工记录
      const dept = department || '管理部';
      const empNo = 'EMP-' + String(userId).padStart(3, '0');
      db.prepare('INSERT OR IGNORE INTO employees (employee_no, name, email, department) VALUES (?, ?, ?, ?)').run(empNo, real_name || autoUsername, email || null, dept);

      res.json({ success: true, data: { id: userId, username: autoUsername, password: autoPassword }, message: '用户创建成功' });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.json({ success: false, error: '用户名或邮箱已存在' });
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/users/:id
  router.put('/:id', (req, res) => {
    try {
      const { real_name, email, phone, role_name, password, department, status } = req.body;
      const id = req.params.id;

      // 更新用户基本信息
      if (real_name !== undefined || email !== undefined || phone !== undefined) {
        if (password) {
          const hash = bcrypt.hashSync(password, 10);
          db.prepare('UPDATE users SET real_name=COALESCE(?,real_name), email=COALESCE(?,email), phone=COALESCE(?,phone), password=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(real_name, email, phone, hash, id);
        } else {
          db.prepare('UPDATE users SET real_name=COALESCE(?,real_name), email=COALESCE(?,email), phone=COALESCE(?,phone), updated_at=CURRENT_TIMESTAMP WHERE id=?').run(real_name, email, phone, id);
        }
      }

      // 更新状态
      if (status !== undefined) {
        db.prepare('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
      }

      // 更新角色
      if (role_name) {
        // 角色映射：前端 role id -> 后端 role name
        const roleMap = {
          'general_manager': 'general_manager',
          'tech_director': 'technical_director',
          'operations_director': 'general_manager',
          'dept_manager': 'sales_manager',
          'sales': 'sales_rep',
          'social_media': 'sales_rep',
          'purchaser': 'procurement_staff',
          'warehouse_staff': 'warehouse_manager',
          'production_staff': 'production_manager',
          'finance_staff': 'finance_manager',
          'admin_staff': 'hr_manager',
          'aftersales_staff': 'sales_rep'
        };
        const resolvedRole = roleMap[role_name] || role_name;
        const role = db.prepare('SELECT id FROM roles WHERE name = ?').get(resolvedRole);
        if (role) {
          db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
          db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, role.id);
        }
      }

      // 更新部门（users 表 + employees 表双写）
      if (department !== undefined) {
        db.prepare('UPDATE users SET department = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(department || null, id);
        const userInfo = db.prepare('SELECT real_name, email FROM users WHERE id = ?').get(id);
        if (userInfo) {
          let emp = null;
          if (userInfo.email) emp = db.prepare('SELECT id FROM employees WHERE email = ?').get(userInfo.email);
          if (!emp && userInfo.real_name) emp = db.prepare('SELECT id FROM employees WHERE name = ?').get(userInfo.real_name);
          if (emp) {
            db.prepare('UPDATE employees SET department = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(department, emp.id);
          } else {
            // 无记录则自动创建
            const empNo = 'EMP-' + String(id).padStart(3, '0');
            db.prepare('INSERT OR IGNORE INTO employees (employee_no, name, email, department) VALUES (?, ?, ?, ?)').run(empNo, userInfo.real_name || '', userInfo.email || null, department);
          }
        }
      }

      res.json({ success: true, message: '用户更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/users/:id
  router.delete('/:id', (req, res) => {
    try {
      const id = req.params.id;
      if (Number(id) === 1) return res.json({ success: false, error: '不能删除超级管理员' });
      db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      res.json({ success: true, message: '用户已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PATCH /api/users/:id/status
  router.patch('/:id/status', (req, res) => {
    try {
      const { status } = req.body;
      db.prepare('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id);
      res.json({ success: true, message: status === 1 ? '已启用' : '已禁用' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/users/:id/signature — 上传/更新签名图片（base64）
  router.put('/:id/signature', (req, res) => {
    try {
      const id = req.params.id;
      const { signature } = req.body;
      if (!signature) {
        return res.json({ success: false, error: '签名图片不能为空' });
      }
      // 确保 signature_image 列存在
      try {
        db.prepare('ALTER TABLE users ADD COLUMN signature_image TEXT').run();
      } catch (e) { /* 已存在 */ }
      db.prepare('UPDATE users SET signature_image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(signature, id);
      res.json({ success: true, message: '签名更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/users/:id/signature — 获取签名图片
  router.get('/:id/signature', (req, res) => {
    try {
      const id = req.params.id;
      const user = db.prepare('SELECT signature_image FROM users WHERE id = ?').get(id);
      if (!user) return res.json({ success: false, error: '用户不存在' });
      res.json({ success: true, data: { signature: user.signature_image || null } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
