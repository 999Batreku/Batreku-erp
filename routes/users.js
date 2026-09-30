const express = require('express');
const bcrypt = require('bcryptjs');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  const roleMap = {
    'general_manager': 'general_manager',
    'tech_director': 'technical_director',
    'operations_director': 'operations_director',
    'dept_manager': 'sales_manager',
    'sales': 'sales_rep',
    'social_media': 'sales_rep',
    'purchaser': 'procurement_staff',
    'warehouse_staff': 'warehouse_manager',
    'production_staff': 'production_manager',
    'finance_staff': 'finance_manager',
    'admin_staff': 'hr_manager',
    'aftersales_staff': 'aftersales_staff',
    'accountant': 'accountant',
    'maintenance_staff': 'maintenance_staff',
    'warehouse_staff': 'warehouse_staff',
    'aftersales': 'aftersales_staff',
    'maintenance': 'maintenance_staff'
  };

  // GET /api/users
  router.get('/', async (req, res) => {
    try {
      const users = await db.all(`
        SELECT u.id, u.username, u.real_name, u.email, u.phone, u.status, u.created_at, u.department,
          r.name as role_name, r.display_name as role_display_name
        FROM users u
        LEFT JOIN (
          SELECT user_id, MIN(role_id) AS role_id FROM user_roles GROUP BY user_id
        ) ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        ORDER BY u.id
      `, []);
      res.json({ success: true, data: users });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/users
  router.post('/', async (req, res) => {
    try {
      const { username, password, real_name, email, phone, role_name, department, status } = req.body;
      const autoUsername = username || ('user_' + Date.now());
      const autoPassword = password || ('Pass' + Math.random().toString(36).slice(-8) + '!');

      const hash = bcrypt.hashSync(autoPassword, 10);
      const result = await db.run(
        'INSERT INTO users (username, password, real_name, email, phone, status, department) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [autoUsername, hash, real_name, email || null, phone || null, status !== undefined ? status : 1, department || '管理部']
      );
      const userId = result.lastInsertRowid;

      const resolvedRole = roleMap[role_name] || role_name || 'viewer';
      const role = await db.get('SELECT id FROM roles WHERE name = ?', [resolvedRole]);
      if (role) await db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [userId, role.id]);

      const dept = department || '管理部';
      const empNo = 'EMP-' + String(userId).padStart(3, '0');
      await db.run('INSERT INTO employees (employee_no, name, email, department) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
        [empNo, real_name || autoUsername, email || null, dept]);

      res.json({ success: true, data: { id: userId, username: autoUsername, password: autoPassword }, message: '用户创建成功' });
    } catch (e) {
      if (/duplicate key|unique/i.test(e.message)) return res.json({ success: false, error: '用户名或邮箱已存在' });
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/users/:id
  router.put('/:id', async (req, res) => {
    try {
      const { real_name, email, phone, role_name, password, department, status } = req.body;
      const id = req.params.id;

      if (real_name !== undefined || email !== undefined || phone !== undefined) {
        if (password) {
          const hash = bcrypt.hashSync(password, 10);
          await db.run('UPDATE users SET real_name=COALESCE(?,real_name), email=COALESCE(?,email), phone=COALESCE(?,phone), password=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
            [real_name, email, phone, hash, id]);
        } else {
          await db.run('UPDATE users SET real_name=COALESCE(?,real_name), email=COALESCE(?,email), phone=COALESCE(?,phone), updated_at=CURRENT_TIMESTAMP WHERE id=?',
            [real_name, email, phone, id]);
        }
      }

      if (status !== undefined) {
        await db.run('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id]);
      }

      if (role_name) {
        const resolvedRole = roleMap[role_name] || role_name;
        const role = await db.get('SELECT id FROM roles WHERE name = ?', [resolvedRole]);
        if (role) {
          await db.run('DELETE FROM user_roles WHERE user_id = ?', [id]);
          await db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [id, role.id]);
        }
      }

      if (department !== undefined) {
        await db.run('UPDATE users SET department = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [department || null, id]);
        const userInfo = await db.get('SELECT real_name, email FROM users WHERE id = ?', [id]);
        if (userInfo) {
          let emp = null;
          if (userInfo.email) emp = await db.get('SELECT id FROM employees WHERE email = ?', [userInfo.email]);
          if (!emp && userInfo.real_name) emp = await db.get('SELECT id FROM employees WHERE name = ?', [userInfo.real_name]);
          if (emp) {
            await db.run('UPDATE employees SET department = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [department, emp.id]);
          } else {
            const empNo = 'EMP-' + String(id).padStart(3, '0');
            await db.run('INSERT INTO employees (employee_no, name, email, department) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
              [empNo, userInfo.real_name || '', userInfo.email || null, department]);
          }
        }
      }

      res.json({ success: true, message: '用户更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/users/:id
  router.delete('/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (Number(id) === 1) return res.json({ success: false, error: '不能删除超级管理员' });
      await db.run('DELETE FROM user_roles WHERE user_id = ?', [id]);
      await db.run('DELETE FROM users WHERE id = ?', [id]);
      res.json({ success: true, message: '用户已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PATCH /api/users/:id/status
  router.patch('/:id/status', async (req, res) => {
    try {
      const { status } = req.body;
      await db.run('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, req.params.id]);
      res.json({ success: true, message: status === 1 ? '已启用' : '已禁用' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/users/:id/signature
  router.put('/:id/signature', async (req, res) => {
    try {
      const id = req.params.id;
      const { signature } = req.body;
      if (!signature) {
        return res.json({ success: false, error: '签名图片不能为空' });
      }
      await db.run('UPDATE users SET signature_image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [signature, id]);
      res.json({ success: true, message: '签名更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/users/:id/signature
  router.get('/:id/signature', async (req, res) => {
    try {
      const id = req.params.id;
      const user = await db.get('SELECT signature_image FROM users WHERE id = ?', [id]);
      if (!user) return res.json({ success: false, error: '用户不存在' });
      res.json({ success: true, data: { signature: user.signature_image || null } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
